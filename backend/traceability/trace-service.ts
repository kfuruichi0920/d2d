/**
 * トレーサビリティ機能（P9、TRACE-001〜025、srs §2.3 検査）。
 * SQLite 再帰 CTE（WITH RECURSIVE）で trace_link を走査する
 * （sdd_function_architecture §5.2。GraphDB 移行は将来オプション TBD-07）。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { RELATION_TYPES } from '../design/design-service'

export type TraceDirection = 'forward' | 'backward' | 'both'

export interface TraceNode {
  uid: string
  code: string
  title: string | null
  entity_type: string
  model_type: string | null
  status: string
  hop: number
}

export interface TraceEdge {
  uid: string
  from_uid: string
  to_uid: string
  relation_type: string
  review_status: string | null
  rationale: string | null
}

export interface TraceSubgraph {
  root: string
  direction: TraceDirection
  depth: number
  nodes: TraceNode[]
  edges: TraceEdge[]
  /** 深さ・件数上限で打ち切った場合 true（段階展開の合図。§2.4） */
  truncated: boolean
}

const MAX_DEPTH = 10
const MAX_NODES = 500

export interface SubgraphQuery {
  rootUid: string
  depth?: number
  direction?: TraceDirection
  relationTypes?: string[]
}

/** 双方向トレース探索（TRACE-001〜003/022）。WITH RECURSIVE で hop 付きノード集合を得る */
export function getTraceSubgraph(db: Database, query: SubgraphQuery): TraceSubgraph {
  const depth = Math.min(Math.max(query.depth ?? 3, 1), MAX_DEPTH)
  const direction: TraceDirection = query.direction ?? 'both'
  const relationTypes = (query.relationTypes ?? []).filter((t) => RELATION_TYPES.includes(t as never))
  const relationFilter =
    relationTypes.length > 0 ? `AND t.relation_type IN (${relationTypes.map(() => '?').join(',')})` : ''

  const root = db.prepare(`SELECT uid FROM entity_registry WHERE uid = ? AND status <> 'deleted'`).get(query.rootUid)
  if (!root) {
    throw new BackendError('not_found', `起点要素が見つかりません: ${query.rootUid}`, '')
  }

  // 方向: forward = from→to（下流）、backward = to→from（上流）、both = 双方向
  const stepExpr =
    direction === 'forward'
      ? `t.from_uid = w.uid`
      : direction === 'backward'
        ? `t.to_uid = w.uid`
        : `(t.from_uid = w.uid OR t.to_uid = w.uid)`
  const nextExpr =
    direction === 'forward'
      ? `t.to_uid`
      : direction === 'backward'
        ? `t.from_uid`
        : `CASE WHEN t.from_uid = w.uid THEN t.to_uid ELSE t.from_uid END`

  const rows = db
    .prepare(
      `WITH RECURSIVE walk(uid, hop) AS (
         SELECT ?, 0
         UNION
         SELECT ${nextExpr}, w.hop + 1
           FROM walk w
           JOIN trace_link t ON ${stepExpr} ${relationFilter}
           JOIN entity_registry le ON le.uid = t.uid AND le.status <> 'deleted'
          WHERE w.hop < ?
       )
       SELECT e.uid, e.code, e.title, e.entity_type, e.entity_type AS model_type, e.status, MIN(w.hop) AS hop
         FROM walk w JOIN entity_registry e ON e.uid = w.uid
        WHERE e.status <> 'deleted'
        GROUP BY e.uid
        ORDER BY hop, e.code
        LIMIT ?`
    )
    .all(query.rootUid, ...relationTypes, depth, MAX_NODES + 1) as TraceNode[]

  const truncated = rows.length > MAX_NODES
  const nodes = rows.slice(0, MAX_NODES)
  const nodeSet = new Set(nodes.map((n) => n.uid))

  // 両端点がノード集合内にあるリンクをエッジとして返す
  const placeholders = nodes.map(() => '?').join(',')
  const edges =
    nodes.length === 0
      ? []
      : (db
          .prepare(
            `SELECT t.uid, t.from_uid, t.to_uid, t.relation_type, t.review_status, t.rationale
               FROM trace_link t JOIN entity_registry e ON e.uid = t.uid
              WHERE e.status <> 'deleted'
                AND t.from_uid IN (${placeholders}) AND t.to_uid IN (${placeholders})
                ${relationTypes.length > 0 ? `AND t.relation_type IN (${relationTypes.map(() => '?').join(',')})` : ''}`
          )
          .all(...nodes.map((n) => n.uid), ...nodes.map((n) => n.uid), ...relationTypes) as TraceEdge[])

  return {
    root: query.rootUid,
    direction,
    depth,
    nodes,
    edges: edges.filter((e) => nodeSet.has(e.from_uid) && nodeSet.has(e.to_uid)),
    truncated
  }
}

