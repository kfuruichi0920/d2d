/** scheme:// の全UIDリンク一覧Editor（P3-7、UI-057）。 */
import { useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'

export type ListableResourceScheme =
  'original' | 'extracted' | 'intermediate' | 'chunk' | 'candidate' | 'design' | 'resource'

interface AddressEntry {
  uid: string
  code: string
  title: string | null
  entityType: string
  uri: string
}

const LABELS: Record<ListableResourceScheme, string> = {
  original: '原本',
  extracted: '抽出データ',
  intermediate: '中間データ',
  chunk: 'チャンク編集対象',
  candidate: '候補セット',
  design: '設計モデル',
  resource: 'Resource'
}

export function ResourceAddressListEditor({ scheme }: { scheme: ListableResourceScheme }): React.JSX.Element {
  const [rows, setRows] = useState<AddressEntry[] | null>(null)
  const [error, setError] = useState('')
  const openResource = useEditorStore((state) => state.openResource)

  useEffect(() => {
    let active = true
    void invoke<AddressEntry[]>('resource.listAddresses', { scheme }).then((result) => {
      if (!active) return
      if (result.ok) setRows(result.result)
      else setError(result.error.message)
    })
    return () => {
      active = false
    }
  }, [scheme])

  return (
    <section className="d2d-editor-section" data-testid={`address-list-${scheme}`}>
      <header className="editor-section-header">
        <div>
          <h1>{LABELS[scheme]}一覧</h1>
          <p>
            <code>{scheme}://</code> で指定可能なリンクです。
          </p>
        </div>
        <span className="d2d-count-badge">{rows?.length ?? 0} 件</span>
      </header>
      {error ? (
        <div className="d2d-empty error">{error}</div>
      ) : rows === null ? (
        <div className="d2d-empty">読み込み中…</div>
      ) : rows.length === 0 ? (
        <div className="d2d-empty">該当するデータはありません。</div>
      ) : (
        <table className="d2d-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>名称</th>
              <th>種別</th>
              <th>アドレス</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.uri} data-testid={`address-entry-${row.code}`}>
                <td>{row.code}</td>
                <td>{row.title ?? '—'}</td>
                <td>{row.entityType}</td>
                <td>
                  <button
                    type="button"
                    className="d2d-link-button"
                    title={`${row.uri} を開きます`}
                    onClick={() => openResource(row.uri, row.title ?? row.code, { preview: false })}
                  >
                    {row.uri}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
