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
  }
]

/** 最新の schema_version（新規 DB 作成時にもマイグレーションを適用して到達させる） */
export const LATEST_SCHEMA_VERSION = MIGRATIONS.at(-1)?.version ?? INITIAL_SCHEMA_VERSION

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
