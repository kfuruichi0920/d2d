/**
 * プロジェクトルートのファイルレイアウト管理（P1-3、sdd_directory §2, §7, §9）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PROJECT_FILE_NAME = 'project.d2d'
export const PROJECT_DB_NAME = 'project.db'

/** プロジェクトルート直下に生成するディレクトリ一覧（sdd_directory §2） */
export const PROJECT_DIRECTORIES = [
  'blobs/originals',
  'blobs/extracted',
  'blobs/figures',
  'blobs/tables',
  'blobs/llm',
  'blobs/exports',
  'exports/db_to_text',
  'exports/sqlite_dump',
  'exports/manifest',
  'logs/jobs',
  'logs/llm',
  'archives'
] as const

/** blob 分類（sdd_data_structure §2.2） */
export type BlobCategory = 'originals' | 'extracted' | 'figures' | 'tables' | 'llm' | 'exports'

/** sdd_directory §7/§9 の Git 管理方針 */
const GITIGNORE_CONTENT = `# blob派生物・大容量ファイル（再生成可能・機密の可能性）
blobs/extracted/
blobs/llm/
blobs/exports/

# ログ・アーカイブ
logs/
archives/

# SQLite 一時ファイル
*.db-wal
*.db-shm
*.db.bak-*
`

const GITATTRIBUTES_CONTENT = `# SQLite を Git バイナリ扱いにして diff 無効化
*.db binary

# テキスト正規化
*.md   text eol=lf
*.json text eol=lf
*.jsonl text eol=lf
`

export interface ProjectPaths {
  root: string
  projectFile: string
  dbFile: string
  blobsDir: string
  exportsDir: string
  logsDir: string
  archivesDir: string
}

export function resolveProjectPaths(rootPath: string): ProjectPaths {
  return {
    root: rootPath,
    projectFile: join(rootPath, PROJECT_FILE_NAME),
    dbFile: join(rootPath, PROJECT_DB_NAME),
    blobsDir: join(rootPath, 'blobs'),
    exportsDir: join(rootPath, 'exports'),
    logsDir: join(rootPath, 'logs'),
    archivesDir: join(rootPath, 'archives')
  }
}

export function blobDir(rootPath: string, category: BlobCategory): string {
  return join(rootPath, 'blobs', category)
}

/** プロジェクトルート配下のディレクトリと Git 設定ファイルを生成する */
export function createProjectLayout(rootPath: string): void {
  mkdirSync(rootPath, { recursive: true })
  for (const dir of PROJECT_DIRECTORIES) {
    mkdirSync(join(rootPath, dir), { recursive: true })
  }
  // 既存の .gitignore / .gitattributes は上書きしない（ユーザ運用の変更を尊重する）
  const gitignore = join(rootPath, '.gitignore')
  if (!existsSync(gitignore)) {
    writeFileSync(gitignore, GITIGNORE_CONTENT, 'utf-8')
  }
  const gitattributes = join(rootPath, '.gitattributes')
  if (!existsSync(gitattributes)) {
    writeFileSync(gitattributes, GITATTRIBUTES_CONTENT, 'utf-8')
  }
}

/** project.d2d の内容（sdd_directory §4。相対参照のみで絶対パスを持たない） */
export interface ProjectFileContent {
  d2d_version: '1'
  project_uid: string
  schema_version: string
  created_at: string
}

export function writeProjectFile(rootPath: string, content: ProjectFileContent): void {
  writeFileSync(join(rootPath, PROJECT_FILE_NAME), `${JSON.stringify(content, null, 2)}\n`, 'utf-8')
}

export function readProjectFileRaw(projectFilePath: string): unknown {
  return JSON.parse(readFileSync(projectFilePath, 'utf-8'))
}
