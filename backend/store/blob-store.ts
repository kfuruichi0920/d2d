/**
 * blob_resource 管理（P1-4、sdd_data_structure §2.2）。
 * DB外ファイルを blobs/ 配下の分類ディレクトリへ配置し、参照情報（相対パス・
 * sha256・MIME・サイズ）を blob_resource + entity_registry で管理する。
 */
import type { Database } from 'better-sqlite3'
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { BackendError } from '../api/errors'
import { blobDir, type BlobCategory } from '../project/layout'
import { registerEntity } from './entity-registry'

const MIME_BY_EXT: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.vsdx': 'application/vnd.ms-visio.drawing',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.json': 'application/json',
  '.jsonl': 'application/x-ndjson',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip'
}

export function mimeTypeOf(fileName: string): string | null {
  return MIME_BY_EXT[extname(fileName).toLowerCase()] ?? null
}

export function sha256OfFile(filePath: string): string {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

export function sha256OfBuffer(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex')
}

export interface BlobInfo {
  uid: string
  code: string
  relativePath: string
  absolutePath: string
  mimeType: string | null
  byteSize: number
  sha256: string
}

export interface SaveBlobFromFileInput {
  projectUid: string
  projectRoot: string
  category: BlobCategory
  sourceFilePath: string
  /** originals のように uid サブディレクトリ + 元ファイル名で置く場合に指定 */
  preserveFileName?: boolean
  description?: string
  createdBy?: string
}

/**
 * ファイルを blobs/<category>/ へコピーし、blob_resource を登録する。
 * 配置規則（sdd_directory §6）:
 *  - originals: blobs/originals/<blob_uid>/<original_filename>（原本は改変しない）
 *  - その他:    blobs/<category>/<blob_uid><拡張子>
 */
export function saveBlobFromFile(db: Database, input: SaveBlobFromFileInput): BlobInfo {
  if (!existsSync(input.sourceFilePath)) {
    throw new BackendError('io', '取込対象ファイルが見つかりません', input.sourceFilePath)
  }
  const fileName = basename(input.sourceFilePath)
  const sha256 = sha256OfFile(input.sourceFilePath)
  const byteSize = statSync(input.sourceFilePath).size
  const mimeType = mimeTypeOf(fileName)

  const { uid, code } = registerEntity(db, {
    projectUid: input.projectUid,
    entityType: 'blob_resource',
    title: fileName,
    createdBy: input.createdBy,
    sourceHash: sha256
  })

  const relativePath = input.preserveFileName
    ? `blobs/${input.category}/${uid}/${fileName}`
    : `blobs/${input.category}/${uid}${extname(fileName).toLowerCase()}`
  const absolutePath = join(input.projectRoot, relativePath)
  mkdirSync(join(absolutePath, '..'), { recursive: true })
  copyFileSync(input.sourceFilePath, absolutePath)

  insertBlobRow(db, { uid, relativePath, mimeType, byteSize, sha256, description: input.description })
  return { uid, code, relativePath, absolutePath, mimeType, byteSize, sha256 }
}

export interface SaveBlobFromDataInput {
  projectUid: string
  projectRoot: string
  category: BlobCategory
  data: Buffer | string
  /** 拡張子を含むファイル名ヒント（例: result.jsonl） */
  fileNameHint: string
  description?: string
  createdBy?: string
}

/** メモリ上のデータを blob として保存する（ログ・派生成果物用） */
export function saveBlobFromData(db: Database, input: SaveBlobFromDataInput): BlobInfo {
  const sha256 = sha256OfBuffer(input.data)
  const byteSize = Buffer.isBuffer(input.data) ? input.data.length : Buffer.byteLength(input.data)
  const mimeType = mimeTypeOf(input.fileNameHint)

  const { uid, code } = registerEntity(db, {
    projectUid: input.projectUid,
    entityType: 'blob_resource',
    title: input.fileNameHint,
    createdBy: input.createdBy,
    sourceHash: sha256
  })

  const relativePath = `blobs/${input.category}/${uid}${extname(input.fileNameHint).toLowerCase()}`
  const absolutePath = join(input.projectRoot, relativePath)
  mkdirSync(blobDir(input.projectRoot, input.category), { recursive: true })
  writeFileSync(absolutePath, input.data)

  insertBlobRow(db, { uid, relativePath, mimeType, byteSize, sha256, description: input.description })
  return { uid, code, relativePath, absolutePath, mimeType, byteSize, sha256 }
}

function insertBlobRow(
  db: Database,
  row: {
    uid: string
    relativePath: string
    mimeType: string | null
    byteSize: number
    sha256: string
    description?: string
  }
): void {
  db.prepare(
    `INSERT INTO blob_resource (uid, relative_path, mime_type, byte_size, sha256, description)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(row.uid, row.relativePath, row.mimeType, row.byteSize, row.sha256, row.description ?? null)
}

export interface BlobVerifyResult {
  uid: string
  relativePath: string
  exists: boolean
  hashMatches: boolean | null
}

/** blob 参照先ファイルの存在とハッシュを検査する（manifest 生成の基礎。P12 で拡張） */
export function verifyBlob(db: Database, projectRoot: string, uid: string): BlobVerifyResult {
  const row = db.prepare('SELECT uid, relative_path, sha256 FROM blob_resource WHERE uid = ?').get(uid) as
    { uid: string; relative_path: string; sha256: string } | undefined
  if (!row) {
    throw new BackendError('not_found', `blob_resource が見つかりません: ${uid}`, '')
  }
  const absolutePath = join(projectRoot, row.relative_path)
  const exists = existsSync(absolutePath)
  return {
    uid: row.uid,
    relativePath: row.relative_path,
    exists,
    hashMatches: exists ? sha256OfFile(absolutePath) === row.sha256 : null
  }
}
