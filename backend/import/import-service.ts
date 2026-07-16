/**
 * ①原本インポート・抽出済み判定（P4-1 / P4-2、IMP-001〜009、UI-010 / UI-046）。
 * 原本を改変せず blobs/originals/ へコピーし、source_document を登録する。
 */
import type { Database } from 'better-sqlite3'
import { basename, extname } from 'node:path'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'
import { saveBlobFromFile } from '../store/blob-store'
import { registerEntity } from '../store/entity-registry'
import { newUid } from '../store/uid'

/** 拡張子 → source_document.file_type（sdd_data_structure §7 CHECK 値） */
const FILE_TYPE_BY_EXT: Record<string, string> = {
  '.docx': 'word',
  '.xlsx': 'excel',
  '.pptx': 'powerpoint',
  '.vsdx': 'visio',
  '.pdf': 'pdf',
  '.txt': 'text',
  '.md': 'markdown',
  '.csv': 'csv',
  '.tsv': 'csv',
  '.json': 'json',
  '.jsonl': 'json'
}

export function fileTypeOf(fileName: string): string {
  return FILE_TYPE_BY_EXT[extname(fileName).toLowerCase()] ?? 'other'
}

/** 旧バイナリ形式は対象外（SRS §3.1 *2） */
const REJECTED_EXTS = new Set(['.doc', '.xls', '.ppt', '.vsd'])

export interface ImportResult {
  sourceDocumentUid: string
  code: string
  fileName: string
  fileType: string
  fileHash: string
  blobUid: string
}

export function importSourceDocument(
  db: Database,
  projectUid: string,
  projectRoot: string,
  filePath: string
): ImportResult {
  const fileName = basename(filePath)
  const ext = extname(fileName).toLowerCase()
  if (REJECTED_EXTS.has(ext)) {
    throw new BackendError(
      'validation',
      `旧バイナリ形式（${ext}）は対象外です`,
      'OpenXML 系形式（.docx / .xlsx / .pptx / .vsdx）へ変換してから取り込んでください（SRS §3.1）'
    )
  }

  const txn = db.transaction((): ImportResult => {
    // 取込実行単位（batch_operation_info）
    const batchUid = newUid()
    db.prepare(
      `INSERT INTO batch_operation_info (uid, project_uid, batch_type, status, executed_by) VALUES (?, ?, 'import', 'running', 'user')`
    ).run(batchUid, projectUid)

    // 原本を無改変コピー（IMP-009）。SHA-256 は blob 保存時に計算（IMP-008）
    const blob = saveBlobFromFile(db, {
      projectUid,
      projectRoot,
      category: 'originals',
      sourceFilePath: filePath,
      preserveFileName: true,
      createdBy: 'user'
    })

    // 同一ハッシュの既存原本は is_current=0 に落とす（同一性管理）
    db.prepare(
      `UPDATE source_document SET is_current = 0
        WHERE file_hash = ? AND uid IN (SELECT uid FROM entity_registry WHERE project_uid = ?)`
    ).run(blob.sha256, projectUid)

    const { uid, code } = registerEntity(db, {
      projectUid,
      entityType: 'source_document',
      title: fileName,
      createdBy: 'user',
      batchOperationUid: batchUid,
      sourceHash: blob.sha256
    })
    db.prepare(
      `INSERT INTO source_document (uid, file_name, file_type, blob_uid, file_hash, is_current) VALUES (?, ?, ?, ?, ?, 1)`
    ).run(uid, fileName, fileTypeOf(fileName), blob.uid, blob.sha256)

    db.prepare(`UPDATE batch_operation_info SET status = 'success', completed_at = ? WHERE uid = ?`).run(
      new Date().toISOString(),
      batchUid
    )

    return {
      sourceDocumentUid: uid,
      code,
      fileName,
      fileType: fileTypeOf(fileName),
      fileHash: blob.sha256,
      blobUid: blob.uid
    }
  })

  const result = txn()
  eventBus.emit('source.imported', result)
  return result
}

export interface SourceDocumentListItem {
  uid: string
  code: string
  title: string | null
  status: string
  is_archived: number
  file_name: string
  file_type: string
  file_hash: string
  is_current: number
  imported_at: string
  has_extracted_data: number
}

export function listSourceDocuments(
  db: Database,
  projectUid: string,
  options?: { includeArchived?: boolean }
): SourceDocumentListItem[] {
  return db
    .prepare(
      `SELECT e.uid, e.code, e.title, e.status, e.is_archived, d.file_name, d.file_type, d.file_hash, d.is_current, d.imported_at,
              EXISTS(SELECT 1 FROM extracted_document x WHERE x.source_document_uid = d.uid) AS has_extracted_data
         FROM source_document d
         JOIN entity_registry e ON e.uid = d.uid
        WHERE e.project_uid = ? AND e.status <> 'deleted' AND (? = 1 OR e.is_archived = 0)
        ORDER BY d.imported_at DESC`
    )
    .all(projectUid, options?.includeArchived ? 1 : 0) as SourceDocumentListItem[]
}

export function getSourceDocument(
  db: Database,
  uid: string
): SourceDocumentListItem & { blob_relative_path: string | null } {
  const row = db
    .prepare(
      `SELECT e.uid, e.code, e.title, e.status, e.is_archived, d.file_name, d.file_type, d.file_hash, d.is_current, d.imported_at,
              EXISTS(SELECT 1 FROM extracted_document x WHERE x.source_document_uid = d.uid) AS has_extracted_data,
              b.relative_path AS blob_relative_path
         FROM source_document d
         JOIN entity_registry e ON e.uid = d.uid
         LEFT JOIN blob_resource b ON b.uid = d.blob_uid
        WHERE d.uid = ?`
    )
    .get(uid) as (SourceDocumentListItem & { blob_relative_path: string | null }) | undefined
  if (!row) {
    throw new BackendError('not_found', `原本が見つかりません: ${uid}`, '')
  }
  return row
}
