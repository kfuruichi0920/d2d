import React, { useCallback, useEffect, useRef, useState } from 'react'

interface ExtractedDoc {
  uid: string
  code: string
  title: string
  extraction_status: string
  file_name: string
  file_type: string
  extracted_at: string | null
  item_count: number
}

interface ExtractedItem {
  uid: string
  code: string
  title: string
  item_type: string
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  pending:  { label: '待機中',   color: '#92400e' },
  running:  { label: '実行中',   color: '#1e40af' },
  success:  { label: '完了',     color: '#065f46' },
  failed:   { label: '失敗',     color: '#991b1b' },
  partial:  { label: '一部完了', color: '#6b21a8' },
}

const STATUS_BG: Record<string, string> = {
  pending: '#fef3c7', running: '#dbeafe', success: '#d1fae5', failed: '#fee2e2', partial: '#f3e8ff',
}

const ITEM_TYPE_LABEL: Record<string, string> = {
  label: '見出し', text: '段落', table: '表', model: 'モデル',
  code: 'コード', list: 'リスト', figure: '図',
}

const DOCS_SQL = `
  SELECT
    ed.uid, ed.extraction_status, ed.extracted_at,
    er.code, er.title,
    sd.file_name, sd.file_type,
    COUNT(ei.uid) AS item_count
  FROM extracted_document ed
  JOIN entity_registry er ON er.uid = ed.uid
  JOIN source_document sd ON sd.uid = ed.source_document_uid
  LEFT JOIN extracted_item ei ON ei.extracted_document_uid = ed.uid
  WHERE er.status != 'deleted'
  GROUP BY ed.uid
  ORDER BY er.created_at DESC
`

const ITEMS_SQL = `
  SELECT ei.uid, er.code, er.title, ei.item_type
  FROM extracted_item ei
  JOIN entity_registry er ON er.uid = ei.uid
  WHERE ei.extracted_document_uid = ?
  ORDER BY er.created_at ASC
`