// ---- P9-4: トレースマトリクス ----

export interface TraceMatrix {
  rows: { uid: string; code: string; title: string | null }[]
  cols: { uid: string; code: string; title: string | null }[]
  /** rowUid -> colUid -> relation_type[] */
  cells: Record<string, Record<string, string[]>>
  relationType: string | null
}

export function getTraceMatrix(
  db: Database,
  projectUid: string,
  rowCategory: string,
  colCategory: string,
  relationType?: string
): TraceMatrix {
  const elements = (category: string): { uid: string; code: string; title: string | null }[] =>
    db
      .prepare(
        `SELECT uid, code, title FROM entity_registry
          WHERE project_uid = ? AND entity_type = ? AND status <> 'deleted' ORDER BY code`
      )
      .all(projectUid, category) as { uid: string; code: string; title: string | null }[]

  const rows = elements(rowCategory)
  const cols = elements(colCategory)
  const cells: Record<string, Record<string, string[]>> = {}
  if (rows.length > 0 && cols.length > 0) {
    const links = db
      .prepare(
        `SELECT t.from_uid, t.to_uid, t.relation_type
           FROM trace_link t
           JOIN entity_registry e ON e.uid = t.uid AND e.status <> 'deleted'
           JOIN entity_registry ef ON ef.uid = t.from_uid AND ef.entity_type = ?
           JOIN entity_registry et ON et.uid = t.to_uid AND et.entity_type = ?
          ${relationType ? 'WHERE t.relation_type = ?' : ''}`
      )
      .all(...(relationType ? [rowCategory, colCategory, relationType] : [rowCategory, colCategory])) as {
      from_uid: string
      to_uid: string
      relation_type: string
    }[]
    for (const link of links) {
      cells[link.from_uid] ??= {}
      ;(cells[link.from_uid]![link.to_uid] ??= []).push(link.relation_type)
    }
  }
  return { rows, cols, cells, relationType: relationType ?? null }
}

// ---- P9-6: 整合性検査（双方向トレーサビリティ分析。srs §2.3） ----

export interface ConsistencyProblem {
  kind: 'unconnected' | 'no_basis' | 'cycle' | 'provisional_link' | 'unverified_requirement'
  message: string
  uid: string
  code: string
  title: string | null
}

