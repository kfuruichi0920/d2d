// T803: ストア閲覧ビュー（SQLite / JSONL ブラウザ）

import { useState, useEffect, useCallback } from 'react'
import type { ExportFileInfo, StoreTablePreview } from '../types/d2d-api'

type View = 'tables' | 'files'

export default function StoreBrowserPage() {
  const [view, setView] = useState<View>('tables')
  const [tables, setTables] = useState<string[]>([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [preview, setPreview] = useState<StoreTablePreview | null>(null)
  const [files, setFiles] = useState<ExportFileInfo[]>([])
  const [selectedFile, setSelectedFile] = useState<ExportFileInfo | null>(null)
  const [fileContent, setFileContent] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [limit, setLimit] = useState(100)

  const loadTables = useCallback(async () => {
    const t = await window.api.store.listTables()
    setTables(t)
  }, [])

  const loadFiles = useCallback(async () => {
    const f = await window.api.store.listExportFiles()
    setFiles(f)
  }, [])

  useEffect(() => {
    loadTables()
    loadFiles()
  }, [loadTables, loadFiles])

  async function handleSelectTable(name: string) {
    setSelectedTable(name)
    setLoading(true)
    const p = await window.api.store.previewTable(name, limit)
    setPreview(p)
    setLoading(false)
  }

  async function handleSelectFile(f: ExportFileInfo) {
    setSelectedFile(f)
    setFileContent(null)
    setLoading(true)
    try {
      const content = await window.api.store.readExportFile(f.path)
      setFileContent(content)
    } catch {
      setFileContent('(読み込みエラー)')
    }
    setLoading(false)
  }

  const columns: string[] = preview?.rows[0] ? Object.keys(preview.rows[0] as object) : []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* タブ */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--srd-color-border)', flexShrink: 0 }}>
        {(['tables', 'files'] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            style={{
              padding: '6px 14px',
              background: view === v ? 'var(--srd-color-surface-variant)' : 'transparent',
              color: view === v ? 'var(--srd-color-on-surface)' : 'var(--srd-color-on-surface-variant)',
              border: 'none',
              borderBottom: view === v ? '2px solid var(--srd-color-primary)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {v === 'tables' ? 'SQLite テーブル' : 'エクスポートファイル'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {view === 'files' && (
          <button
            onClick={() => { window.api.store.openExportDir(); loadFiles() }}
            style={{ ...btnStyle, margin: '4px 8px' }}
          >
            フォルダを開く
          </button>
        )}
      </div>

      {/* コンテンツ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/* 左：一覧 */}
        <div style={{ width: 200, borderRight: '1px solid var(--srd-color-border)', overflow: 'auto', flexShrink: 0 }}>
          {view === 'tables' && tables.map((t) => (
            <div
              key={t}
              onClick={() => handleSelectTable(t)}
              style={{
                padding: '5px 10px',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'monospace',
                background: selectedTable === t ? 'var(--srd-color-surface-variant)' : 'transparent',
                borderLeft: selectedTable === t ? '3px solid var(--srd-color-primary)' : '3px solid transparent',
              }}
            >
              {t}
            </div>
          ))}
          {view === 'files' && files.map((f) => (
            <div
              key={f.path}
              onClick={() => handleSelectFile(f)}
              style={{
                padding: '5px 10px',
                cursor: 'pointer',
                fontSize: 11,
                background: selectedFile?.path === f.path ? 'var(--srd-color-surface-variant)' : 'transparent',
                borderLeft: selectedFile?.path === f.path ? '3px solid var(--srd-color-primary)' : '3px solid transparent',
              }}
            >
              <div style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{f.name}</div>
              <div style={{ color: 'var(--srd-color-on-surface-variant)', fontSize: 10 }}>
                {(f.size / 1024).toFixed(1)} KB
              </div>
            </div>
          ))}
          {view === 'files' && files.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: 'var(--srd-color-on-surface-variant)' }}>
              エクスポートファイルなし
            </div>
          )}
        </div>

        {/* 右：プレビュー */}
        <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
          {loading && <div style={{ color: 'var(--srd-color-on-surface-variant)' }}>読み込み中...</div>}

          {/* テーブルプレビュー */}
          {!loading && view === 'tables' && preview && (
            <>
              <div style={{ fontSize: 12, marginBottom: 6, display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontWeight: 600 }}>{selectedTable}</span>
                <span style={{ color: 'var(--srd-color-on-surface-variant)' }}>{preview.totalCount.toLocaleString()} 行</span>
                <label style={{ display: 'flex', gap: 4, alignItems: 'center', marginLeft: 'auto' }}>
                  表示数:
                  <select
                    value={limit}
                    onChange={(e) => { setLimit(+e.target.value); selectedTable && handleSelectTable(selectedTable) }}
                    style={{ padding: '2px 4px', background: 'var(--srd-color-surface)', color: 'var(--srd-color-on-surface)', border: '1px solid var(--srd-color-border)', borderRadius: 4, fontSize: 11 }}
                  >
                    {[50, 100, 500, 1000].map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ overflow: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: 11, width: 'max-content', minWidth: '100%' }}>
                  <thead>
                    <tr style={{ background: 'var(--srd-color-surface-variant)', position: 'sticky', top: 0 }}>
                      {columns.map((c) => (
                        <th key={c} style={{ padding: '3px 8px', textAlign: 'left', border: '1px solid var(--srd-color-border)', whiteSpace: 'nowrap' }}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--srd-color-border)' }}>
                        {columns.map((c) => {
                          const val = (row as Record<string, unknown>)[c]
                          const display = val == null ? '' : typeof val === 'object' ? JSON.stringify(val) : String(val)
                          return (
                            <td
                              key={c}
                              style={{ padding: '2px 8px', border: '1px solid var(--srd-color-border)', whiteSpace: 'nowrap', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'monospace' }}
                              title={display}
                            >
                              {display.slice(0, 200)}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {/* ファイルプレビュー */}
          {!loading && view === 'files' && fileContent != null && (
            <>
              <div style={{ fontSize: 12, marginBottom: 6, fontWeight: 600 }}>{selectedFile?.name}</div>
              <pre style={{ fontSize: 11, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'monospace' }}>
                {fileContent.slice(0, 50000)}{fileContent.length > 50000 ? '\n\n...(表示を50000文字で打ち切り)' : ''}
              </pre>
            </>
          )}

          {!loading && view === 'tables' && !preview && (
            <div style={{ color: 'var(--srd-color-on-surface-variant)', marginTop: 40, textAlign: 'center', fontSize: 13 }}>
              左のテーブルを選択してください
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '3px 8px',
  background: 'var(--srd-color-surface-variant)',
  color: 'var(--srd-color-on-surface)',
  border: '1px solid var(--srd-color-border)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
}
