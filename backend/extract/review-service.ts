/** 抽出レビュー状態の一括更新（P5-6、EXT-021/022/024）。 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'

export const EXTRACTED_REVIEW_STATUSES = ['draft', 'approved', 'review', 'rejected'] as const
export type ExtractedReviewStatus = (typeof EXTRACTED_REVIEW_STATUSES)[number]

/** 子要素の状態を正本として抽出文書の状態へ集約する（EXT-041）。 */
export function syncExtractedDocumentStatus(db: Database, extractedDocumentUid: string): 'draft' | 'approved' {
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN e.status = 'approved' THEN 0 ELSE 1 END) AS unconfirmed
         FROM extracted_item i JOIN entity_registry e ON e.uid=i.resource_uid
        WHERE i.extracted_document_uid=? AND e.status <> 'deleted'`
    )
    .get(extractedDocumentUid) as { total: number; unconfirmed: number | null }
  const status = counts.total > 0 && (counts.unconfirmed ?? 0) === 0 ? 'approved' : 'draft'
  db.prepare(
    `UPDATE entity_registry SET status=?, updated_at=?, updated_by='system'
      WHERE uid=? AND entity_type='extracted_document' AND status <> 'deleted'`
  ).run(status, new Date().toISOString(), extractedDocumentUid)
  return status
}
export function updateExtractedItemStatuses(
  db: Database,
  extractedDocumentUid: string,
  resourceUids: string[],
  status: string
): { updatedCount: number } {
  if (!EXTRACTED_REVIEW_STATUSES.includes(status as ExtractedReviewStatus)) {
    throw new BackendError('validation', `不正なレビュー状態です: ${status}`, '')
  }
  const uniqueUids = [...new Set(resourceUids.filter(Boolean))]
  if (uniqueUids.length === 0) throw new BackendError('validation', '更新対象の抽出要素がありません', '')

  const placeholders = uniqueUids.map(() => '?').join(',')
  const txn = db.transaction(() => {
    const result = db
      .prepare(
        `UPDATE entity_registry
            SET status = ?, updated_by = 'user', updated_at = ?
          WHERE uid IN (${placeholders})
            AND uid IN (SELECT resource_uid FROM extracted_item WHERE extracted_document_uid = ?)`
      )
      .run(status, new Date().toISOString(), ...uniqueUids, extractedDocumentUid)
    if (result.changes !== uniqueUids.length) {
      throw new BackendError('not_found', '抽出文書に属さない要素が含まれています', extractedDocumentUid)
    }
    syncExtractedDocumentStatus(db, extractedDocumentUid)
    return result.changes
  })
  return { updatedCount: txn() }
}
/** 抽出文書の表示名称だけを変更する（P5-15、EXT-040）。原本名・blob・由来は変更しない。 */
export function renameExtractedDocument(
  db: Database,
  projectUid: string,
  extractedDocumentUid: string,
  title: string
): { title: string } {
  const normalized = title.trim()
  if (!normalized) throw new BackendError('validation', '抽出データの名称を入力してください', '')
  if (normalized.length > 200) throw new BackendError('validation', '抽出データの名称は200文字以内です', '')
  const result = db
    .prepare(
      `UPDATE entity_registry
          SET title = ?, updated_by = 'user', updated_at = ?
        WHERE uid = ? AND project_uid = ? AND entity_type = 'extracted_document' AND status <> 'deleted'`
    )
    .run(normalized, new Date().toISOString(), extractedDocumentUid, projectUid)
  if (result.changes !== 1) {
    throw new BackendError('not_found', `抽出文書が見つかりません: ${extractedDocumentUid}`, '')
  }
  return { title: normalized }
}
