import type Database from 'better-sqlite3'
import { getDatabase } from './database'
// SQL ファイルをビルド時にインライン文字列として埋め込む（?raw = Vite raw import）
import schemaSql_v100 from './schema/v1.0.0.sql?raw'

export const CURRENT_SCHEMA_VERSION = '1.0.0'

const SCHEMA_SQL: Record<string, string> = {
  '1.0.0': schemaSql_v100,
}

interface MigrationStep {
  from: string
  to: string
  sql: string
}

// 将来のマイグレーションステップをここに追加する
const MIGRATION_STEPS: MigrationStep[] = []

export function initializeSchema(db: Database.Database): void {
  const sql = SCHEMA_SQL[CURRENT_SCHEMA_VERSION]
  if (!sql) throw new Error(`Schema SQL not found for version ${CURRENT_SCHEMA_VERSION}`)
  db.exec(sql)
}

export function getSchemaVersion(): string | null {
  const db = getDatabase()
  try {
    const row = db.prepare('SELECT schema_version FROM project LIMIT 1').get() as
      | { schema_version: string }
      | undefined
    return row?.schema_version ?? null
  } catch {
    return null
  }
}

export function migrateIfNeeded(db: Database.Database): void {
  const currentVersion = getSchemaVersion()

  if (currentVersion === null) {
    // 新規 DB：スキーマを初期化するだけ
    initializeSchema(db)
    return
  }

  if (currentVersion === CURRENT_SCHEMA_VERSION) return

  // バージョンが古い場合は順番にマイグレーションを適用
  const applicable = buildMigrationPath(currentVersion, CURRENT_SCHEMA_VERSION)
  if (applicable.length === 0) {
    throw new Error(
      `No migration path from schema_version ${currentVersion} to ${CURRENT_SCHEMA_VERSION}`
    )
  }

  const migrate = db.transaction(() => {
    for (const step of applicable) {
      db.exec(step.sql)
      db.prepare('UPDATE project SET schema_version = ?, updated_at = ?').run(
        step.to,
        new Date().toISOString()
      )
    }
  })

  migrate()
}

function buildMigrationPath(from: string, to: string): MigrationStep[] {
  const path: MigrationStep[] = []
  let current = from

  while (current !== to) {
    const step = MIGRATION_STEPS.find((s) => s.from === current)
    if (!step) break
    path.push(step)
    current = step.to
  }

  return current === to ? path : []
}
