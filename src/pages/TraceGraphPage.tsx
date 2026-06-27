import React, { useRef, useState, useCallback } from 'react'
import type { TraceSubgraph } from '../types/d2d-api'

const ENTITY_COLORS: Record<string, string> = {
  resource_text: '#3b82f6',
  resource_label: '#8b5cf6',
  resource_table: '#f59e0b',
  resource_figure: '#10b981',
  resource_code: '#6366f1',
  resource_model: '#ec4899',
  resource_scenario: '#14b8a6',
  resource_interface: '#f97316',
  resource_state_transition: '#06b6d4',
  resource_data_structure: '#84cc16',
  resource_glossary: '#a855f7',
  extracted_document: '#94a3b8',
  intermediate_document: '#64748b',
  source_document: '#475569',
}

function colorFor(entityType: string): string {
  return ENTITY_COLORS[entityType] ?? '#9ca3af'
}

interface NodePos {
  uid: string
  x: number
  y: number
  title: string
  entity_type: string
  depth: number
}

function layoutNodes(nodes: TraceSubgraph['nodes'], width: number, height: number): NodePos[] {
  if (nodes.length === 0) return []
  const byDepth: Record<number, typeof nodes> = {}
  for (const n of nodes) {
    ;(byDepth[n.depth] ??= []).push(n)
  }
  const depths = Object.keys(byDepth)
    .map(Number)
    .sort((a, b) => a - b)
  const colWidth = Math.max(120, width / (depths.length + 1))

  return nodes.map((n) => {
    const col = depths.indexOf(n.depth)
    const siblings = byDepth[n.depth]
    const row = siblings.indexOf(n)
    const rowHeight = Math.max(60, height / (siblings.length + 1))
    return {
      uid: n.uid,
      x: colWidth * (col + 1),
      y: rowHeight * (row + 1),
      title: n.title,
      entity_type: n.entity_type,
      depth: n.depth,
    }
  })
}

