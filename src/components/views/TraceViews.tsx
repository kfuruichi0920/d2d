/**
 * トレーサビリティ UI（P9-2〜P9-6、UI-014/016、TRACE-021〜025）。
 * - TraceSideBar: クエリ条件（起点・深さ・方向）と各ビューへの導線
 * - TraceGraphEditor: SVG 自前実装の関係グラフ（hop 階層レイアウト + ホップ強調）
 * - TraceMatrixEditor: 分類×分類のトレースマトリクス
 * - Trace Impact Editorはeditors/TraceImpactEditor.tsxへ分離
 * - ProblemsView: 整合性検査結果（Problems Panel）
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import type { DesignElementRow } from './DesignModelViews'

interface TraceNode {
  uid: string
  code: string
  title: string | null
  model_type: string | null
  entity_type: string
  hop: number
}

interface TraceEdge {
  uid: string
  from_uid: string
  to_uid: string
  relation_type: string
}

interface TraceSubgraph {
  root: string
  nodes: TraceNode[]
  edges: TraceEdge[]
  truncated: boolean
}

// ---- Trace サイドバー（P9-2） ----

function uniqueTraceUri(base: string): string {
  return `${base}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function TraceSideBar(): React.JSX.Element {
  const [elements, setElements] = useState<DesignElementRow[]>([])
  const [rootUid, setRootUid] = useState('')
  const [depth, setDepth] = useState(3)
  const [direction, setDirection] = useState<'both' | 'forward' | 'backward'>('both')
  const openResource = useEditorStore((s) => s.openResource)
  const notify = useJobsStore((s) => s.notify)

  useEffect(() => {
    void invoke<DesignElementRow[]>('design.listElements').then((res) => {
      if (res.ok) {
        setElements(res.result)
        if (res.result.length > 0 && !rootUid) setRootUid(res.result[0]!.uid)
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runQuery = (): void => {
    if (!rootUid) return
    openResource(`trace://graph/${rootUid}/${depth}/${direction}`, '関係グラフ', { preview: false })
  }

  const exportResult = async (format: string): Promise<void> => {
    if (!rootUid) return
    const res = await invoke<{ path: string }>('trace.export', { rootUid, depth, direction, format })
    if (res.ok) notify('info', `クエリ結果を出力しました: ${res.result.path}`)
    else notify('error', '出力に失敗しました', res.error.message)
  }

  const selectStyle: React.CSSProperties = { width: '100%', margin: '2px 0' }

  return (
    <div style={{ padding: 6 }} data-testid="trace-sidebar">
      <div style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>起点要素</div>
      <select
        style={selectStyle}
        value={rootUid}
        onChange={(e) => setRootUid(e.target.value)}
        data-testid="trace-root-select"
      >
        {elements.map((el) => (
          <option key={el.uid} value={el.uid}>
            {el.code} {el.title}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', gap: 6, margin: '4px 0' }}>
        <label style={{ flex: 1 }}>
          <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>深さ</span>
          <input
            type="number"
            min={1}
            max={10}
            value={depth}
            onChange={(e) => setDepth(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </label>
        <label style={{ flex: 1 }}>
          <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>方向</span>
          <select
            style={{ width: '100%' }}
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            <option value="both">双方向</option>
            <option value="forward">下流</option>
            <option value="backward">上流</option>
          </select>
        </label>
      </div>
      <button
        type="button"
        className="d2d-btn primary"
        style={{ width: '100%' }}
        onClick={runQuery}
        data-testid="trace-run"
      >
        クエリ実行（グラフ表示）
      </button>
      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
        {(['json', 'csv', 'markdown'] as const).map((format) => (
          <button
            key={format}
            type="button"
            className="d2d-btn small"
            style={{ flex: 1 }}
            onClick={() => void exportResult(format)}
          >
            {format}
          </button>
        ))}
      </div>
      <hr style={{ border: 'none', borderTop: '1px solid var(--d2d-border)', margin: '10px 0' }} />
      <button
        type="button"
        className="d2d-btn"
        style={{ width: '100%', marginBottom: 4 }}
        onClick={() =>
          openResource(uniqueTraceUri('trace://matrix/all:design/all:design'), 'トレースマトリクス', { preview: false })
        }
        data-testid="open-matrix"
      >
        新しいトレースマトリクス
      </button>
      <button
        type="button"
        className="d2d-btn"
        style={{ width: '100%' }}
        onClick={() => openResource(uniqueTraceUri('trace://list-link'), 'インパクト分析', { preview: false })}
        data-testid="open-impact-analysis"
      >
        新しい分析ビュー
      </button>
    </div>
  )
}

// ---- 関係グラフ（P9-3、SVG 自前・hop レイアウト・ホップ強調） ----

const CATEGORY_COLORS: Record<string, string> = {
  model_req: 'var(--d2d-review-candidate)',
  model_cst: 'var(--d2d-warning)',
  model_func: 'var(--d2d-success)',
  model_struct: '#9c7bd0',
  model_verif: '#d07b9c',
  model_if: '#7bb8d0'
}

export function TraceGraphEditor({
  rootUid,
  depth,
  direction
}: {
  rootUid: string
  depth: number
  direction: string
}): React.JSX.Element {
  const [graph, setGraph] = useState<TraceSubgraph | null>(null)
  const [highlightHops, setHighlightHops] = useState(2)
  const openResource = useEditorStore((s) => s.openResource)

  useEffect(() => {
    void invoke<TraceSubgraph>('trace.getSubgraph', { rootUid, depth, direction }).then((res) => {
      if (res.ok) setGraph(res.result)
    })
  }, [rootUid, depth, direction])

  if (!graph) return <div className="d2d-empty">読込中…</div>

  // hop 階層レイアウト: hop → 列、列内で縦に並べる
  const byHop = new Map<number, TraceNode[]>()
  for (const node of graph.nodes) {
    ;(byHop.get(node.hop) ?? byHop.set(node.hop, []).get(node.hop)!).push(node)
  }
  const NODE_W = 170
  const NODE_H = 40
  const GAP_X = 90
  const GAP_Y = 16
  const positions = new Map<string, { x: number; y: number }>()
  let maxRows = 1
  for (const [hop, nodes] of byHop) {
    maxRows = Math.max(maxRows, nodes.length)
    nodes.forEach((node, i) => {
      positions.set(node.uid, { x: 20 + hop * (NODE_W + GAP_X), y: 20 + i * (NODE_H + GAP_Y) })
    })
  }
  const width = 40 + (byHop.size + 1) * (NODE_W + GAP_X)
  const height = 40 + maxRows * (NODE_H + GAP_Y)

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }} data-testid="trace-graph">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px',
          borderBottom: '1px solid var(--d2d-border)'
        }}
      >
        <span>
          関係グラフ（{graph.nodes.length} 要素 / {graph.edges.length} 関係）
        </span>
        {graph.truncated && (
          <span style={{ color: 'var(--d2d-warning)' }}>⚠ 上限で打ち切り（深さ・条件を絞ってください）</span>
        )}
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>強調ホップ数（TRACE-025）</span>
          <input
            type="range"
            min={0}
            max={depth}
            value={highlightHops}
            onChange={(e) => setHighlightHops(Number(e.target.value))}
            data-testid="hop-slider"
          />
          <span>{highlightHops}</span>
        </label>
      </div>
      <div style={{ flex: 1, overflow: 'auto' }}>
        <svg width={width} height={height} style={{ minWidth: '100%' }}>
          {graph.edges.map((edge) => {
            const from = positions.get(edge.from_uid)
            const to = positions.get(edge.to_uid)
            if (!from || !to) return null
            const fromHop = graph.nodes.find((n) => n.uid === edge.from_uid)?.hop ?? 0
            const toHop = graph.nodes.find((n) => n.uid === edge.to_uid)?.hop ?? 0
            const dimmed = Math.min(fromHop, toHop) > highlightHops
            const x1 = from.x + NODE_W / 2
            const y1 = from.y + NODE_H / 2
            const x2 = to.x + NODE_W / 2
            const y2 = to.y + NODE_H / 2
            return (
              <g key={edge.uid} opacity={dimmed ? 0.2 : 0.9}>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="var(--d2d-fg-muted)"
                  strokeWidth={1.2}
                  markerEnd="url(#arrow)"
                />
                <text
                  x={(x1 + x2) / 2}
                  y={(y1 + y2) / 2 - 4}
                  fontSize={9}
                  fill="var(--d2d-fg-muted)"
                  textAnchor="middle"
                >
                  {edge.relation_type}
                </text>
              </g>
            )
          })}
          <defs>
            <marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8" fill="none" stroke="var(--d2d-fg-muted)" />
            </marker>
          </defs>
          {graph.nodes.map((node) => {
            const pos = positions.get(node.uid)!
            const dimmed = node.hop > highlightHops
            const accent = CATEGORY_COLORS[node.model_type ?? ''] ?? 'var(--d2d-border)'
            return (
              <g
                key={node.uid}
                transform={`translate(${pos.x},${pos.y})`}
                opacity={dimmed ? 0.25 : 1}
                style={{ cursor: 'pointer' }}
                data-testid={`graph-node-${node.code}`}
                onClick={() => openResource(`design://${node.uid}`, node.code, { preview: true })}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx={5}
                  fill="var(--d2d-surface-raised)"
                  stroke={node.uid === graph.root ? 'var(--d2d-accent)' : accent}
                  strokeWidth={node.uid === graph.root ? 2.5 : 1.5}
                />
                <text x={8} y={16} fontSize={10} fill={accent} fontWeight={700}>
                  {node.model_type ?? node.entity_type} {node.code}
                </text>
                <text x={8} y={31} fontSize={11} fill="var(--d2d-fg)">
                  {(node.title ?? '').slice(0, 20)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

// ---- トレースマトリクス（P9-4） ----

const CATEGORIES = [
  'model_src',
  'model_std',
  'model_req',
  'model_cst',
  'model_func',
  'model_struct',
  'model_beh',
  'model_state',
  'model_data',
  'model_if',
  'model_verif',
  'model_impl',
  'model_mgmt'
]

interface MatrixData {
  rows: { uid: string; code: string; title: string | null }[]
  cols: { uid: string; code: string; title: string | null }[]
  cells: Record<string, Record<string, string[]>>
}

export function TraceMatrixEditor({
  initialRow,
  initialCol
}: {
  initialRow: string
  initialCol: string
}): React.JSX.Element {
  const [rowCategory, setRowCategory] = useState(initialRow)
  const [colCategory, setColCategory] = useState(initialCol)
  const [matrix, setMatrix] = useState<MatrixData | null>(null)

  useEffect(() => {
    void invoke<MatrixData>('trace.matrix', { rowCategory, colCategory }).then((res) => {
      if (res.ok) setMatrix(res.result)
    })
  }, [rowCategory, colCategory])

  const cellStyle: React.CSSProperties = {
    border: '1px solid var(--d2d-border)',
    padding: '3px 8px',
    textAlign: 'center',
    minWidth: 60
  }

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }} data-testid="trace-matrix">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span>行:</span>
        <select value={rowCategory} onChange={(e) => setRowCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <span>列:</span>
        <select value={colCategory} onChange={(e) => setColCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      {!matrix || matrix.rows.length === 0 || matrix.cols.length === 0 ? (
        <div className="d2d-empty">対象の設計要素がありません</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr>
              <th style={cellStyle} />
              {matrix.cols.map((col) => (
                <th key={col.uid} style={cellStyle} title={col.title ?? ''}>
                  {col.code}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row) => (
              <tr key={row.uid}>
                <th style={{ ...cellStyle, textAlign: 'left' }} title={row.title ?? ''}>
                  {row.code} {row.title}
                </th>
                {matrix.cols.map((col) => {
                  const relations = matrix.cells[row.uid]?.[col.uid]
                  return (
                    <td key={col.uid} style={cellStyle} title={relations?.join(', ') ?? ''}>
                      {relations ? <span style={{ color: 'var(--d2d-accent)', fontWeight: 700 }}>●</span> : ''}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// ---- 根拠チェーン（P9-5、UI-015） ----

interface BasisChainRow {
  uid: string
  code: string
  title: string | null
  model_type: string
  basis: { code: string; title: string | null; entity_type: string }[]
}

export function BasisChainEditor(): React.JSX.Element {
  const [rows, setRows] = useState<BasisChainRow[]>([])

  useEffect(() => {
    void invoke<BasisChainRow[]>('trace.basisChains').then((res) => {
      if (res.ok) setRows(res.result)
    })
  }, [])

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }} data-testid="basis-chain">
      <h1 style={{ fontSize: 14, marginTop: 0 }}>階層リスト間リンク（④ → 根拠 → …）</h1>
      {rows.length === 0 ? (
        <div className="d2d-empty">設計要素がありません</div>
      ) : (
        rows.map((row) => (
          <div
            key={row.uid}
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', flexWrap: 'wrap' }}
          >
            <span className="d2d-badge status-running">{row.model_type}</span>
            <span>
              {row.code} {row.title}
            </span>
            {row.basis.map((b, i) => (
              <span key={i} style={{ color: 'var(--d2d-fg-muted)' }}>
                → {b.code} <span style={{ fontSize: 10 }}>({b.entity_type})</span>
              </span>
            ))}
            {row.basis.length === 0 && <span style={{ color: 'var(--d2d-error)', fontSize: 11 }}>根拠なし</span>}
          </div>
        ))
      )}
    </div>
  )
}

// ---- 整合性検査（P9-6、Problems Panel） ----

interface ConsistencyProblem {
  kind: string
  message: string
  uid: string
  code: string
}

const PROBLEM_LABELS: Record<string, string> = {
  unconnected: '未接続',
  no_basis: '根拠不足',
  cycle: '循環',
  provisional_link: '暫定リンク',
  unverified_requirement: '検証未対応'
}

export function ProblemsView(): React.JSX.Element {
  const [problems, setProblems] = useState<ConsistencyProblem[] | null>(null)
  const openResource = useEditorStore((s) => s.openResource)

  const refresh = useCallback(async () => {
    const res = await invoke<ConsistencyProblem[]>('trace.check')
    if (res.ok) setProblems(res.result)
  }, [])

  useEffect(() => {
    void refresh()
    return onBackendEvent((event) => {
      if (['design_model.updated', 'relation.updated'].includes(event)) void refresh()
    })
  }, [refresh])

  if (problems === null) return <div className="d2d-empty">検査中…</div>
  if (problems.length === 0) return <div className="d2d-empty">問題は検出されていません</div>

  return (
    <div data-testid="problems-list">
      {problems.map((problem, i) => (
        <div
          key={i}
          className="d2d-list-row"
          onClick={() => openResource(`design://${problem.uid}`, problem.code, { preview: true })}
        >
          <span className="d2d-badge review-needsfix">{PROBLEM_LABELS[problem.kind] ?? problem.kind}</span>
          <span>{problem.message}</span>
        </div>
      ))}
    </div>
  )
}
