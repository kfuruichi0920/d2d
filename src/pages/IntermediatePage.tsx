import React, { useEffect, useState, useCallback } from 'react'
import type { IntermediateDocumentRow, ChunkRow } from '../types/d2d-api'

const STATUS_LABEL: Record<string, string> = {
  pending: '未処理',
  running: '処理中',
  success: '完了',
  failed: '失敗',
  partial: '部分完了',
}

export function IntermediatePage(): React.JSX.Element {
  const [docs, setDocs] = useState<IntermediateDocumentRow[]>([])
  const [selected, setSelected] = useState<IntermediateDocumentRow | null>(null)
  const [chunks, setChunks] = useState<ChunkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await window.api.intermediate.list()
      setDocs(list)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const selectDoc = async (doc: IntermediateDocumentRow) => {
    setSelected(doc)
    const cl = await window.api.intermediate.listChunks(doc.uid)
    setChunks(cl)
  }

  const handleCreate = async () => {
    try {
      await window.api.intermediate.create({})
      load()
    } catch (e) {
      setError(String(e))
    }
  }

  if (loading) return <div style={{ padding: 24 }}>読み込み中…</div>

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 左ペイン: 一覧 */}
      <div style={{ width: 320, borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>中間データ</span>
          <button onClick={handleCreate} style={smallBtnStyle}>+ 新規</button>
        </div>
        {error && <div style={{ color: 'red', fontSize: 12, padding: 8 }}>{error}</div>}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {docs.map((doc) => (
            <div
              key={doc.uid}
              onClick={() => selectDoc(doc)}
              style={{
                padding: '10px 16px',
                borderBottom: '1px solid #f0f0f0',
                cursor: 'pointer',
                background: selected?.uid === doc.uid ? '#eff6ff' : 'transparent',
              }}
            >
              <div style={{ fontWeight: 500, fontSize: 13 }}>{doc.title}</div>
              <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                {doc.code} · {STATUS_LABEL[doc.intermediate_status] ?? doc.intermediate_status} · {doc.item_count} items
              </div>
            </div>
          ))}
          {docs.length === 0 && (
            <div style={{ padding: 16, color: '#888', fontSize: 13 }}>
              中間データがありません
            </div>
          )}
        </div>
      </div>

      {/* 右ペイン: 詳細 */}
      <div style={{ flex: 1, padding: 24, overflow: 'auto' }}>
        {selected ? (
          <>
            <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{selected.title}</h3>
            <div style={{ fontSize: 12, color: '#888', marginBottom: 16 }}>
              {selected.code} · {STATUS_LABEL[selected.intermediate_status]} · {selected.item_count} アイテム
            </div>

            <h4 style={{ fontSize: 14, margin: '0 0 8px' }}>チャンク ({chunks.length})</h4>
            {chunks.length === 0 ? (
              <p style={{ color: '#888', fontSize: 13 }}>チャンクはありません</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
                    <th style={thStyle}>コード</th>
                    <th style={thStyle}>トークン数</th>
                    <th style={thStyle}>アイテム数</th>
                    <th style={thStyle}>作成日時</th>
                    <th style={thStyle}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {chunks.map((c) => (
                    <tr key={c.uid} style={{ borderBottom: '1px solid #f0f0f0' }}>
                      <td style={tdStyle}>{c.code}</td>
                      <td style={tdStyle}>{c.token_count}</td>
                      <td style={tdStyle}>{c.item_count}</td>
                      <td style={tdStyle}>{c.created_at?.slice(0, 19).replace('T', ' ')}</td>
                      <td style={tdStyle}>
                        <button
                          onClick={async () => {
                            await window.api.intermediate.deleteChunk(c.uid)
                            const cl = await window.api.intermediate.listChunks(selected.uid)
                            setChunks(cl)
                          }}
                          style={{ ...smallBtnStyle, background: '#dc2626' }}
                        >
                          削除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <div style={{ color: '#888', fontSize: 14 }}>左から中間データを選択してください</div>
        )}
      </div>
    </div>
  )
}

const smallBtnStyle: React.CSSProperties = {
  padding: '3px 10px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
}

const thStyle: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, color: '#555' }
const tdStyle: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'middle' }
