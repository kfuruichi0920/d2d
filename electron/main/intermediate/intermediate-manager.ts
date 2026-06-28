import { getDatabase } from '../db/database'
import { createEntityEntry, type EntityType } from '../store/entity-registry'
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
  code: string
  title: string
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
      `SELECT ii.uid, er.code, er.title, ii.intermediate_document_uid, ii.item_type, ii.resource_uid
       FROM intermediate_item ii
       JOIN entity_registry er ON er.uid = ii.uid
       WHERE ii.intermediate_document_uid = ?
       ORDER BY er.created_at ASC`
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
      `SELECT ei.uid, ei.item_type, er.title
       FROM extracted_item ei
       JOIN entity_registry er ON er.uid = ei.uid
       WHERE ei.extracted_document_uid = ?`
    )
    .all(extractedDocumentUid) as { uid: string; item_type: string; title: string }[]

  const midDoc = db
    .prepare(`SELECT code FROM entity_registry WHERE uid = ?`)
    .get(intermediateDocumentUid) as { code: string } | undefined
  const prefix = midDoc?.code ?? 'ITM'

  return withTransaction(() => {
    let inserted = 0
    for (const item of items) {
      inserted++
      const newUid = createEntityEntry({
        entityType: 'intermediate_item',
        code: `${prefix}-${String(inserted).padStart(4, '0')}`,
        title: item.title || item.item_type,
      })
      db.prepare(
        `INSERT INTO intermediate_item (uid, intermediate_document_uid, item_type, resource_uid)
         VALUES (?, ?, ?, ?)`
      ).run(newUid, intermediateDocumentUid, item.item_type, null)
    }
    db.prepare(
      `UPDATE intermediate_document SET intermediate_status = 'success', generated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid = ?`
    ).run(intermediateDocumentUid)
    return inserted
  })
}

export function addIntermediateItem(
  intermediateDocumentUid: string,
  itemType: string,
  title: string
): string {
  const db = getDatabase()
  const midDoc = db
    .prepare(`SELECT code FROM entity_registry WHERE uid = ?`)
    .get(intermediateDocumentUid) as { code: string } | undefined
  const prefix = midDoc?.code ?? 'ITM'
  const cnt = (db
    .prepare(`SELECT COUNT(*) AS c FROM intermediate_item WHERE intermediate_document_uid = ?`)
    .get(intermediateDocumentUid) as { c: number }).c

  return withTransaction(() => {
    const uid = createEntityEntry({
      entityType: 'intermediate_item',
      code: `${prefix}-${String(cnt + 1).padStart(4, '0')}`,
      title,
    })
    db.prepare(
      `INSERT INTO intermediate_item (uid, intermediate_document_uid, item_type, resource_uid) VALUES (?, ?, ?, NULL)`
    ).run(uid, intermediateDocumentUid, itemType)
    return uid
  })
}

export function deleteIntermediateItem(itemUid: string): void {
  withTransaction(() => {
    getDatabase().prepare(`DELETE FROM intermediate_item WHERE uid = ?`).run(itemUid)
    getDatabase().prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(itemUid)
  })
}

export function mergeIntermediateItems(
  itemUids: string[],
  keepUid: string,
  mergedTitle: string
): void {
  if (itemUids.length < 2) return
  const removeUids = itemUids.filter(u => u !== keepUid)
  withTransaction(() => {
    const db = getDatabase()
    db.prepare(`UPDATE entity_registry SET title = ? WHERE uid = ?`).run(mergedTitle, keepUid)
    for (const uid of removeUids) {
      db.prepare(`DELETE FROM intermediate_item WHERE uid = ?`).run(uid)
      db.prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(uid)
    }
  })
}

export function promoteItemToResource(
  itemUid: string,
  resourceType: string,
  title: string
): string {
  const db = getDatabase()
  const item = db
    .prepare(`SELECT intermediate_document_uid FROM intermediate_item WHERE uid = ?`)
    .get(itemUid) as { intermediate_document_uid: string } | undefined
  if (!item) throw new Error(`intermediate_item not found: ${itemUid}`)

  const midDoc = db
    .prepare(`SELECT code FROM entity_registry WHERE uid = ?`)
    .get(item.intermediate_document_uid) as { code: string } | undefined
  const prefix = midDoc?.code ?? 'RES'
  const cnt = (db
    .prepare(`SELECT COUNT(*) AS c FROM entity_registry WHERE entity_type = ?`)
    .get(resourceType) as { c: number }).c

  return withTransaction(() => {
    const resourceUid = createEntityEntry({
      entityType: resourceType as EntityType,
      code: `${prefix}-R-${String(cnt + 1).padStart(4, '0')}`,
      title,
    })

    // リソース種別テーブルに最小レコードを挿入
    switch (resourceType) {
      case 'resource_text':
        db.prepare(`INSERT INTO resource_text (uid, text_body) VALUES (?, ?)`).run(resourceUid, title)
        break
      case 'resource_label':
        db.prepare(`INSERT INTO resource_label (uid, label_text) VALUES (?, ?)`).run(resourceUid, title)
        break
      case 'resource_table':
        db.prepare(`INSERT INTO resource_table (uid) VALUES (?)`).run(resourceUid)
        break
      case 'resource_figure':
        db.prepare(`INSERT INTO resource_figure (uid, image_uri) VALUES (?, ?)`).run(resourceUid, '')
        break
      case 'resource_model':
        db.prepare(`INSERT INTO resource_model (uid) VALUES (?)`).run(resourceUid)
        break
      case 'resource_scenario':
        db.prepare(`INSERT INTO resource_scenario (uid) VALUES (?)`).run(resourceUid)
        break
      case 'resource_state_transition':
        db.prepare(`INSERT INTO resource_state_transition (uid) VALUES (?)`).run(resourceUid)
        break
      case 'resource_interface':
        db.prepare(`INSERT INTO resource_interface (uid) VALUES (?)`).run(resourceUid)
        break
      case 'resource_code':
        db.prepare(`INSERT INTO resource_code (uid, code_text) VALUES (?, ?)`).run(resourceUid, title)
        break
      case 'resource_list':
        db.prepare(`INSERT INTO resource_list (uid) VALUES (?)`).run(resourceUid)
        break
      default:
        db.prepare(`INSERT INTO resource_text (uid, text_body) VALUES (?, ?)`).run(resourceUid, title)
    }

    db.prepare(`UPDATE intermediate_item SET resource_uid = ? WHERE uid = ?`).run(resourceUid, itemUid)
    return resourceUid
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

export function renameIntermediateDocument(uid: string, title: string): void {
  getDatabase()
    .prepare(`UPDATE entity_registry SET title = ? WHERE uid = ?`)
    .run(title, uid)
}
