import { getDatabase } from '../db/database'
import { createEntityEntry } from '../store/entity-registry'
import { withTransaction } from '../store/store-access'

export type RelationType =
  | 'derived_from'
  | 'normalized_from'
  | 'based_on'
  | 'satisfies'
  | 'verifies'
  | 'depends_on'
  | 'refines'
  | 'relates_to'

export interface TraceLinkRow {
  uid: string
  from_uid: string
  to_uid: string
  relation_type: RelationType
  direction: 'forward' | 'bidirectional'
  rationale: string | null
  confidence: number | null
  created_by: string | null
  from_title: string
  from_entity_type: string
  to_title: string
  to_entity_type: string
}

let _traceLinkCounter: number | null = null

function nextTlCode(): string {
  const db = getDatabase()
  if (_traceLinkCounter === null) {
    const row = db.prepare(`SELECT COUNT(*) AS cnt FROM trace_link`).get() as { cnt: number }
    _traceLinkCounter = row.cnt
  }
  _traceLinkCounter += 1
  return `TRL-${String(_traceLinkCounter).padStart(5, '0')}`
}

export function createTraceLink(
  fromUid: string,
  toUid: string,
  relationType: RelationType,
  opts?: { rationale?: string; confidence?: number; direction?: 'forward' | 'bidirectional'; createdBy?: string }
): string {
  return withTransaction(() => {
    const code = nextTlCode()
    const uid = createEntityEntry({ entityType: 'trace_link', code, title: `${relationType}: ${fromUid}→${toUid}` })
    getDatabase()
      .prepare(
        `INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, direction, rationale, confidence, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        uid,
        fromUid,
        toUid,
        relationType,
        opts?.direction ?? 'forward',
        opts?.rationale ?? null,
        opts?.confidence ?? null,
        opts?.createdBy ?? null
      )
    return uid
  })
}

export function listTraceLinks(uid: string, direction: 'from' | 'to' | 'both' = 'both'): TraceLinkRow[] {
  const db = getDatabase()
  const conditions: string[] = []
  if (direction === 'from' || direction === 'both') conditions.push(`tl.from_uid = '${uid}'`)
  if (direction === 'to' || direction === 'both') conditions.push(`tl.to_uid = '${uid}'`)
  const where = conditions.join(' OR ')

  return db
    .prepare(
      `SELECT tl.uid, tl.from_uid, tl.to_uid, tl.relation_type, tl.direction,
              tl.rationale, tl.confidence, tl.created_by,
              ef.title AS from_title, ef.entity_type AS from_entity_type,
              et.title AS to_title, et.entity_type AS to_entity_type
       FROM trace_link tl
       JOIN entity_registry ef ON ef.uid = tl.from_uid
       JOIN entity_registry et ON et.uid = tl.to_uid
       WHERE (${where})`
    )
    .all() as TraceLinkRow[]
}

export function deleteTraceLink(uid: string): void {
  withTransaction(() => {
    const db = getDatabase()
    db.prepare(`DELETE FROM trace_link WHERE uid = ?`).run(uid)
    db.prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(uid)
  })
}

export interface SubgraphNode {
  uid: string
  title: string
  entity_type: string
  depth: number
}

export interface SubgraphEdge {
  uid: string
  from_uid: string
  to_uid: string
  relation_type: RelationType
}

export function getTraceSubgraph(
  rootUid: string,
  maxDepth: number = 3,
  relationTypes?: RelationType[]
): { nodes: SubgraphNode[]; edges: SubgraphEdge[] } {
  const db = getDatabase()
  const typeFilter =
    relationTypes && relationTypes.length > 0
      ? `AND tl.relation_type IN (${relationTypes.map(() => '?').join(',')})`
      : ''

  const rows = db
    .prepare(
      `WITH RECURSIVE subgraph(uid, depth) AS (
         SELECT ? AS uid, 0 AS depth
         UNION
         SELECT tl.to_uid, sg.depth + 1
         FROM trace_link tl
         JOIN subgraph sg ON sg.uid = tl.from_uid
         WHERE sg.depth < ? ${typeFilter}
         UNION
         SELECT tl.from_uid, sg.depth + 1
         FROM trace_link tl
         JOIN subgraph sg ON sg.uid = tl.to_uid
         WHERE sg.depth < ? ${typeFilter}
       )
       SELECT DISTINCT sg.uid, sg.depth, er.title, er.entity_type
       FROM subgraph sg
       JOIN entity_registry er ON er.uid = sg.uid`
    )
    .all(rootUid, maxDepth, ...(relationTypes ?? []), maxDepth, ...(relationTypes ?? [])) as SubgraphNode[]

  const nodeUids = rows.map((n) => n.uid)
  if (nodeUids.length === 0) return { nodes: [], edges: [] }

  const placeholders = nodeUids.map(() => '?').join(',')
  const edges = db
    .prepare(
      `SELECT uid, from_uid, to_uid, relation_type
       FROM trace_link
       WHERE from_uid IN (${placeholders}) AND to_uid IN (${placeholders})`
    )
    .all(...nodeUids, ...nodeUids) as SubgraphEdge[]

  return { nodes: rows, edges }
}

export function traceLinkExists(fromUid: string, toUid: string, relationType: RelationType): boolean {
  const row = getDatabase()
    .prepare(`SELECT 1 FROM trace_link WHERE from_uid = ? AND to_uid = ? AND relation_type = ?`)
    .get(fromUid, toUid, relationType)
  return row !== undefined
}