export function ExtractedDataPage(): React.JSX.Element {
  const [docs, setDocs] = useState<ExtractedDoc[]>([])
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [items, setItems] = useState<ExtractedItem[]>([])
  const [loadingDocs, setLoadingDocs] = useState(false)
  const [loadingItems, setLoadingItems] = useState(false)
  const [itemFilter, setItemFilter] = useState('')

  // selectedUid を ref で保持（loadDocs の依存から外すため）
  const selectedUidRef = useRef(selectedUid)
  selectedUidRef.current = selectedUid

  const loadDocs = useCallback(async () => {
    setLoadingDocs(true)
    try {
      const rows = (await window.api.store.query(DOCS_SQL)) as ExtractedDoc[]
      setDocs(rows)
    } catch (e) {
      console.error('Failed to load extracted docs', e)
    } finally {
      setLoadingDocs(false)
    }
  }, []) // 依存なし — selectedUid は ref 経由で参照

  useEffect(() => {
    loadDocs()
    const off = window.api.events.on('d2d:job:updated', loadDocs)
    return off
  }, [loadDocs])

  // selectedUid が変わったらアイテムを読み込む
  useEffect(() => {
    if (!selectedUid) { setItems([]); return }
    setLoadingItems(true)
    setItemFilter('')
    ;(window.api.store.query(ITEMS_SQL, [selectedUid]) as Promise<ExtractedItem[]>)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoadingItems(false))
  }, [selectedUid])

  const selectedDoc = docs.find(d => d.uid === selectedUid) ?? null

  const filteredItems = itemFilter
    ? items.filter(it =>
        it.title.toLowerCase().includes(itemFilter.toLowerCase()) ||
        it.item_type.includes(itemFilter) ||
        it.code.includes(itemFilter)
      )
    : items

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontSize: 13 }}>
      {/* 左ペイン */}
      <div style={{ width: 300, flexShrink: 0, borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <span style={{ fontWeight: 600, fontSize: 12, color: '#555' }}>抽出済みドキュメント</span>
          <button
            onClick={loadDocs}
            disabled={loadingDocs}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#2563eb', padding: '2px 6px' }}
          >
            {loadingDocs ? '...' : '更新'}
          </button>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {docs.length === 0 && !loadingDocs ? (
            <div style={{ padding: 20, color: '#aaa', fontSize: 12, lineHeight: 1.6 }}>
              抽出済みデータがありません。<br />
              原本ドキュメントページから抽出を実行してください。
            </div>
          ) : (
            docs.map(doc => {
              const st = STATUS_LABEL[doc.extraction_status] ?? { label: doc.extraction_status, color: '#555' }
              const active = doc.uid === selectedUid
              return (
                <div
                  key={doc.uid}
                  onClick={() => setSelectedUid(doc.uid)}
                  style={{
                    padding: '10px 14px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f0f0f0',
                    background: active ? '#eff6ff' : 'transparent',
                    borderLeft: active ? '3px solid #2563eb' : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace' }}>{doc.code}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: STATUS_BG[doc.extraction_status] ?? '#f0f0f0',
                      color: st.color, fontWeight: 600,
                    }}>
                      {st.label}
                    </span>
                  </div>
                  <div style={{ fontWeight: 500, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
                    {doc.file_name}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>{doc.file_type}</span>
                    <span>{doc.item_count} アイテム</span>
                    {doc.extracted_at && (
                      <span>{new Date(doc.extracted_at).toLocaleString('ja-JP')}</span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* 右ペイン */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedDoc ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#bbb', fontSize: 13 }}>
            左のリストからドキュメントを選択
          </div>
        ) : (
          <>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #e0e0e0', background: '#fafafa', flexShrink: 0 }}>
              <div style={{ fontWeight: 600, marginBottom: 2, fontSize: 13 }}>{selectedDoc.file_name}</div>
              <div style={{ fontSize: 11, color: '#888' }}>
                {selectedDoc.code} · {items.length} アイテム
              </div>
            </div>

            <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', flexShrink: 0 }}>
              <input
                value={itemFilter}
                onChange={e => setItemFilter(e.target.value)}
                placeholder="アイテムを検索..."
                style={{
                  width: '100%', boxSizing: 'border-box', padding: '5px 10px',
                  fontSize: 12, border: '1px solid #d1d5db', borderRadius: 5, outline: 'none',
                }}
              />
            </div>

            <div style={{ flex: 1, overflow: 'auto' }}>
              {loadingItems ? (
                <div style={{ padding: 20, color: '#aaa', fontSize: 12 }}>読み込み中...</div>
              ) : filteredItems.length === 0 ? (
                <div style={{ padding: 20, color: '#bbb', fontSize: 12 }}>
                  {itemFilter ? '検索結果がありません' : 'アイテムがありません'}
                </div>
              ) : (
                <ItemTypeGrouped items={filteredItems} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function ItemTypeGrouped({ items }: { items: ExtractedItem[] }): React.JSX.Element {
  const groups: Record<string, ExtractedItem[]> = {}
  for (const item of items) {
    if (!groups[item.item_type]) groups[item.item_type] = []
    groups[item.item_type].push(item)
  }
  return (
    <div>
      {Object.entries(groups).map(([type, groupItems]) => (
        <ItemGroup key={type} type={type} items={groupItems} />
      ))}
    </div>
  )
}

function ItemGroup({ type, items }: { type: string; items: ExtractedItem[] }): React.JSX.Element {
  const [open, setOpen] = useState(true)
  const label = ITEM_TYPE_LABEL[type] ?? type

  return (
    <div>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '5px 14px', fontWeight: 600, fontSize: 11, color: '#555',
          background: '#f9fafb', borderBottom: '1px solid #f0f0f0',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 9 }}>{open ? '▼' : '▶'}</span>
        <span>{label}</span>
        <span style={{ color: '#aaa', fontWeight: 400 }}>({items.length})</span>
      </div>
      {open && items.map(item => (
        <div
          key={item.uid}
          style={{
            padding: '5px 14px 5px 26px', borderBottom: '1px solid #f5f5f5',
            display: 'flex', alignItems: 'baseline', gap: 10,
          }}
        >
          <span style={{ fontSize: 10, color: '#bbb', fontFamily: 'monospace', flexShrink: 0 }}>
            {item.code}
          </span>
          <span style={{ color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
            {item.title || <span style={{ color: '#ccc' }}>（タイトルなし）</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
