/**
 * project.db への better-sqlite3 アクセス層（P1-2）。
 * 同期 API のため、実測 500ms 超の処理はジョブまたは worker_threads へ分離する
 * （sdd_function_architecture §2.4）。
 */
import BetterSqlite3, { type Database } from 'better-sqlite3'
import { existsSync } from 'node:fs'
import { BackendError } from '../api/errors'
import { INITIAL_SCHEMA_SQL, INITIAL_SCHEMA_VERSION } from '../db/schema/initial-schema'
import { runMigrations } from '../db/migrations'
import { seedOntology } from '../ontology/ontology-service'
import { newUid } from './uid'

function applyPragmas(db: Database): void {
  db.pragma('foreign_keys = ON')
  db.pragma('journal_mode = WAL')
  db.pragma('synchronous = NORMAL')
}

export interface CreateDatabaseOptions {
  projectName: string
  description?: string
  rootPath?: string
  projectUid?: string
}

export interface ProjectRow {
  uid: string
  name: string
  description: string | null
  root_path: string | null
  schema_version: string
}

/** 新規 project.db を作成し、初期スキーマ・シード・project 行を投入する */
export function createDatabase(dbFilePath: string, options: CreateDatabaseOptions): Database {
  if (existsSync(dbFilePath)) {
    throw new BackendError('conflict', 'project.db は既に存在します', dbFilePath)
  }
  const db = new BetterSqlite3(dbFilePath)
  try {
    applyPragmas(db)
    db.exec(INITIAL_SCHEMA_SQL)

    const projectUid = options.projectUid ?? newUid()
    db.prepare(`INSERT INTO project (uid, name, description, root_path, schema_version) VALUES (?, ?, ?, ?, ?)`).run(
      projectUid,
      options.projectName,
      options.description ?? null,
      options.rootPath ?? null,
      INITIAL_SCHEMA_VERSION
    )

    seedOntology(db)
    // 新規 DB も最新 schema_version までマイグレーションを適用する
    runMigrations(db, dbFilePath)
    return db
  } catch (err) {
    db.close()
    throw err
  }
}

/** 既存の project.db を開き、未適用マイグレーションを適用する */
export function openDatabase(dbFilePath: string): Database {
  if (!existsSync(dbFilePath)) {
    throw new BackendError('not_found', 'project.db が見つかりません', dbFilePath)
  }
  const db = new BetterSqlite3(dbFilePath)
  try {
    applyPragmas(db)
    runMigrations(db, dbFilePath)
    return db
  } catch (err) {
    db.close()
    if (err instanceof BackendError) throw err
    throw new BackendError('db', 'project.db を開けませんでした', err instanceof Error ? err.message : String(err))
  }
}

export function getProjectRow(db: Database): ProjectRow {
  const row = db.prepare('SELECT uid, name, description, root_path, schema_version FROM project LIMIT 1').get() as
    ProjectRow | undefined
  if (!row) {
    throw new BackendError('db', 'project 行が存在しません', '')
  }
  return row
}

export function closeDatabase(db: Database): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } finally {
    db.close()
  }
}
