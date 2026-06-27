import { getDatabase } from '../db/database'
import { createEntityEntry } from '../store/entity-registry'
import { withTransaction } from '../store/store-access'

export interface ChunkRow {
  uid: string
  code: string
  intermediate_document_uid: string
  token_count: number
  item_count: number
  created_at: string
}

export interface ChunkItemRow {
  uid: string
  chunk_uid: string
  intermediate_item_uid: string
  sort_order: number
}

export function createChunk(
  intermediateDocumentUid: string,
  intermediateItemUids: string[],
  tokenCount: number = 0
): string {
  return withTransaction(() => {
    const db = getDatabase()
    const cnt = (
      db
        .prepare(`SELECT COUNT(*) AS cnt FROM chunk WHERE intermediate_document_uid = ?`)
        .get(intermediateDocumentUid) as { cnt: number }
    ).cnt
    const code = `CHK-${String(cnt + 1).padStart(4, '0')}`

    const chunkUid = createEntityEntry({
      entityType: 'chunk',
      code,
      title: `チャンク ${code}`,
    })

    db.prepare(
      `INSERT INTO chunk (uid, intermediate_document_uid, token_count) VALUES (?, ?, ?)`
    ).run(chunkUid, intermediateDocumentUid, tokenCount)

    let sortOrder = 0
    for (const itemUid of intermediateItemUids) {
      const ciUid = createEntityEntry({
        entityType: 'chunk_item',
        code: `${code}-${sortOrder}`,
        title: `chunk_item`,
      })
      db.prepare(
        `INSERT INTO chunk_item (uid, chunk_uid, intermediate_item_uid, sort_order)
         VALUES (?, ?, ?, ?)`
      ).run(ciUid, chunkUid, itemUid, sortOrder++)
    }

    return chunkUid
  })
}

export function listChunks(intermediateDocumentUid: string): ChunkRow[] {
  return getDatabase()
    .prepare(
      `SELECT c.uid, er.code, c.intermediate_document_uid, c.token_count, c.created_at,
              COUNT(ci.uid) AS item_count
       FROM chunk c
       JOIN entity_registry er ON er.uid = c.uid
       LEFT JOIN chunk_item ci ON ci.chunk_uid = c.uid
       WHERE c.intermediate_document_uid = ?
       GROUP BY c.uid
       ORDER BY c.created_at`
    )
    .all(intermediateDocumentUid) as ChunkRow[]
}

export function getChunkItems(chunkUid: string): ChunkItemRow[] {
  return getDatabase()
    .prepare(
      `SELECT uid, chunk_uid, intermediate_item_uid, sort_order
       FROM chunk_item WHERE chunk_uid = ? ORDER BY sort_order`
    )
    .all(chunkUid) as ChunkItemRow[]
}

export function addChunkItem(
  chunkUid: string,
  intermediateItemUid: string,
  sortOrder: number
): string {
  return withTransaction(() => {
    const uid = createEntityEntry({
      entityType: 'chunk_item',
      code: `ci-${Date.now()}`,
      title: 'chunk_item',
    })
    getDatabase()
      .prepare(
        `INSERT INTO chunk_item (uid, chunk_uid, intermediate_item_uid, sort_order)
         VALUES (?, ?, ?, ?)`
      )
      .run(uid, chunkUid, intermediateItemUid, sortOrder)
    return uid
  })
}

export function removeChunkItem(chunkUid: string, intermediateItemUid: string): void {
  getDatabase()
    .prepare(`DELETE FROM chunk_item WHERE chunk_uid = ? AND intermediate_item_uid = ?`)
    .run(chunkUid, intermediateItemUid)
}

export function deleteChunk(uid: string): void {
  withTransaction(() => {
    const db = getDatabase()
    db.prepare(`DELETE FROM chunk_item WHERE chunk_uid = ?`).run(uid)
    db.prepare(`DELETE FROM chunk WHERE uid = ?`).run(uid)
    db.prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(uid)
  })
}

export function updateChunkTokenCount(uid: string, tokenCount: number): void {
  getDatabase()
    .prepare(`UPDATE chunk SET token_count = ? WHERE uid = ?`)
    .run(tokenCount, uid)
}
