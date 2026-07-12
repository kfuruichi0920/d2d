/** 抽出レビュー状態の一括更新（P5-6、EXT-021/022/024）。 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'

export const EXTRACTED_REVIEW_STATUSES = ['draft', 'approved', 'review', 'rejected'] as const
export type ExtractedReviewStatus = (typeof EXTRACTED_REVIEW_STATUSES)[number]

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
    return result.changes
  })
  return { updatedCount: txn() }
}