export function TraceGraphPage(): React.JSX.Element {
  const [rootUid, setRootUid] = useState('')
  const [maxDepth, setMaxDepth] = useState(3)
  const [graph, setGraph] = useState<TraceSubgraph | null>(null)
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const W = 900
  const H = 560

  const load = useCallback(async () => {
    if (!rootUid.trim()) return
    setLoading(true)
    setError(null)
    try {
      const g = await window.api.trace.subgraph(rootUid.trim(), { maxDepth })
      setGraph(g)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [rootUid, maxDepth])

  const nodes = graph ? layoutNodes(graph.nodes, W, H) : []
  const posMap = new Map(nodes.map((n) => [n.uid, n]))

  const handleExportMd = async () => {
    if (!rootUid.trim()) return
    const md = await window.api.trace.exportSubgraphMarkdown(rootUid.trim(), maxDepth)
    const blob = new Blob([md], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = 'trace_subgraph.md'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ padding: 20, height: '100%', overflow: 'auto', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>トレースグラフ</h2>
        <input
          value={rootUid}
          onChange={(e) => setRootUid(e.target.value)}
          placeholder="ルート UID を入力…"
          style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, width: 260 }}
        />
        <label style={{ fontSize: 12 }}>
          深さ:{' '}
          <input
            type="number"
            min={1}
            max={8}
            value={maxDepth}
            onChange={(e) => setMaxDepth(Number(e.target.value))}
            style={{ width: 40, padding: '3px 4px', border: '1px solid #d1d5db', borderRadius: 4 }}
          />
        </label>
        <button onClick={load} style={btnStyle}>探索</button>
        {graph && <button onClick={handleExportMd} style={{ ...btnStyle, background: '#059669' }}>Markdown出力</button>}
        {loading && <span style={{ color: '#888', fontSize: 12 }}>探索中…</span>}
        {error && <span style={{ color: 'red', fontSize: 12 }}>{error}</span>}
      </div>

      {/* 凡例 */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        {Object.entries(ENTITY_COLORS).slice(0, 8).map(([t, c]) => (
          <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11 }}>
            <div style={{ width: 10, height: 10, borderRadius: '50%', background: c }} />
            {t.replace('resource_', '')}
          </div>
        ))}
      </div>

      {graph && graph.nodes.length === 0 && (
        <div style={{ color: '#888' }}>このノードにはトレースリンクがありません</div>
      )}

      {graph && graph.nodes.length > 0 && (
        <div style={{ border: '1px solid #e0e0e0', borderRadius: 8, overflow: 'hidden', background: '#fafafa' }}>
          <svg ref={svgRef} width={W} height={H} style={{ display: 'block' }}>
            {/* エッジ */}
            <defs>
              <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
                <path d="M0,0 L0,6 L8,3 z" fill="#94a3b8" />
              </marker>
            </defs>
            {graph.edges.map((e) => {
              const from = posMap.get(e.from_uid)
              const to = posMap.get(e.to_uid)
              if (!from || !to) return null
              const mx = (from.x + to.x) / 2
              const my = (from.y + to.y) / 2
              return (
                <g key={e.uid}>
                  <line
                    x1={from.x} y1={from.y} x2={to.x} y2={to.y}
                    stroke="#cbd5e1" strokeWidth={1.5} markerEnd="url(#arrow)"
                  />
                  <text x={mx} y={my - 4} textAnchor="middle" fontSize={9} fill="#94a3b8">{e.relation_type}</text>
                </g>
              )
            })}

            {/* ノード */}
            {nodes.map((n) => {
              const isHovered = hoveredNode === n.uid
              const isRoot = n.depth === 0
              const r = isRoot ? 28 : 22
              const color = colorFor(n.entity_type)
              const label = n.title.length > 18 ? n.title.slice(0, 16) + '…' : n.title
              return (
                <g
                  key={n.uid}
                  onMouseEnter={() => setHoveredNode(n.uid)}
                  onMouseLeave={() => setHoveredNode(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle cx={n.x} cy={n.y} r={r} fill={color} opacity={isHovered ? 1 : 0.8}
                    stroke={isRoot ? '#1e293b' : 'none'} strokeWidth={isRoot ? 2 : 0} />
                  <text x={n.x} y={n.y + 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={9} fill="#fff" fontWeight={isRoot ? 700 : 400}>
                    {label}
                  </text>
                  {isHovered && (
                    <g>
                      <rect x={n.x + r + 4} y={n.y - 22} width={200} height={40} rx={4}
                        fill="#1e293b" opacity={0.9} />
                      <text x={n.x + r + 8} y={n.y - 9} fontSize={10} fill="#fff">{n.title}</text>
                      <text x={n.x + r + 8} y={n.y + 5} fontSize={9} fill="#94a3b8">{n.entity_type}</text>
                    </g>
                  )}
                </g>
              )
            })}
          </svg>
        </div>
      )}

      {/* ノード一覧テーブル */}
      {graph && graph.nodes.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: '#555', marginBottom: 6 }}>
            ノード ({graph.nodes.length}) / エッジ ({graph.edges.length})
          </div>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
                <th style={thStyle}>深さ</th><th style={thStyle}>タイトル</th><th style={thStyle}>種別</th><th style={thStyle}>UID</th>
              </tr>
            </thead>
            <tbody>
              {graph.nodes.map((n) => (
                <tr key={n.uid} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={tdStyle}>{n.depth}</td>
                  <td style={tdStyle}>{n.title}</td>
                  <td style={{ ...tdStyle, color: '#888' }}>{n.entity_type}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 10, color: '#aaa' }}>{n.uid}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '5px 12px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 13,
}
const thStyle: React.CSSProperties = { padding: '5px 8px', fontWeight: 600, color: '#555' }
const tdStyle: React.CSSProperties = { padding: '5px 8px' }
