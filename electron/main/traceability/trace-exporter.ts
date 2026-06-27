import { buildMatrix, findSubgraph, type TraceMatrixEntry, type TraceGraph } from './trace-query'
import type { RelationType } from '../design/trace-manager'

// ---- JSON ----

export function exportSubgraphJson(rootUid: string, maxDepth?: number): string {
  const graph: TraceGraph = findSubgraph(rootUid, { maxDepth })
  return JSON.stringify(graph, null, 2)
}

export function exportMatrixJson(
  fromTypes?: string[],
  toTypes?: string[],
  relationTypes?: RelationType[]
): string {
  const entries: TraceMatrixEntry[] = buildMatrix(fromTypes, toTypes, relationTypes)
  return JSON.stringify(entries, null, 2)
}

// ---- CSV ----

export function exportMatrixCsv(
  fromTypes?: string[],
  toTypes?: string[],
  relationTypes?: RelationType[]
): string {
  const entries = buildMatrix(fromTypes, toTypes, relationTypes)
  const header = 'from_uid,from_title,from_type,to_uid,to_title,to_type,relation_type,confidence'
  const rows = entries.map((e) =>
    [
      csvEscape(e.from_uid),
      csvEscape(e.from_title),
      csvEscape(e.from_type),
      csvEscape(e.to_uid),
      csvEscape(e.to_title),
      csvEscape(e.to_type),
      csvEscape(e.relation_type),
      e.confidence != null ? String(e.confidence) : '',
    ].join(',')
  )
  return [header, ...rows].join('\n')
}

// ---- Markdown ----

export function exportMatrixMarkdown(
  fromTypes?: string[],
  toTypes?: string[],
  relationTypes?: RelationType[]
): string {
  const entries = buildMatrix(fromTypes, toTypes, relationTypes)
  if (entries.length === 0) return '_トレースリンクが見つかりません_\n'

  const lines: string[] = []
  lines.push('| 元 | 元種別 | 関係 | 先 | 先種別 | 信頼度 |')
  lines.push('|---|---|---|---|---|---|')
  for (const e of entries) {
    lines.push(
      `| ${e.from_title} | ${e.from_type} | ${e.relation_type} | ${e.to_title} | ${e.to_type} | ${e.confidence ?? ''} |`
    )
  }
  return lines.join('\n') + '\n'
}

export function exportSubgraphMarkdown(rootUid: string, maxDepth?: number): string {
  const { nodes, edges } = findSubgraph(rootUid, { maxDepth })
  if (nodes.length === 0) return '_ノードが見つかりません_\n'

  const lines: string[] = []
  lines.push(`## サブグラフ (root: ${rootUid})\n`)
  lines.push('### ノード\n')
  lines.push('| UID | タイトル | 種別 | 深さ |')
  lines.push('|---|---|---|---|')
  for (const n of nodes) {
    lines.push(`| ${n.uid} | ${n.title} | ${n.entity_type} | ${n.depth} |`)
  }
  lines.push('\n### エッジ\n')
  lines.push('| 元 | 先 | 関係 |')
  lines.push('|---|---|---|')
  for (const e of edges) {
    lines.push(`| ${e.from_uid} | ${e.to_uid} | ${e.relation_type} |`)
  }
  return lines.join('\n') + '\n'
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
