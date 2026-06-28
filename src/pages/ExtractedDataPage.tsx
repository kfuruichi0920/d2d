import React, { useCallback, useEffect, useState } from 'react'

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

export function ExtractedDataPage(): React.JSX.Element {
  const [docs, setDocs] = useState<ExtractedDoc[]>([])
  const [selected, setSelected] = useState<ExtractedDoc | null>(null)
  const [items, setItems] = useState<ExtractedItem[]>([])
  const [loadingItems, setLoadingItems] = useState(false)
  const [itemFilter, setItemFilter] = useState('')

  const loadDocs = useCallback(async () => {
    const rows = (await window.api.store.query(`
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
    `)) as ExtractedDoc[]
    setDocs(rows)
    // 選択中ドキュメントの最新状態を反映
    if (selected) {
      const updated = rows.find(r => r.uid === selected.uid)
      if (updated) setSelected(updated)
    }
  }, [selected])

  useEffect(() => {
    loadDocs()
    // ジョブ更新イベントで再読み込み
    const off = window.api.events.on('d2d:job:updated', loadDocs)
    return off
  }, [loadDocs])

  useEffect(() => {
    if (!selected) { setItems([]); return }
    setLoadingItems(true)
    (window.api.store.query(`
      SELECT ei.uid, er.code, er.title, ei.item_type
      FROM extracted_item ei
      JOIN entity_registry er ON er.uid = ei.uid
      WHERE ei.extracted_document_uid = ?
      ORDER BY er.created_at ASC
    `, [selected.uid]) as Promise<ExtractedItem[]>)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoadingItems(false))
  }, [selected])

  const filteredItems = itemFilter
    ? items.filter(it =>
        it.title.includes(itemFilter) ||
        it.item_type.includes(itemFilter) ||
        it.code.includes(itemFilter)
      )
    : items

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontSize: 13 }}>
      {/* 左ペイン: 抽出済みドキュメント一覧 */}
      <div style={{ width: 320, flexShrink: 0, borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>抽出済みドキュメント</span>
          <button
            onClick={loadDocs}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#2563eb', padding: '2px 6px' }}
          >
            更新
          </button>
        </div>

        {docs.length === 0 ? (
          <div style={{ padding: 24, color: '#888', fontSize: 12 }}>
            抽出済みデータがありません。<br />
            原本ドキュメントページから抽出を実行してください。
          </div>
        ) : (
          <div style={{ flex: 1, overflow: 'auto' }}>
            {docs.map(doc => {
              const st = STATUS_LABEL[doc.extraction_status] ?? { label: doc.extraction_status, color: '#555' }
              const active = selected?.uid === doc.uid
              return (
                <div
                  key={doc.uid}
                  onClick={() => setSelected(doc)}
                  style={{
                    padding: '10px 16px',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f0f0f0',
                    background: active ? '#eff6ff' : 'transparent',
                    borderLeft: active ? '3px solid #2563eb' : '3px solid transparent',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, color: '#888' }}>{doc.code}</span>
                    <span style={{
                      fontSize: 10, padding: '1px 6px', borderRadius: 10,
                      background: STATUS_BG[doc.extraction_status] ?? '#f0f0f0',
                      color: st.color, fontWeight: 600,
                    }}>
                      {st.label}
                    </span>
                  </div>
                  <div style={{ fontWeight: 500, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.file_name}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', display: 'flex', gap: 12 }}>
                    <span>{doc.file_type}</span>
                    <span>{doc.item_count} アイテム</span>
                    {doc.extracted_at && <span>{new Date(doc.extracted_at).toLocaleString('ja-JP')}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 右ペイン: 抽出アイテム一覧 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: 13 }}>
            左のリストからドキュメントを選択してください
          </div>
        ) : (
          <>
            {/* ヘッダー */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #e0e0e0', background: '#fafafa' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>{selected.file_name}</div>
              <div style={{ fontSize: 11, color: '#888' }}>
                {selected.code} · {items.length} アイテム
              </div>
            </div>

            {/* 検索 */}
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0' }}>
              <input
                value={itemFilter}
                onChange={e => setItemFilter(e.target.value)}
                placeholder="アイテムを検索..."
                style={{
                  width: '100%', boxSizing: 'border-box',
                  padding: '5px 10px', fontSize: 12,
                  border: '1px solid #d1d5db', borderRadius: 5,
                  outline: 'none',
                }}
              />
            </div>

            {/* アイテム一覧 */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {loadingItems ? (
                <div style={{ padding: 24, color: '#888', fontSize: 12 }}>読み込み中...</div>
              ) : filteredItems.length === 0 ? (
                <div style={{ padding: 24, color: '#aaa', fontSize: 12 }}>アイテムがありません</div>
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
  // item_type ごとにグループ化
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
          padding: '6px 16px', fontWeight: 600, fontSize: 11,
          color: '#555', background: '#f9fafb',
          borderBottom: '1px solid #f0f0f0',
          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
          userSelect: 'none',
        }}
      >
        <span style={{ fontSize: 10 }}>{open ? '▼' : '▶'}</span>
        <span>{label}</span>
        <span style={{ color: '#aaa', fontWeight: 400 }}>({items.length})</span>
      </div>
      {open && items.map(item => (
        <div
          key={item.uid}
          style={{
            padding: '6px 16px 6px 28px',
            borderBottom: '1px solid #f5f5f5',
            display: 'flex', alignItems: 'baseline', gap: 10,
          }}
        >
          <span style={{ fontSize: 10, color: '#aaa', fontFamily: 'monospace', flexShrink: 0 }}>
            {item.code}
          </span>
          <span style={{ color: '#222', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {item.title || <span style={{ color: '#bbb' }}>（タイトルなし）</span>}
          </span>
        </div>
      ))}
    </div>
  )
}
