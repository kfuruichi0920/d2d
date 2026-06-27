import React, { useEffect, useState, useCallback } from 'react'
import type { SourceDocumentRow } from '../types/d2d-api'

const STATUS_LABEL: Record<string, string> = {
  active: '有効',
  archived: 'アーカイブ',
  deleted: '削除済',
}

const FILE_TYPE_LABEL: Record<string, string> = {
  word: 'Word',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
  pdf: 'PDF',
  visio: 'Visio',
  text: 'テキスト',
  markdown: 'Markdown',
  csv: 'CSV',
  tsv: 'TSV',
  json: 'JSON',
  jsonl: 'JSONL',
  yaml: 'YAML',
  unknown: '不明',
}

export function SourceDocumentsPage(): React.JSX.Element {
  const [docs, setDocs] = useState<SourceDocumentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [extracting, setExtracting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const list = await window.api.import.listDocuments()
      setDocs(list)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const off = window.api.events.on('d2d:extract:complete', () => load())
    return off
  }, [load])

  const handleImport = async () => {
    const paths = await window.api.import.openDialog()
    if (!paths.length) return
    for (const p of paths) {
      try {
        await window.api.import.document(p)
      } catch (e) {
        setError(String(e))
      }
    }
    load()
  }

  const handleExtract = async (uid: string) => {
    setExtracting(uid)
    try {
      await window.api.extract.document(uid)
    } catch (e) {
      setError(String(e))
    } finally {
      setExtracting(null)
    }
  }

  if (loading) return <div style={{ padding: 24 }}>読み込み中…</div>

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>原本ドキュメント</h2>
        <button onClick={handleImport} style={btnStyle}>
          + 取込
        </button>
      </div>

      {error && (
        <div style={{ color: 'red', marginBottom: 12, fontSize: 13 }}>{error}</div>
      )}

      {docs.length === 0 ? (
        <p style={{ color: '#888', fontSize: 14 }}>
          取り込まれたドキュメントはありません。「+ 取込」からファイルを追加してください。
        </p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
              <th style={thStyle}>コード</th>
              <th style={thStyle}>ファイル名</th>
              <th style={thStyle}>種別</th>
              <th style={thStyle}>ステータス</th>
              <th style={thStyle}>取込日時</th>
              <th style={thStyle}>操作</th>
            </tr>
          </thead>
          <tbody>
            {docs.map((doc) => (
              <tr key={doc.uid} style={{ borderBottom: '1px solid #e8e8e8' }}>
                <td style={tdStyle}>{doc.code}</td>
                <td style={tdStyle}>{doc.file_name}</td>
                <td style={tdStyle}>{FILE_TYPE_LABEL[doc.file_type] ?? doc.file_type}</td>
                <td style={tdStyle}>{STATUS_LABEL[doc.status] ?? doc.status}</td>
                <td style={tdStyle}>{doc.imported_at?.slice(0, 19).replace('T', ' ')}</td>
                <td style={tdStyle}>
                  <button
                    onClick={() => handleExtract(doc.uid)}
                    disabled={extracting === doc.uid}
                    style={smallBtnStyle}
                  >
                    {extracting === doc.uid ? '抽出中…' : '抽出'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
}

const smallBtnStyle: React.CSSProperties = {
  ...btnStyle,
  padding: '3px 10px',
  fontSize: 12,
  background: '#059669',
}

const thStyle: React.CSSProperties = {
  padding: '8px 10px',
  fontWeight: 600,
  color: '#555',
}

const tdStyle: React.CSSProperties = {
  padding: '8px 10px',
  verticalAlign: 'middle',
}
