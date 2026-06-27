import { getDatabase } from '../db/database'
import { createEntityEntry } from '../store/entity-registry'
import { withTransaction } from '../store/store-access'

export interface CreateIntermediateOptions {
  sourceExtractedDocumentUid?: string
  artifactTypeId?: string
  devPhaseId?: string
  title?: string
}

export interface IntermediateDocumentRow {
  uid: string
  code: string
  title: string
  status: string
  source_extracted_document_uid: string | null
  artifact_type_id: string | null
  dev_phase_id: string | null
  intermediate_status: string
  item_count: number
  generated_at: string | null
}

export interface IntermediateItemRow {
  uid: string
  intermediate_document_uid: string
  item_type: string
  resource_uid: string | null
}

let _midDocCounter: number | null = null

function nextMidCode(): string {
  const db = getDatabase()
  if (_midDocCounter === null) {
    const row = db
      .prepare(`SELECT COUNT(*) AS cnt FROM intermediate_document`)
      .get() as { cnt: number }
    _midDocCounter = row.cnt
  }
  _midDocCounter += 1
  return `MID-${String(_midDocCounter).padStart(4, '0')}`
}

export function createIntermediateDocument(opts: CreateIntermediateOptions): string {
  const code = nextMidCode()
  const title = opts.title ?? `中間データ ${code}`

  return withTransaction(() => {
    const uid = createEntityEntry({
      entityType: 'intermediate_document',
      code,
      title,
    })
    getDatabase()
      .prepare(
        `INSERT INTO intermediate_document
         (uid, source_extracted_document_uid, artifact_type_id, dev_phase_id,
          intermediate_status, processor_name, processor_version)
         VALUES (?, ?, ?, ?, 'pending', 'manual', '1.0')`
      )
      .run(
        uid,
        opts.sourceExtractedDocumentUid ?? null,
        opts.artifactTypeId ?? null,
        opts.devPhaseId ?? null
      )
    return uid
  })
}

export function listIntermediateDocuments(): IntermediateDocumentRow[] {
  return getDatabase()
    .prepare(
      `SELECT
         id.uid, er.code, er.title, er.status,
         id.source_extracted_document_uid, id.artifact_type_id, id.dev_phase_id,
         id.intermediate_status, id.generated_at,
         COUNT(ii.uid) AS item_count
       FROM intermediate_document id
       JOIN entity_registry er ON er.uid = id.uid
       LEFT JOIN intermediate_item ii ON ii.intermediate_document_uid = id.uid
       GROUP BY id.uid
       ORDER BY er.created_at DESC`
    )
    .all() as IntermediateDocumentRow[]
}

export function getIntermediateDocument(uid: string): IntermediateDocumentRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT
         id.uid, er.code, er.title, er.status,
         id.source_extracted_document_uid, id.artifact_type_id, id.dev_phase_id,
         id.intermediate_status, id.generated_at,
         COUNT(ii.uid) AS item_count
       FROM intermediate_document id
       JOIN entity_registry er ON er.uid = id.uid
       LEFT JOIN intermediate_item ii ON ii.intermediate_document_uid = id.uid
       WHERE id.uid = ?
       GROUP BY id.uid`
    )
    .get(uid) as IntermediateDocumentRow | undefined
}

export function listIntermediateItems(intermediateDocumentUid: string): IntermediateItemRow[] {
  return getDatabase()
    .prepare(
      `SELECT ii.uid, ii.intermediate_document_uid, ii.item_type, ii.resource_uid
       FROM intermediate_item ii
       WHERE ii.intermediate_document_uid = ?`
    )
    .all(intermediateDocumentUid) as IntermediateItemRow[]
}

export function promoteFromExtracted(
  extractedDocumentUid: string,
  intermediateDocumentUid: string
): number {
  const db = getDatabase()
  const items = db
    .prepare(
      `SELECT uid, item_type FROM extracted_item WHERE extracted_document_uid = ?`
    )
    .all(extractedDocumentUid) as { uid: string; item_type: string }[]

  return withTransaction(() => {
    let inserted = 0
    for (const item of items) {
      const newUid = createEntityEntry({
        entityType: 'intermediate_item',
        code: `ITM-${Date.now()}-${inserted}`,
        title: item.item_type,
      })
      db.prepare(
        `INSERT INTO intermediate_item (uid, intermediate_document_uid, item_type, resource_uid)
         VALUES (?, ?, ?, ?)`
      ).run(newUid, intermediateDocumentUid, item.item_type, null)
      inserted++
    }
    db.prepare(
      `UPDATE intermediate_document SET intermediate_status = 'success', generated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid = ?`
    ).run(intermediateDocumentUid)
    return inserted
  })
}

export function updateIntermediateStatus(
  uid: string,
  status: 'pending' | 'running' | 'success' | 'failed' | 'partial'
): void {
  getDatabase()
    .prepare(`UPDATE intermediate_document SET intermediate_status = ? WHERE uid = ?`)
    .run(status, uid)
}
