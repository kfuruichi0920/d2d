// T406: 表編集 UI（グリッド・行列 ID・セルトレース）

import React, { useState, useEffect, useCallback, useRef } from 'react'
import type { ResourceRow } from '../types/d2d-api'

interface Cell {
  id?: string
  text: string
  rowspan?: number
  colspan?: number
  is_header?: boolean
}

type Grid = Cell[][]

interface TableRow {
  uid: string
  title: string
  table_title: string | null
  row_count: number
  column_count: number
  table_kind: string | null
  header_rows_json: string | null
  header_columns_json: string | null
  cells_json: string | null
}

function parseGrid(cellsJson: string | null | undefined, rows: number, cols: number): Grid {
  if (cellsJson) {
    try {
      const parsed = JSON.parse(cellsJson) as Grid
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch { /* skip */ }
  }
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => ({ text: r === 0 && c === 0 ? 'Header' : `(${r},${c})` }))
  )
}

export default function TableEditorPage() {
  const [tables, setTables] = useState<ResourceRow[]>([])
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [tableData, setTableData] = useState<TableRow | null>(null)
  const [grid, setGrid] = useState<Grid>([])
  const [rows, setRows] = useState(3)
  const [cols, setCols] = useState(4)
  const [activeCell, setActiveCell] = useState<[number, number] | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [showTraceFor, setShowTraceFor] = useState<string | null>(null)
  const [traceLinks, setTraceLinks] = useState<unknown[]>([])
  const inputRefs = useRef<Array<Array<HTMLInputElement | null>>>([])

  const load = useCallback(async () => {
    const list = await window.api.design.listResources('resource_table')
    setTables(list)
  }, [])

  useEffect(() => { load() }, [load])

  const loadTable = useCallback(async (uid: string) => {
    const rows = await window.api.store.query(
      `SELECT e.uid, e.title, t.table_title, t.row_count, t.column_count, t.table_kind, t.header_rows_json, t.header_columns_json, t.cells_json
       FROM resource_table t JOIN entity_registry e ON e.uid=t.uid WHERE t.uid=?`,
      [uid]
    )
    if (rows.length === 0) return
    const t = rows[0] as TableRow
    setTableData(t)
    const r = Math.max(t.row_count, 1)
    const c = Math.max(t.column_count, 1)
    setRows(r)
    setCols(c)
    setGrid(parseGrid(t.cells_json, r, c))
    setActiveCell(null)
    setSavedAt(null)
  }, [])

  const handleSelectTable = (uid: string) => {
    setSelectedUid(uid)
    loadTable(uid)
  }

  const handleCellChange = (r: number, c: number, text: string) => {
    setGrid((prev) => prev.map((row, ri) =>
      ri === r ? row.map((cell, ci) => ci === c ? { ...cell, text } : cell) : row
    ))
  }

  const handleCellToggleHeader = (r: number, c: number) => {
    setGrid((prev) => prev.map((row, ri) =>
      ri === r ? row.map((cell, ci) => ci === c ? { ...cell, is_header: !cell.is_header } : cell) : row
    ))
  }

  const addRow = () => {
    const newRow: Cell[] = Array.from({ length: cols }, () => ({ text: '' }))
    setGrid((prev) => [...prev, newRow])
    setRows((r) => r + 1)
  }

  const addCol = () => {
    setGrid((prev) => prev.map((row) => [...row, { text: '' }]))
    setCols((c) => c + 1)
  }

  const removeRow = (r: number) => {
    if (rows <= 1) return
    setGrid((prev) => prev.filter((_, ri) => ri !== r))
    setRows((v) => v - 1)
  }

  const removeCol = (c: number) => {
    if (cols <= 1) return
    setGrid((prev) => prev.map((row) => row.filter((_, ci) => ci !== c)))
    setCols((v) => v - 1)
  }

  const handleSave = async () => {
    if (!selectedUid || !tableData) return
    setSaving(true)
    try {
      await window.api.design.updateField(selectedUid, 'resource_table', {
        cells_json: JSON.stringify(grid),
        row_count: rows,
        column_count: cols,
      })
      setSavedAt(new Date().toLocaleTimeString())
    } finally {
      setSaving(false)
    }
  }

  const handleShowTrace = async (cellId: string | undefined, r: number, c: number) => {
    const id = cellId ?? `cell_${r}_${c}`
    setShowTraceFor(id)
    if (selectedUid) {
      const links = await window.api.design.listTraceLinks(selectedUid)
      setTraceLinks(links.filter((l: unknown) => {
        const link = l as { from_uid: string; to_uid: string }
        return link.from_uid === selectedUid || link.to_uid === selectedUid
      }))
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 左: 表一覧 */}
      <div style={{ width: 200, borderRight: '1px solid var(--srd-color-border)', overflow: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12, borderBottom: '1px solid var(--srd-color-border)' }}>表一覧 ({tables.length})</div>
        {tables.map((t) => (
          <div
            key={t.uid}
            onClick={() => handleSelectTable(t.uid)}
            style={{
              padding: '7px 12px',
              cursor: 'pointer',
              fontSize: 12,
              background: selectedUid === t.uid ? 'var(--srd-color-surface-variant)' : 'transparent',
              borderLeft: selectedUid === t.uid ? '3px solid var(--srd-color-primary)' : '3px solid transparent',
            }}
          >
            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.title}</div>
            <div style={{ fontSize: 10, color: 'var(--srd-color-on-surface-variant)', marginTop: 1 }}>{t.code}</div>
          </div>
        ))}
        {tables.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--srd-color-on-surface-variant)' }}>表リソースがありません</div>}
      </div>

      {/* 右: グリッドエディタ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!tableData ? (
          <div style={{ padding: 40, color: 'var(--srd-color-on-surface-variant)', textAlign: 'center' }}>左の表を選択してください</div>
        ) : (
          <>
            {/* ツールバー */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--srd-color-border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{tableData.title}</span>
              <span style={{ fontSize: 11, color: 'var(--srd-color-on-surface-variant)' }}>{rows}行 × {cols}列</span>
              <div style={{ flex: 1 }} />
              <button onClick={addRow} style={btnStyle}>行追加</button>
              <button onClick={addCol} style={btnStyle}>列追加</button>
              <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, background: 'var(--srd-color-primary)', color: '#fff' }}>
                {saving ? '保存中...' : '保存'}
              </button>
              {savedAt && <span style={{ fontSize: 11, color: '#22c55e' }}>✓ {savedAt}</span>}
            </div>

            {/* グリッド */}
            <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ width: 24, border: '1px solid var(--srd-color-border)', background: 'var(--srd-color-surface-variant)' }} />
                    {Array.from({ length: cols }, (_, c) => (
                      <th key={c} style={{ border: '1px solid var(--srd-color-border)', background: 'var(--srd-color-surface-variant)', padding: '2px 6px', fontSize: 11, position: 'relative', minWidth: 80 }}>
                        {colLabel(c)}
                        <button onClick={() => removeCol(c)} style={{ position: 'absolute', top: 1, right: 1, background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: '#999', lineHeight: 1 }}>×</button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {grid.map((row, r) => (
                    <tr key={r}>
                      <td style={{ border: '1px solid var(--srd-color-border)', background: 'var(--srd-color-surface-variant)', padding: '2px 4px', fontSize: 11, textAlign: 'center', position: 'relative' }}>
                        {r + 1}
                        <button onClick={() => removeRow(r)} style={{ position: 'absolute', top: 1, right: 0, background: 'none', border: 'none', cursor: 'pointer', fontSize: 9, color: '#999', lineHeight: 1 }}>×</button>
                      </td>
                      {row.map((cell, c) => (
                        <td
                          key={c}
                          style={{
                            border: '1px solid var(--srd-color-border)',
                            background: cell.is_header ? 'var(--srd-color-surface-variant)' : 'var(--srd-color-surface)',
                            padding: 0,
                            outline: activeCell?.[0] === r && activeCell?.[1] === c ? '2px solid var(--srd-color-primary)' : 'none',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'stretch' }}>
                            <input
                              ref={(el) => {
                                if (!inputRefs.current[r]) inputRefs.current[r] = []
                                inputRefs.current[r][c] = el
                              }}
                              value={cell.text}
                              onChange={(e) => handleCellChange(r, c, e.target.value)}
                              onFocus={() => setActiveCell([r, c])}
                              style={{
                                flex: 1,
                                padding: '4px 6px',
                                border: 'none',
                                background: 'transparent',
                                fontSize: 12,
                                fontWeight: cell.is_header ? 600 : 400,
                                outline: 'none',
                                minWidth: 80,
                              }}
                            />
                            {activeCell?.[0] === r && activeCell?.[1] === c && (
                              <div style={{ display: 'flex', flexDirection: 'column', borderLeft: '1px solid var(--srd-color-border)' }}>
                                <button
                                  onClick={() => handleCellToggleHeader(r, c)}
                                  title="ヘッダーセル切替"
                                  style={{ padding: '1px 3px', background: cell.is_header ? '#93c5fd' : 'transparent', border: 'none', cursor: 'pointer', fontSize: 9, lineHeight: 1.2 }}
                                >H</button>
                                <button
                                  onClick={() => handleShowTrace(cell.id, r, c)}
                                  title="トレースリンク"
                                  style={{ padding: '1px 3px', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 9, lineHeight: 1.2 }}
                                >🔗</button>
                              </div>
                            )}
                          </div>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* トレースリンクパネル */}
            {showTraceFor && (
              <div style={{ height: 140, borderTop: '1px solid var(--srd-color-border)', padding: 10, overflow: 'auto', flexShrink: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>トレースリンク: セル {showTraceFor}</span>
                  <button onClick={() => setShowTraceFor(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>×</button>
                </div>
                {traceLinks.length === 0
                  ? <div style={{ fontSize: 12, color: 'var(--srd-color-on-surface-variant)' }}>リンクなし</div>
                  : traceLinks.map((l, i) => {
                    const link = l as { relation_type: string; from_title: string; to_title: string; from_uid: string }
                    return (
                      <div key={i} style={{ fontSize: 11, padding: '2px 0', borderBottom: '1px solid var(--srd-color-border)' }}>
                        {link.from_title} → <strong>{link.relation_type}</strong> → {link.to_title}
                      </div>
                    )
                  })
                }
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function colLabel(c: number): string {
  let label = ''
  let n = c
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

const btnStyle: React.CSSProperties = {
  padding: '3px 8px',
  background: 'var(--srd-color-surface-variant)',
  color: 'var(--srd-color-on-surface)',
  border: '1px solid var(--srd-color-border)',
  borderRadius: 4, cursor: 'pointer', fontSize: 12,
}
