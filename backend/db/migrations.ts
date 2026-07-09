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
export const MIGRATIONS: Migration[] = []

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
