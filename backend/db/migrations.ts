/**
 * project.db マイグレーション機構（P1-1、sdd_data_structure §10.4）。
 *
 * schema_version は x.x.x 形式。適用手順:
 *   1. 現在の schema_version を読む
 *   2. 適用可能なマイグレーションを昇順に決定
 *   3. project.db をバックアップ
 *   4. BEGIN IMMEDIATE → DDL・データ補正 → 整合性チェック → schema_version 更新 → COMMIT
 * 失敗時は ROLLBACK し、バックアップを残す。
 */
import type { Database } from 'better-sqlite3'
import { copyFileSync, existsSync } from 'node:fs'
import { BackendError } from '../api/errors'
import { INITIAL_SCHEMA_VERSION } from './schema/initial-schema'

export interface Migration {
  /** 適用後の schema_version（x.x.x） */
  version: string
  description: string
  apply(db: Database): void
}

/**
 * 昇順に並べたマイグレーション一覧。
 * 初期スキーマ（1.0.0）は createDatabase で適用するため含めない。
 * スキーマ変更時はここへ追加し、§10.4 の変更種別に応じて桁を上げる。
 */
export const MIGRATIONS: Migration[] = [
  {
    version: '2.0.0',
    description: '設計モデルをresource_*からmodel_*へ分離（破壊的変更）',
    apply() {
      throw new BackendError(
        'db',
        'schema 1.x のプロジェクトは開けません。schema 2.0.0 でプロジェクトを再作成してください',
        '本改修は後方互換マイグレーションを提供しません',
        false
      )
    }
  },
  {
    // TBD-04 決定: resource_table_cell を別テーブルへ分割（互換的な機能追加 → 第2桁更新）
    // セル ID（uid）は行内で安定に保持し、セル単位の設計根拠（EDIT-024/025）は
    // trace_link.evidence_span からこの uid を参照して利用する。
    // 注: entity_registry.entity_type の CHECK 制約更新（テーブル再構築）は破壊的変更を
    // 避けるため見送り、セル行は entity_registry へ登録しない（登録は将来の 2.0.0 で検討）。
    version: '1.1.0',
    description: 'resource_table_cell 別テーブルの追加（TBD-04）',
    apply(db) {
      db.exec(`
        CREATE TABLE IF NOT EXISTS resource_table_cell (
          uid TEXT PRIMARY KEY,
          table_uid TEXT NOT NULL,
          row_no INTEGER NOT NULL CHECK (row_no >= 0),
          col_no INTEGER NOT NULL CHECK (col_no >= 0),
          cell_text TEXT NOT NULL DEFAULT '',
          colspan INTEGER NOT NULL DEFAULT 1 CHECK (colspan >= 1),
          is_header INTEGER NOT NULL DEFAULT 0 CHECK (is_header IN (0, 1)),
          UNIQUE (table_uid, row_no, col_no),
          FOREIGN KEY (table_uid) REFERENCES resource_table(uid) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_resource_table_cell_table ON resource_table_cell(table_uid, row_no, col_no);
      `)
    }
  },
  {
    // P7-1: 成果物は開発フェーズ配下に所属する。既存行は未割当として移行し、UIで再設定する。
    version: '1.2.0',
    description: '成果物設定への開発フェーズ紐付け追加（P7-1）',
    apply(db) {
      const columns = db.prepare(`PRAGMA table_info(project_artifact_setting)`).all() as { name: string }[]
      if (!columns.some((column) => column.name === 'dev_phase_id'))
        db.exec(`ALTER TABLE project_artifact_setting ADD COLUMN dev_phase_id TEXT;`)
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_project_artifact_setting_phase ON project_artifact_setting(project_uid, dev_phase_id, sort_order);`
      )
    }
  },
  {
    // P7-5 / MID-032: チャンクごとの補足プロンプトをDB正本として保持する。
    version: '1.3.0',
    description: 'チャンク追加プロンプトの追加（MID-032）',
    apply(db) {
      const columns = db.prepare('PRAGMA table_info(chunk)').all() as { name: string }[]
      if (!columns.some((column) => column.name === 'additional_prompt'))
        db.exec("ALTER TABLE chunk ADD COLUMN additional_prompt TEXT NOT NULL DEFAULT '';")
    }
  },
  {
    // P7-5: チャンクIDを変えずに成果物内の表示順を編集する。
    version: '1.4.0',
    description: 'チャンク表示順の追加（MID-031）',
    apply(db) {
      const columns = db.prepare('PRAGMA table_info(chunk)').all() as { name: string }[]
      if (!columns.some((column) => column.name === 'sort_order'))
        db.exec('ALTER TABLE chunk ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0);')
      db.exec(
        'UPDATE chunk SET sort_order = (SELECT ranked.rn - 1 FROM (SELECT c2.uid, ROW_NUMBER() OVER (PARTITION BY c2.intermediate_document_uid ORDER BY c2.created_at, e.code) AS rn FROM chunk c2 JOIN entity_registry e ON e.uid=c2.uid) ranked WHERE ranked.uid=chunk.uid)'
      )
    }
  },
  {
    // P3-7 / UI-047: Explorer非表示のアーカイブはレビュー・削除状態と独立して保持する。
    version: '1.5.0',
    description: 'Entityアーカイブ状態の追加（UI-047）',
    apply(db) {
      const columns = db.prepare('PRAGMA table_info(entity_registry)').all() as { name: string }[]
      if (!columns.some((column) => column.name === 'is_archived'))
        db.exec(
          'ALTER TABLE entity_registry ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1));'
        )
      db.exec(
        'CREATE INDEX IF NOT EXISTS idx_entity_registry_archive ON entity_registry(project_uid, entity_type, is_archived, status);'
      )
    }
  },
  {
    // P10-7 / EDIT-057〜071: 表示文章と構造化参照、正規化履歴を分離して保持する。
    version: '1.6.0',
    description: 'セマンティック入力支援データの追加（EDIT-057〜071）',
    apply(db) {
      const glossaryColumns = db.prepare('PRAGMA table_info(resource_glossary)').all() as { name: string }[]
      if (!glossaryColumns.some((column) => column.name === 'dictionary_scope'))
        db.exec("ALTER TABLE resource_glossary ADD COLUMN dictionary_scope TEXT NOT NULL DEFAULT 'project';")
      if (!glossaryColumns.some((column) => column.name === 'version_tag'))
        db.exec("ALTER TABLE resource_glossary ADD COLUMN version_tag TEXT NOT NULL DEFAULT '1';")
      if (!glossaryColumns.some((column) => column.name === 'is_deprecated'))
        db.exec(
          'ALTER TABLE resource_glossary ADD COLUMN is_deprecated INTEGER NOT NULL DEFAULT 0 CHECK (is_deprecated IN (0,1));'
        )
      if (!glossaryColumns.some((column) => column.name === 'access_level'))
        db.exec(
          "ALTER TABLE resource_glossary ADD COLUMN access_level TEXT NOT NULL DEFAULT 'write' CHECK (access_level IN ('read','write','none'));"
        )
      db.exec(`
        CREATE TABLE IF NOT EXISTS semantic_text (
          uid TEXT PRIMARY KEY,
          project_uid TEXT NOT NULL,
          owner_uid TEXT NOT NULL,
          field_name TEXT NOT NULL,
          original_text TEXT NOT NULL,
          display_text TEXT NOT NULL,
          policy_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (owner_uid, field_name),
          FOREIGN KEY (project_uid) REFERENCES project(uid) ON DELETE CASCADE,
          FOREIGN KEY (owner_uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS semantic_reference (
          uid TEXT PRIMARY KEY,
          semantic_text_uid TEXT NOT NULL,
          start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
          end_offset INTEGER NOT NULL CHECK (end_offset > start_offset),
          surface_text TEXT NOT NULL,
          target_uid TEXT NOT NULL,
          target_kind TEXT NOT NULL CHECK (target_kind IN ('glossary', 'model')),
          display_mode TEXT NOT NULL CHECK (display_mode IN ('link', 'string', 'id', 'uid')),
          relation_type TEXT NOT NULL DEFAULT 'relates_to',
          status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rejected')),
          source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'dictionary', 'morphology', 'llm')),
          confidence REAL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (semantic_text_uid) REFERENCES semantic_text(uid) ON DELETE CASCADE,
          FOREIGN KEY (target_uid) REFERENCES entity_registry(uid)
        );
        CREATE TABLE IF NOT EXISTS semantic_normalization_history (
          uid TEXT PRIMARY KEY,
          semantic_text_uid TEXT NOT NULL,
          before_text TEXT NOT NULL,
          after_text TEXT NOT NULL,
          method TEXT NOT NULL CHECK (method IN ('mechanical', 'dictionary', 'llm', 'user')),
          status TEXT NOT NULL CHECK (status IN ('candidate', 'approved', 'rejected', 'reverted')),
          detail_json TEXT NOT NULL DEFAULT '{}',
          created_at TEXT NOT NULL,
          decided_at TEXT,
          FOREIGN KEY (semantic_text_uid) REFERENCES semantic_text(uid) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_semantic_text_owner ON semantic_text(owner_uid, field_name);
        CREATE INDEX IF NOT EXISTS idx_semantic_reference_text ON semantic_reference(semantic_text_uid, start_offset);
        CREATE INDEX IF NOT EXISTS idx_semantic_reference_target ON semantic_reference(target_uid, status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_semantic_history_text ON semantic_normalization_history(semantic_text_uid, created_at);
      `)
    }
  },
  {
    // P2-1 / CORE-013: 同じ成果物名を複数フェーズへ登録できるよう一意性をフェーズ単位にする。
    version: '1.7.0',
    description: '成果物名のフェーズ単位一意化（CORE-013）',
    apply(db) {
      // project_artifact_relation の外部キーを維持するため、関係行を退避して両表を再構築する。
      db.exec(`
        CREATE TEMP TABLE migration_1_7_artifact_relation AS
          SELECT uid, project_uid, parent_artifact_uid, child_artifact_uid, sort_order, is_active, created_at, updated_at
            FROM project_artifact_relation;
        DROP TABLE project_artifact_relation;

        CREATE TABLE project_artifact_setting_v17 (
          uid TEXT PRIMARY KEY,
          project_uid TEXT NOT NULL,
          artifact_name TEXT NOT NULL,
          artifact_type_id TEXT NOT NULL,
          dev_phase_id TEXT,
          sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (project_uid, dev_phase_id, artifact_name),
          UNIQUE (uid, project_uid),
          FOREIGN KEY (project_uid) REFERENCES project(uid) ON DELETE CASCADE
        );
        INSERT INTO project_artifact_setting_v17
          (uid, project_uid, artifact_name, artifact_type_id, dev_phase_id, sort_order, is_active, created_at, updated_at)
          SELECT uid, project_uid, artifact_name, artifact_type_id, dev_phase_id, sort_order, is_active, created_at, updated_at
            FROM project_artifact_setting;
        DROP TABLE project_artifact_setting;
        ALTER TABLE project_artifact_setting_v17 RENAME TO project_artifact_setting;

        CREATE TABLE project_artifact_relation (
          uid TEXT PRIMARY KEY,
          project_uid TEXT NOT NULL,
          parent_artifact_uid TEXT NOT NULL,
          child_artifact_uid TEXT NOT NULL,
          sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
          is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          UNIQUE (project_uid, parent_artifact_uid, child_artifact_uid),
          CHECK (parent_artifact_uid <> child_artifact_uid),
          FOREIGN KEY (project_uid) REFERENCES project(uid) ON DELETE CASCADE,
          FOREIGN KEY (parent_artifact_uid, project_uid) REFERENCES project_artifact_setting(uid, project_uid) ON DELETE CASCADE,
          FOREIGN KEY (child_artifact_uid, project_uid) REFERENCES project_artifact_setting(uid, project_uid) ON DELETE CASCADE
        );
        INSERT INTO project_artifact_relation
          (uid, project_uid, parent_artifact_uid, child_artifact_uid, sort_order, is_active, created_at, updated_at)
          SELECT uid, project_uid, parent_artifact_uid, child_artifact_uid, sort_order, is_active, created_at, updated_at
            FROM migration_1_7_artifact_relation;
        DROP TABLE migration_1_7_artifact_relation;

        CREATE INDEX idx_project_artifact_setting_project ON project_artifact_setting(project_uid, sort_order);
        CREATE INDEX idx_project_artifact_setting_phase ON project_artifact_setting(project_uid, dev_phase_id, sort_order);
        CREATE INDEX idx_project_artifact_relation_parent ON project_artifact_relation(project_uid, parent_artifact_uid, sort_order);
        CREATE INDEX idx_project_artifact_relation_child ON project_artifact_relation(project_uid, child_artifact_uid);
      `)
    }
  },
  {
    // W12 / LLM-011 拡張: Provider との生の送受信ログ（マスキング後）を blob 参照で保持する。
    version: '1.8.0',
    description: 'LLM 実行への生送受信ログ参照の追加（W12）',
    apply(db) {
      const columns = db.prepare('PRAGMA table_info(llm_run_ref)').all() as { name: string }[]
      if (!columns.some((column) => column.name === 'raw_request_blob_uid'))
        db.exec('ALTER TABLE llm_run_ref ADD COLUMN raw_request_blob_uid TEXT;')
      if (!columns.some((column) => column.name === 'raw_response_blob_uid'))
        db.exec('ALTER TABLE llm_run_ref ADD COLUMN raw_response_blob_uid TEXT;')
    }
  },
  {
    // P7-2/P7-3/P10-7 / EDIT-074〜086: Resource編集情報と管理用特記事項を拡張する。
    version: '1.9.0',
    description: 'Resource編集・LLM文脈・管理情報の拡張（EDIT-074〜086）',
    apply(db) {
      const add = (table: string, column: string, ddl: string): void => {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`)
      }
      add('entity_registry', 'administrative_notes', 'administrative_notes TEXT')
      add(
        'resource_text',
        'target_resource_uid',
        'target_resource_uid TEXT REFERENCES entity_registry(uid) ON DELETE SET NULL'
      )
      add('resource_figure', 'byte_size', 'byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0)')
      add('resource_figure', 'image_format', 'image_format TEXT')
      add('resource_figure', 'description', 'description TEXT')
      add('resource_formula', 'description', 'description TEXT')
    }
  },
  {
    version: '1.10.0',
    description: '図・表・コードResource編集情報の拡張（EDIT-087〜091）',
    apply(db) {
      const add = (table: string, column: string, ddl: string): void => {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
        if (!columns.some((item) => item.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl};`)
      }
      add('resource_figure', 'figure_number', 'figure_number TEXT')
      add('resource_figure', 'caption', 'caption TEXT')
      add('resource_table', 'description', 'description TEXT')
      add('resource_code', 'description', 'description TEXT')
    }
  }
]
/** 最新の schema_version（新規 DB 作成時にもマイグレーションを適用して到達させる） */
export const LATEST_SCHEMA_VERSION =
  [INITIAL_SCHEMA_VERSION, ...MIGRATIONS.map((item) => item.version)].sort(compareVersion).at(-1) ??
  INITIAL_SCHEMA_VERSION

export function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

export function getSchemaVersion(db: Database): string {
  const row = db.prepare('SELECT schema_version FROM project LIMIT 1').get() as { schema_version: string } | undefined
  if (!row) {
    throw new BackendError('db', 'project 行が存在しません', 'project.db が初期化されていない可能性があります')
  }
  return row.schema_version
}

/** 適用対象のマイグレーションを返す（現在版より新しく、target 以下のもの） */
export function pendingMigrations(currentVersion: string): Migration[] {
  return MIGRATIONS.filter((m) => compareVersion(m.version, currentVersion) > 0).sort((a, b) =>
    compareVersion(a.version, b.version)
  )
}

/** §10.4 の整合性チェック（最低限: FK・code重複） */
export function checkIntegrity(db: Database): void {
  const fkErrors = db.prepare('PRAGMA foreign_key_check').all()
  if (fkErrors.length > 0) {
    throw new BackendError('db', '外部キー整合性違反があります', JSON.stringify(fkErrors.slice(0, 10)))
  }
  const dup = db
    .prepare('SELECT entity_type, code, COUNT(*) AS n FROM entity_registry GROUP BY entity_type, code HAVING n > 1')
    .all()
  if (dup.length > 0) {
    throw new BackendError('db', 'code の重複があります', JSON.stringify(dup.slice(0, 10)))
  }
}

/**
 * 未適用マイグレーションを適用する。適用した場合はバックアップを作成する。
 * @returns 適用後の schema_version
 */
export function runMigrations(db: Database, dbFilePath: string): string {
  const current = getSchemaVersion(db)
  if (compareVersion(current, '2.0.0') < 0) {
    throw new BackendError(
      'db',
      'schema 1.x のプロジェクトは開けません。schema 2.0.0 でプロジェクトを再作成してください',
      '本改修は後方互換マイグレーションを提供しません',
      false
    )
  }
  const pending = pendingMigrations(current)
  if (pending.length === 0) {
    return current
  }

  // 手順3: バックアップ（同一ディレクトリに .bak-<version> として保存）
  if (existsSync(dbFilePath)) {
    copyFileSync(dbFilePath, `${dbFilePath}.bak-${current}`)
  }

  let version = current
  for (const migration of pending) {
    const txn = db.transaction(() => {
      migration.apply(db)
      checkIntegrity(db)
      db.prepare('UPDATE project SET schema_version = ?, updated_at = ?').run(migration.version, nowIso())
    })
    try {
      txn.immediate()
      version = migration.version
    } catch (err) {
      throw new BackendError(
        'db',
        `マイグレーション ${migration.version} の適用に失敗しました`,
        err instanceof Error ? (err.stack ?? err.message) : String(err),
        false
      )
    }
  }
  return version
}

export function nowIso(): string {
  return new Date().toISOString()
}

export { INITIAL_SCHEMA_VERSION }
