import type Database from 'better-sqlite3'
import { getDatabase } from '../db/database'

// トランザクション付き関数型
export type TransactionFn<T> = (db: Database.Database) => T

export function withTransaction<T>(fn: TransactionFn<T>): T {
  const db = getDatabase()
  return db.transaction(() => fn(db))()
}

export function queryAll<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T[] {
  const db = getDatabase()
  return db.prepare(sql).all(...params) as T[]
}

export function queryOne<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): T | undefined {
  const db = getDatabase()
  return db.prepare(sql).get(...params) as T | undefined
}

export function execute(sql: string, params: unknown[] = []): Database.RunResult {
  const db = getDatabase()
  return db.prepare(sql).run(...params)
}

export function executeMany(sql: string, rows: unknown[][]): void {
  const db = getDatabase()
  const stmt = db.prepare(sql)
  const bulk = db.transaction((rows: unknown[][]) => {
    for (const row of rows) {
      stmt.run(...row)
    }
  })
  bulk(rows)
}