export function checkConsistency(db: Database, projectUid: string): ConsistencyProblem[] {
  const problems: ConsistencyProblem[] = []

  // 1) 未接続: 設計意味関係（based_on 以外）を一切持たない設計要素
  const unconnected = db
    .prepare(
      `SELECT e.uid, e.code, e.title FROM entity_registry e
        WHERE e.project_uid = ? AND e.entity_type LIKE 'model_%' AND e.status <> 'deleted'
          AND NOT EXISTS (
            SELECT 1 FROM trace_link t JOIN entity_registry le ON le.uid = t.uid AND le.status <> 'deleted'
             WHERE (t.from_uid = e.uid OR t.to_uid = e.uid) AND t.relation_type <> 'based_on'
          )`
    )
    .all(projectUid) as { uid: string; code: string; title: string | null }[]
  for (const e of unconnected) {
    problems.push({ kind: 'unconnected', message: `設計意味関係が未接続です: ${e.code}`, ...e })
  }

  // 2) 根拠不足: based_on（根拠リンク）を持たない設計要素
  const noBasis = db
    .prepare(
      `SELECT e.uid, e.code, e.title FROM entity_registry e
        WHERE e.project_uid = ? AND e.entity_type LIKE 'model_%' AND e.status <> 'deleted'
          AND NOT EXISTS (
            SELECT 1 FROM trace_link t JOIN entity_registry le ON le.uid = t.uid AND le.status <> 'deleted'
             WHERE t.from_uid = e.uid AND t.relation_type = 'based_on'
          )`
    )
    .all(projectUid) as { uid: string; code: string; title: string | null }[]
  for (const e of noBasis) {
    problems.push({ kind: 'no_basis', message: `根拠リンク（based_on）がありません: ${e.code}`, ...e })
  }

  // 3) 循環: 設計意味関係（based_on / conflicts_with / relates_to 除く）の有向閉路
  const edges = db
    .prepare(
      `SELECT t.from_uid, t.to_uid FROM trace_link t
         JOIN entity_registry le ON le.uid = t.uid AND le.status <> 'deleted'
         JOIN entity_registry ef ON ef.uid = t.from_uid AND ef.project_uid = ? AND ef.entity_type LIKE 'model_%'
        WHERE t.relation_type NOT IN ('based_on', 'conflicts_with', 'relates_to')`
    )
    .all(projectUid) as { from_uid: string; to_uid: string }[]
  const adjacency = new Map<string, string[]>()
  for (const edge of edges) {
    ;(adjacency.get(edge.from_uid) ?? adjacency.set(edge.from_uid, []).get(edge.from_uid)!).push(edge.to_uid)
  }
  const inCycle = new Set<string>()
  const visiting = new Set<string>()
  const done = new Set<string>()
  const stack: string[] = []
  const dfs = (uid: string): void => {
    visiting.add(uid)
    stack.push(uid)
    for (const next of adjacency.get(uid) ?? []) {
      if (visiting.has(next)) {
        for (let i = stack.lastIndexOf(next); i >= 0 && i < stack.length; i++) inCycle.add(stack[i]!)
      } else if (!done.has(next)) {
        dfs(next)
      }
    }
    visiting.delete(uid)
    done.add(uid)
    stack.pop()
  }
  for (const uid of adjacency.keys()) {
    if (!done.has(uid)) dfs(uid)
  }
  if (inCycle.size > 0) {
    const rows = db
      .prepare(`SELECT uid, code, title FROM entity_registry WHERE uid IN (${[...inCycle].map(() => '?').join(',')})`)
      .all(...inCycle) as { uid: string; code: string; title: string | null }[]
    for (const e of rows) {
      problems.push({ kind: 'cycle', message: `設計関係に循環があります: ${e.code}`, ...e })
    }
  }

  // 4) 過剰な relates_to（暫定リンク。レビュー後は他の関係へ置換すべき）
  const provisional = db
    .prepare(
      `SELECT e.uid, e.code, ef.title FROM trace_link t
         JOIN entity_registry e ON e.uid = t.uid AND e.status <> 'deleted'
         JOIN entity_registry ef ON ef.uid = t.from_uid
        WHERE e.project_uid = ? AND t.relation_type = 'relates_to'`
    )
    .all(projectUid) as { uid: string; code: string; title: string | null }[]
  for (const link of provisional) {
    problems.push({
      kind: 'provisional_link',
      message: `暫定リンク（relates_to）が残っています: ${link.code}`,
      ...link
    })
  }

  // 5) 検証未対応要求: verifies を受けていない REQ/CST（EDIT-043）
  const unverified = db
    .prepare(
      `SELECT e.uid, e.code, e.title FROM entity_registry e
        WHERE e.project_uid = ? AND e.entity_type IN ('model_req', 'model_cst') AND e.status <> 'deleted'
          AND NOT EXISTS (
            SELECT 1 FROM trace_link t JOIN entity_registry le ON le.uid = t.uid AND le.status <> 'deleted'
             WHERE t.to_uid = e.uid AND t.relation_type = 'verifies'
          )`
    )
    .all(projectUid) as { uid: string; code: string; title: string | null }[]
  for (const e of unverified) {
    problems.push({ kind: 'unverified_requirement', message: `検証（verifies）が未対応の要求です: ${e.code}`, ...e })
  }

  return problems
}

// ---- P9-2: クエリ結果の出力（TRACE-024） ----

export type ExportFormat = 'json' | 'csv' | 'markdown'

export function exportSubgraph(subgraph: TraceSubgraph, format: ExportFormat): string {
  if (format === 'json') {
    return JSON.stringify(subgraph, null, 2)
  }
  if (format === 'csv') {
    const lines = ['type,uid,code_or_relation,title_or_from,to,hop']
    for (const n of subgraph.nodes) {
      lines.push(`node,${n.uid},"${n.code}","${(n.title ?? '').replaceAll('"', '""')}",,${n.hop}`)
    }
    for (const e of subgraph.edges) {
      lines.push(`edge,${e.uid},"${e.relation_type}","${e.from_uid}","${e.to_uid}",`)
    }
    return lines.join('\n') + '\n'
  }
  // markdown
  const lines = [
    `# トレースクエリ結果`,
    '',
    `- 起点: ${subgraph.root}`,
    `- 方向: ${subgraph.direction} / 深さ: ${subgraph.depth}`,
    '',
    '## 要素',
    '',
    '| hop | code | 分類 | タイトル |',
    '| --- | --- | --- | --- |',
    ...subgraph.nodes.map((n) => `| ${n.hop} | ${n.code} | ${n.model_type ?? n.entity_type} | ${n.title ?? ''} |`),
    '',
    '## 関係',
    '',
    '| relation | from | to |',
    '| --- | --- | --- |',
    ...subgraph.edges.map((e) => `| ${e.relation_type} | ${e.from_uid} | ${e.to_uid} |`)
  ]
  return lines.join('\n') + '\n'
}
