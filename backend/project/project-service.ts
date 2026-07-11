/**
 * プロジェクトの作成・オープン・クローズ（P1-3 の基盤サービス）。
 * 成果物定義・開発フェーズ等のプロジェクト設定 CRUD は P2-1 で拡張する。
 */
import type { Database } from 'better-sqlite3'
import { dirname, resolve } from 'node:path'
import { existsSync, statSync } from 'node:fs'
import { BackendError } from '../api/errors'
import { validateSchema } from '../schemas'
import { closeDatabase, createDatabase, getProjectRow, openDatabase } from '../store/database'
import { registerEntity } from '../store/entity-registry'
import { newUid } from '../store/uid'
import {
  PROJECT_FILE_NAME,
  createProjectLayout,
  readProjectFileRaw,
  resolveProjectPaths,
  writeProjectFile,
  type ProjectFileContent,
  type ProjectPaths
} from './layout'

import { eventBus } from '../events/event-bus'

export interface ProjectInfo {
  projectUid: string
  name: string
  description: string | null
  rootPath: string
  schemaVersion: string
  code: string | null
}

export interface OpenedProject {
  db: Database
  paths: ProjectPaths
  info: ProjectInfo
}

/** 現在開いているプロジェクト（初期実装は同時に1つ。切替時は close → open） */
let current: OpenedProject | null = null

export function currentProject(): OpenedProject | null {
  return current
}

export function requireProject(): OpenedProject {
  if (!current) {
    throw new BackendError('validation', 'プロジェクトが開かれていません', 'project.open を先に実行してください')
  }
  return current
}

export interface CreateProjectInput {
  rootPath: string
  name: string
  description?: string
}

export function createProject(input: CreateProjectInput): ProjectInfo {
  if (!input.rootPath || !input.name) {
    throw new BackendError('validation', 'rootPath と name は必須です', '')
  }
  const rootPath = resolve(input.rootPath)
  const paths = resolveProjectPaths(rootPath)
  if (existsSync(paths.projectFile) || existsSync(paths.dbFile)) {
    throw new BackendError('conflict', '指定フォルダには既にプロジェクトが存在します', rootPath)
  }

  createProjectLayout(rootPath)

  const projectUid = newUid()
  const db = createDatabase(paths.dbFile, {
    projectName: input.name,
    description: input.description,
    // root_path は移動可能性があるため参考情報（sdd_data_structure §4.1 備考）
    rootPath,
    projectUid
  })

  // プロジェクト自身も共通台帳へ登録する（entity_type='project'、code prefix PRJ）
  const { code } = registerEntity(db, {
    projectUid,
    entityType: 'project',
    title: input.name,
    createdBy: 'user'
  })

  // マイグレーション適用後の実際の schema_version を反映する
  const schemaVersion = getProjectRow(db).schema_version
  const content: ProjectFileContent = {
    d2d_version: '1',
    project_uid: projectUid,
    schema_version: schemaVersion,
    created_at: new Date().toISOString()
  }
  writeProjectFile(rootPath, content)

  closeAndForget()
  current = {
    db,
    paths,
    info: {
      projectUid,
      name: input.name,
      description: input.description ?? null,
      rootPath,
      schemaVersion,
      code
    }
  }
  // sdd_function_architecture §9: プロジェクトファイル読込完了通知
  eventBus.emit('project.opened', { ...current.info, created: true })
  return current.info
}

export interface OpenProjectInput {
  /** project.d2d へのパス、またはプロジェクトルート */
  path: string
}

export function openProject(input: OpenProjectInput): ProjectInfo {
  if (!input.path) {
    throw new BackendError('validation', 'path は必須です', '')
  }
  const target = resolve(input.path)
  let projectFilePath: string
  if (existsSync(target) && statSync(target).isDirectory()) {
    projectFilePath = resolve(target, PROJECT_FILE_NAME)
  } else {
    projectFilePath = target
  }
  if (!existsSync(projectFilePath)) {
    throw new BackendError('not_found', 'project.d2d が見つかりません', projectFilePath)
  }

  const content = validateSchema<ProjectFileContent>(
    'd2d://schemas/project-d2d',
    readProjectFileRaw(projectFilePath),
    PROJECT_FILE_NAME
  )

  const rootPath = dirname(projectFilePath)
  const paths = resolveProjectPaths(rootPath)
  const db = openDatabase(paths.dbFile)

  const row = getProjectRow(db)
  if (row.uid !== content.project_uid) {
    closeDatabase(db)
    throw new BackendError(
      'conflict',
      'project.d2d と project.db の project_uid が一致しません',
      `d2d=${content.project_uid} db=${row.uid}`
    )
  }

  // フォルダ移動後も開けるよう、不足ディレクトリは補完する
  createProjectLayout(rootPath)

  const codeRow = db
    .prepare(`SELECT code FROM entity_registry WHERE uid = ? AND entity_type = 'project'`)
    .get(row.uid) as { code: string } | undefined

  closeAndForget()
  current = {
    db,
    paths,
    info: {
      projectUid: row.uid,
      name: row.name,
      description: row.description,
      rootPath,
      schemaVersion: row.schema_version,
      code: codeRow?.code ?? null
    }
  }
  eventBus.emit('project.opened', { ...current.info, created: false })
  return current.info
}

export function closeProject(): void {
  const closing = current?.info ?? null
  closeAndForget()
  if (closing) {
    eventBus.emit('project.closed', { projectUid: closing.projectUid })
  }
}

function closeAndForget(): void {
  if (current) {
    closeDatabase(current.db)
    current = null
  }
}
