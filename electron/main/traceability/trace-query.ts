import { getDatabase } from '../db/database'
import type { RelationType } from '../design/trace-manager'

export interface TraceNode {
  uid: string
  title: string
  entity_type: string
  depth: number
}

export interface TraceEdge {
  uid: string
  from_uid: string
  to_uid: string
  relation_type: RelationType
  direction: string
  confidence: number | null
}

export interface TraceGraph {
  nodes: TraceNode[]
  edges: TraceEdge[]
}

export interface TraceMatrixEntry {
  from_uid: string
  from_title: string
  from_type: string
  to_uid: string
  to_title: string
  to_type: string
  relation_type: RelationType
  confidence: number | null
}

// ---- 双方向サブグラフ（enhanced） ----

export function findSubgraph(
  rootUid: string,
  opts?: {
    maxDepth?: number
    direction?: 'forward' | 'backward' | 'both'
    relationTypes?: RelationType[]
    entityTypes?: string[]
  }
): TraceGraph {
  const db = getDatabase()
  const maxDepth = opts?.maxDepth ?? 3
  const direction = opts?.direction ?? 'both'

  const typeFilter =
    opts?.relationTypes && opts.relationTypes.length > 0
      ? `AND tl.relation_type IN (${opts.relationTypes.map(() => "'?'").join(',')})`
      : ''

  // 再帰CTE: forward / backward / both を切り替える
  const forwardCte = direction !== 'backward'
    ? `
      UNION
      SELECT tl.to_uid, sg.depth + 1
      FROM trace_link tl
      JOIN subgraph sg ON sg.uid = tl.from_uid
      WHERE sg.depth < ${maxDepth} ${typeFilter}`
    : ''

  const backwardCte = direction !== 'forward'
    ? `
      UNION
      SELECT tl.from_uid, sg.depth + 1
      FROM trace_link tl
      JOIN subgraph sg ON sg.uid = tl.to_uid
      WHERE sg.depth < ${maxDepth} ${typeFilter}`
    : ''

  const typeParams = opts?.relationTypes ?? []

  const nodes = db
    .prepare(
      `WITH RECURSIVE subgraph(uid, depth) AS (
         SELECT ? AS uid, 0
         ${forwardCte}
         ${backwardCte}
       )
       SELECT DISTINCT sg.uid, sg.depth, er.title, er.entity_type
       FROM subgraph sg
       JOIN entity_registry er ON er.uid = sg.uid`
    )
    .all(
      rootUid,
      ...typeParams,
      ...typeParams
    ) as TraceNode[]

  const nodeUids = nodes.map((n) => n.uid)
  if (nodeUids.length === 0) return { nodes: [], edges: [] }

  const ph = nodeUids.map(() => '?').join(',')
  const edges = db
    .prepare(
      `SELECT uid, from_uid, to_uid, relation_type, direction, confidence
       FROM trace_link
       WHERE from_uid IN (${ph}) AND to_uid IN (${ph})`
    )
    .all(...nodeUids, ...nodeUids) as TraceEdge[]

  // entityTypes フィルタ（ノード絞り込み）
  const filteredNodes =
    opts?.entityTypes && opts.entityTypes.length > 0
      ? nodes.filter((n) => opts.entityTypes!.includes(n.entity_type))
      : nodes

  return { nodes: filteredNodes, edges }
}

// ---- 影響分析: 変更したとき何が影響を受けるか ----

export function findImpacted(uid: string, maxDepth = 5): TraceNode[] {
  return findSubgraph(uid, { maxDepth, direction: 'forward' }).nodes.filter(
    (n) => n.uid !== uid
  )
}

// ---- ルート探索: この要素の根拠は何か ----

export function findRoots(uid: string, maxDepth = 5): TraceNode[] {
  return findSubgraph(uid, { maxDepth, direction: 'backward' }).nodes.filter(
    (n) => n.uid !== uid
  )
}

// ---- トレースマトリクス: 2種のエンティティタイプ間の全リンク ----

export function buildMatrix(
  fromEntityTypes?: string[],
  toEntityTypes?: string[],
  relationTypes?: RelationType[]
): TraceMatrixEntry[] {
  const db = getDatabase()
  const conditions: string[] = []
  const params: unknown[] = []

  if (fromEntityTypes && fromEntityTypes.length > 0) {
    conditions.push(`ef.entity_type IN (${fromEntityTypes.map(() => '?').join(',')})`)
    params.push(...fromEntityTypes)
  }
  if (toEntityTypes && toEntityTypes.length > 0) {
    conditions.push(`et.entity_type IN (${toEntityTypes.map(() => '?').join(',')})`)
    params.push(...toEntityTypes)
  }
  if (relationTypes && relationTypes.length > 0) {
    conditions.push(`tl.relation_type IN (${relationTypes.map(() => '?').join(',')})`)
    params.push(...relationTypes)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  return db
    .prepare(
      `SELECT tl.from_uid, ef.title AS from_title, ef.entity_type AS from_type,
              tl.to_uid, et.title AS to_title, et.entity_type AS to_type,
              tl.relation_type, tl.confidence
       FROM trace_link tl
       JOIN entity_registry ef ON ef.uid = tl.from_uid
       JOIN entity_registry et ON et.uid = tl.to_uid
       ${where}
       ORDER BY ef.title, et.title`
    )
    .all(...params) as TraceMatrixEntry[]
}

// ---- 指定エンティティの全直接リンクカウント ----

export function linkStats(): { relation_type: string; count: number }[] {
  return getDatabase()
    .prepare(
      `SELECT relation_type, COUNT(*) AS count FROM trace_link GROUP BY relation_type ORDER BY count DESC`
    )
    .all() as { relation_type: string; count: number }[]
}
