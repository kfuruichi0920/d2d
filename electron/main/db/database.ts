import Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { join } from 'path'

let db: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (!db) throw new Error('Database not initialized. Call openDatabase() first.')
  return db
}

export function openDatabase(dbPath: string): Database.Database {
  if (db) db.close()

  db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')

  return db
}

export function closeDatabase(): void {
  if (db) {
    db.close()
    db = null
  }
}

export function isOpen(): boolean {
  return db !== null && db.open
}

export function loadSchemaSql(schemaVersion: string): string {
  const schemaPath = join(__dirname, 'schema', `${schemaVersion}.sql`)
  return readFileSync(schemaPath, 'utf-8')
}
