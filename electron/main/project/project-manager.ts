import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname, resolve } from 'path'
import { openDatabase, closeDatabase, isOpen, getDatabase } from '../db/database'
import { migrateIfNeeded, initializeSchema, CURRENT_SCHEMA_VERSION } from '../db/migration'
import { generateUid } from '../utils/uuid'
import { getEventBus } from '../events/event-bus'
import type { ProjectInfo, CreateProjectOptions } from '../../../src/types/d2d-api'

export type { ProjectInfo, CreateProjectOptions }

export interface ProjectFile {
  d2d_version: string
  project_uid: string
  schema_version: string
  created_at: string
}

let currentProjectRoot: string | null = null

export function getProjectRoot(): string {
  if (!currentProjectRoot) throw new Error('No project is open')
  return currentProjectRoot
}

export function getCurrentProjectRoot(): string | null {
  return currentProjectRoot
}

export function isProjectOpen(): boolean {
  return currentProjectRoot !== null && isOpen()
}

// ディレクトリを作成（存在していても OK）
function ensureDir(p: string): void {
  if (!existsSync(p)) mkdirSync(p, { recursive: true })
}

function initProjectDirectories(rootPath: string): void {
  const dirs = [
    join(rootPath, 'blobs', 'originals'),
    join(rootPath, 'blobs', 'extracted'),
    join(rootPath, 'blobs', 'figures'),
    join(rootPath, 'blobs', 'tables'),
    join(rootPath, 'blobs', 'llm'),
    join(rootPath, 'blobs', 'exports'),
    join(rootPath, 'exports', 'db_to_text'),
    join(rootPath, 'exports', 'sqlite_dump'),
    join(rootPath, 'exports', 'manifest'),
    join(rootPath, 'logs', 'jobs'),
    join(rootPath, 'logs', 'llm'),
    join(rootPath, 'archives')
  ]
  for (const dir of dirs) {
    ensureDir(dir)
  }
}

export function createProject(opts: CreateProjectOptions): string {
  const { name, description, dirPath } = opts
  const rootPath = resolve(dirPath)

  ensureDir(rootPath)
  initProjectDirectories(rootPath)

  const projectUid = generateUid()
  const now = new Date().toISOString()

  // project.d2d
  const d2dFilePath = join(rootPath, 'project.d2d')
  if (existsSync(d2dFilePath)) {
    throw new Error(`project.d2d already exists in ${rootPath}`)
  }

  const projectFile: ProjectFile = {
    d2d_version: '1',
    project_uid: projectUid,
    schema_version: CURRENT_SCHEMA_VERSION,
    created_at: now
  }
  writeFileSync(d2dFilePath, JSON.stringify(projectFile, null, 2), 'utf-8')

  // project.db を初期化
  const dbPath = join(rootPath, 'project.db')
  const db = openDatabase(dbPath)
  initializeSchema(db)

  db.prepare(
    `INSERT INTO project (uid, name, description, root_path, schema_version, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(projectUid, name, description ?? null, rootPath, CURRENT_SCHEMA_VERSION, now, now)

  currentProjectRoot = rootPath
  getEventBus().emit('project.opened', { projectUid, rootPath })

  return d2dFilePath
}

export function openProject(d2dFilePath: string): ProjectInfo {
  if (!existsSync(d2dFilePath)) {
    throw new Error(`project.d2d not found: ${d2dFilePath}`)
  }

  const raw = readFileSync(d2dFilePath, 'utf-8')
  const projectFile: ProjectFile = JSON.parse(raw)
  const rootPath = dirname(resolve(d2dFilePath))
  const dbPath = join(rootPath, 'project.db')

  if (!existsSync(dbPath)) {
    throw new Error(`project.db not found in ${rootPath}`)
  }

  const db = openDatabase(dbPath)
  migrateIfNeeded(db)

  initProjectDirectories(rootPath)

  const info = db
    .prepare('SELECT uid, name, description, root_path, schema_version, created_at, updated_at FROM project WHERE uid = ?')
    .get(projectFile.project_uid) as ProjectInfo | undefined

  if (!info) {
    throw new Error(`Project record not found for uid: ${projectFile.project_uid}`)
  }

  currentProjectRoot = rootPath
  getEventBus().emit('project.opened', { projectUid: info.uid, rootPath })

  return info
}

export function closeProject(): void {
  if (currentProjectRoot) {
    getEventBus().emit('project.closed', { rootPath: currentProjectRoot })
  }
  closeDatabase()
  currentProjectRoot = null
}

export function getCurrentProject(): ProjectInfo | null {
  if (!isProjectOpen()) return null

  const db = getDatabase()
  const root = getProjectRoot()
  const d2dFile = readFileSync(join(root, 'project.d2d'), 'utf-8')
  const { project_uid } = JSON.parse(d2dFile) as ProjectFile

  return db
    .prepare('SELECT uid, name, description, root_path, schema_version, created_at, updated_at FROM project WHERE uid = ?')
    .get(project_uid) as ProjectInfo | null
}
