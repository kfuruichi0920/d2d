import { copyFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { basename, extname, join } from 'path'
import { getDatabase } from '../db/database'
import { getCurrentProjectRoot } from '../project/project-manager'
import { generateUid } from '../utils/uuid'
import { sha256File } from '../utils/hash'
import { createEntityEntry } from '../store/entity-registry'
import { withTransaction } from '../store/store-access'

export interface ImportedDocument {
  sourceDocumentUid: string
  blobUid: string
  fileName: string
  fileType: string
  fileHash: string
  blobPath: string
}

const FILE_TYPE_MAP: Record<string, string> = {
  '.docx': 'word',
  '.doc': 'word',
  '.xlsx': 'excel',
  '.xls': 'excel',
  '.pptx': 'powerpoint',
  '.ppt': 'powerpoint',
  '.vsdx': 'visio',
  '.vsd': 'visio',
  '.pdf': 'pdf',
  '.txt': 'text',
  '.md': 'markdown',
  '.csv': 'csv',
  '.tsv': 'tsv',
  '.json': 'json',
  '.jsonl': 'jsonl',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.zip': 'zip'
}

function blobsDir(): string {
  const root = getCurrentProjectRoot()
  if (!root) throw new Error('No project is open')
  return join(root, 'blobs', 'originals')
}

function nextSourceCode(): string {
  const db = getDatabase()
  const row = db
    .prepare(`SELECT COUNT(*) as cnt FROM entity_registry WHERE entity_type = 'source_document'`)
    .get() as { cnt: number }
  return `SRC-${String(row.cnt + 1).padStart(4, '0')}`
}

export async function importDocument(filePath: string): Promise<ImportedDocument> {
  if (!existsSync(filePath)) throw new Error(`File not found: ${filePath}`)

  const fileName = basename(filePath)
  const ext = extname(fileName).toLowerCase()
  const fileType = FILE_TYPE_MAP[ext] ?? 'unknown'
  const fileHash = await sha256File(filePath)

  // 同一ハッシュが既にインポート済みか確認
  const db = getDatabase()
  const existing = db
    .prepare(`SELECT uid FROM source_document WHERE file_hash = ?`)
    .get(fileHash) as { uid: string } | undefined
  if (existing) {
    throw new Error(`This file is already imported (source_document uid: ${existing.uid})`)
  }

  // blob ファイルをコピー
  const blobDir = blobsDir()
  mkdirSync(blobDir, { recursive: true })
  const blobUid = generateUid()
  const blobFileName = `${blobUid}${ext}`
  const blobPath = join(blobDir, blobFileName)
  copyFileSync(filePath, blobPath)

  const fileStat = statSync(blobPath)
  const relativeBlobPath = join('blobs', 'originals', blobFileName)
  const code = nextSourceCode()
  const now = new Date().toISOString()

  const result = withTransaction((db) => {
    // entity_registry: blob_resource
    const blobEntityUid = createEntityEntry({
      entityType: 'blob_resource',
      code: `BLOB-${blobUid.slice(0, 8)}`,
      title: fileName,
      sourceHash: fileHash
    })

    // blob_resource
    db.prepare(
      `INSERT INTO blob_resource (uid, relative_path, mime_type, byte_size, sha256, description)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(blobEntityUid, relativeBlobPath, mimeType(ext), fileStat.size, fileHash, null)

    // entity_registry: source_document
    const srcEntityUid = createEntityEntry({
      entityType: 'source_document',
      code,
      title: fileName,
      sourceHash: fileHash
    })

    // source_document
    db.prepare(
      `INSERT INTO source_document
       (uid, file_name, file_type, blob_uid, file_hash, version_label, imported_at, is_current)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(srcEntityUid, fileName, fileType, blobEntityUid, fileHash, null, now)

    return {
      sourceDocumentUid: srcEntityUid,
      blobUid: blobEntityUid,
      fileName,
      fileType,
      fileHash,
      blobPath: relativeBlobPath
    } satisfies ImportedDocument
  })

  return result
}

export function listDocuments(): unknown[] {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT sd.uid, sd.file_name, sd.file_type, sd.file_hash, sd.imported_at,
              er.code, er.status, er.title
       FROM source_document sd
       JOIN entity_registry er ON er.uid = sd.uid
       WHERE er.status != 'deleted'
       ORDER BY sd.imported_at DESC`
    )
    .all()
}

export function getDocument(uid: string): unknown {
  const db = getDatabase()
  return db
    .prepare(
      `SELECT sd.*, er.code, er.status, er.title
       FROM source_document sd
       JOIN entity_registry er ON er.uid = sd.uid
       WHERE sd.uid = ?`
    )
    .get(uid)
}

function mimeType(ext: string): string {
  const map: Record<string, string> = {
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.json': 'application/json',
    '.jsonl': 'application/jsonl',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.zip': 'application/zip'
  }
  return map[ext] ?? 'application/octet-stream'
}
