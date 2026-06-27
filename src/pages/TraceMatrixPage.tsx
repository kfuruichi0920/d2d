import React, { useEffect, useState, useCallback } from 'react'
import type { TraceMatrixEntry, RelationType } from '../types/d2d-api'

const RELATION_TYPES: RelationType[] = [
  'derived_from', 'normalized_from', 'based_on',
  'satisfies', 'verifies', 'depends_on', 'refines', 'relates_to',
]

export function TraceMatrixPage(): React.JSX.Element {
  const [entries, setEntries] = useState<TraceMatrixEntry[]>([])
  const [stats, setStats] = useState<{ relation_type: string; count: number }[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRelTypes, setSelectedRelTypes] = useState<RelationType[]>([])
  const [fromTypes] = useState<string[]>([])
  const [toTypes] = useState<string[]>([])
  const [exportStatus, setExportStatus] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [mat, st] = await Promise.all([
        window.api.trace.matrix(
          fromTypes.length ? fromTypes : undefined,
          toTypes.length ? toTypes : undefined,
          selectedRelTypes.length ? selectedRelTypes : undefined
        ),
        window.api.trace.stats(),
      ])
      setEntries(mat)
      setStats(st)
    } finally {
      setLoading(false)
    }
  }, [selectedRelTypes, fromTypes, toTypes])

  useEffect(() => { load() }, [load])

  const handleExport = async (fmt: 'csv' | 'md' | 'json') => {
    try {
      const rt = selectedRelTypes.length ? selectedRelTypes : undefined
      const ft = fromTypes.length ? fromTypes : undefined
      const tt = toTypes.length ? toTypes : undefined
      let content: string
      let ext: string
      if (fmt === 'csv') { content = await window.api.trace.exportMatrixCsv(ft, tt, rt); ext = 'csv' }
      else if (fmt === 'md') { content = await window.api.trace.exportMatrixMarkdown(ft, tt, rt); ext = 'md' }
      else { content = await window.api.trace.exportMatrixJson(ft, tt, rt); ext = 'json' }

      const blob = new Blob([content], { type: 'text/plain' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = `trace_matrix.${ext}`; a.click()
      URL.revokeObjectURL(url)
      setExportStatus(`エクスポート完了 (${ext})`)
    } catch (e) {
      setExportStatus(`エラー: ${e}`)
    }
  }

  const handleDbToText = async () => {
    try {
      const result = await window.api.trace.dbToText()
      setExportStatus(`DB to Text 完了: ${result.totalRows} 行 → ${result.outputDir}`)
    } catch (e) {
      setExportStatus(`エラー: ${e}`)
    }
  }

  return (
    <div style={{ padding: 20, height: '100%', overflow: 'auto', fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>トレースマトリクス</h2>
        <button onClick={() => handleExport('csv')} style={btnStyle}>CSV</button>
        <button onClick={() => handleExport('md')} style={btnStyle}>Markdown</button>
        <button onClick={() => handleExport('json')} style={btnStyle}>JSON</button>
        <button onClick={handleDbToText} style={{ ...btnStyle, background: '#059669' }}>DB to Text</button>
        {exportStatus && <span style={{ fontSize: 12, color: '#555' }}>{exportStatus}</span>}
      </div>

      {/* 統計 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {stats.map((s) => (
          <div key={s.relation_type} style={{ padding: '3px 8px', background: '#f3f4f6', borderRadius: 4, fontSize: 11 }}>
            {s.relation_type}: <strong>{s.count}</strong>
          </div>
        ))}
      </div>

      {/* フィルタ */}
      <details style={{ marginBottom: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 12, color: '#555' }}>フィルタ</summary>
        <div style={{ padding: '8px 0' }}>
          <div style={{ marginBottom: 6, fontSize: 12 }}>
            <strong>関係種別</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
              {RELATION_TYPES.map((r) => (
                <label key={r} style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <input
                    type="checkbox"
                    checked={selectedRelTypes.includes(r)}
                    onChange={(e) =>
                      setSelectedRelTypes(e.target.checked
                        ? [...selectedRelTypes, r]
                        : selectedRelTypes.filter((x) => x !== r)
                      )
                    }
                  />
                  {r}
                </label>
              ))}
            </div>
          </div>
        </div>
      </details>

      {/* マトリクス表 */}
      {loading ? (
        <div style={{ color: '#888' }}>読み込み中…</div>
      ) : entries.length === 0 ? (
        <div style={{ color: '#888' }}>トレースリンクがありません</div>
      ) : (
        <div style={{ overflow: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={thStyle}>元タイトル</th>
                <th style={thStyle}>元種別</th>
                <th style={thStyle}>関係</th>
                <th style={thStyle}>先タイトル</th>
                <th style={thStyle}>先種別</th>
                <th style={thStyle}>信頼度</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                  <td style={tdStyle}>{e.from_title}</td>
                  <td style={{ ...tdStyle, color: '#888' }}>{e.from_type}</td>
                  <td style={{ ...tdStyle, fontWeight: 500 }}>{e.relation_type}</td>
                  <td style={tdStyle}>{e.to_title}</td>
                  <td style={{ ...tdStyle, color: '#888' }}>{e.to_type}</td>
                  <td style={tdStyle}>{e.confidence != null ? e.confidence.toFixed(2) : '—'}</td>
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
  padding: '4px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12,
}
const thStyle: React.CSSProperties = { padding: '6px 10px', fontWeight: 600, color: '#555', borderBottom: '2px solid #e0e0e0', textAlign: 'left' }
const tdStyle: React.CSSProperties = { padding: '5px 10px', verticalAlign: 'middle' }
