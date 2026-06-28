/**
 * IntermediatePage — 中間データ管理ページ
 * T302: アイテム編集（タイトル・追加・削除・マージ・昇格プロモート）
 * T303: 図・表 → resource_figure / resource_table 昇格
 * T304: モデル・シナリオ等 → 設計リソース昇格
 */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import type { IntermediateDocumentRow, IntermediateItemRow } from '../types/d2d-api'

// ─── 定数 ────────────────────────────────────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  pending: '未処理', running: '処理中', success: '完了', failed: '失敗', partial: '部分完了',
}

const ITEM_TYPE_LABEL: Record<string, string> = {
  label: '見出し', text: '段落', table: '表', figure: '図',
  model: 'モデル', scenario: 'シナリオ', state_transition: '状態遷移',
  interface: 'インタフェース', code: 'コード', list: 'リスト',
}

const ITEM_TYPE_COLOR: Record<string, string> = {
  label: '#1e40af', text: '#374151', table: '#065f46', figure: '#6b21a8',
  model: '#92400e', scenario: '#0f766e', state_transition: '#b45309',
  interface: '#9f1239', code: '#5b21b6', list: '#374151',
}

const RESOURCE_TYPE_MAP: Record<string, string> = {
  table: 'resource_table', figure: 'resource_figure', model: 'resource_model',
  scenario: 'resource_scenario', state_transition: 'resource_state_transition',
  interface: 'resource_interface', code: 'resource_code',
  label: 'resource_label', text: 'resource_text', list: 'resource_list',
}

type Tab = 'items' | 'figures-tables' | 'models'

// ─── ExtractedDoc (for promote dialog) ──────────────────────────────
interface ExtractedDocItem { uid: string; file_name: string; code: string }

// ─── Main ────────────────────────────────────────────────────────────
export function IntermediatePage(): React.JSX.Element {
  const [docs, setDocs] = useState<IntermediateDocumentRow[]>([])
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [items, setItems] = useState<IntermediateItemRow[]>([])
  const [tab, setTab] = useState<Tab>('items')
  const [loading, setLoading] = useState(false)

  const selectedUidRef = useRef(selectedUid)
  selectedUidRef.current = selectedUid

  const loadDocs = useCallback(async () => {
    const list = await window.api.intermediate.list()
    setDocs(list)
  }, [])

  const loadItems = useCallback(async (uid: string) => {
    setLoading(true)
    try {
      const list = await window.api.intermediate.listItems(uid)
      setItems(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadDocs() }, [loadDocs])

  useEffect(() => {
    if (!selectedUid) { setItems([]); return }
    loadItems(selectedUid)
  }, [selectedUid, loadItems])

  const selectedDoc = docs.find(d => d.uid === selectedUid) ?? null

  const reload = async () => {
    await loadDocs()
    if (selectedUidRef.current) await loadItems(selectedUidRef.current)
  }

  const handleCreate = async () => {
    const title = prompt('中間データのタイトル:', '新規中間データ')
    if (!title) return
    await window.api.intermediate.create({ title })
    await loadDocs()
  }

  const handleRename = async () => {
    if (!selectedDoc) return
    const t = prompt('タイトルを変更:', selectedDoc.title)
    if (!t || t === selectedDoc.title) return
    await window.api.intermediate.rename(selectedDoc.uid, t)
    await loadDocs()
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontSize: 13 }}>
      {/* ── 左ペイン ── */}
      <div style={{ width: 260, flexShrink: 0, borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 12, color: '#555', flex: 1 }}>中間データ</span>
          <button onClick={handleCreate} style={smallBtn('#2563eb')}>+ 新規</button>
          <button onClick={loadDocs} style={smallBtn('#6b7280')}>↻</button>
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {docs.length === 0 ? (
            <div style={{ padding: 16, color: '#aaa', fontSize: 12 }}>中間データがありません</div>
          ) : (
            docs.map(doc => {
              const active = doc.uid === selectedUid
              return (
                <div
                  key={doc.uid}
                  onClick={() => setSelectedUid(doc.uid)}
                  style={{
                    padding: '9px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0',
                    background: active ? '#eff6ff' : 'transparent',
                    borderLeft: active ? '3px solid #2563eb' : '3px solid transparent',
                  }}
                >
                  <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {doc.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#888' }}>
                    {doc.code} · {STATUS_LABEL[doc.intermediate_status] ?? doc.intermediate_status} · {doc.item_count} items
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* ── 右ペイン ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {!selectedDoc ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#bbb', fontSize: 13 }}>
            左のリストから中間データを選択
          </div>
        ) : (
          <>
            {/* ヘッダー */}
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #e0e0e0', background: '#fafafa', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontWeight: 600, flex: 1 }}>{selectedDoc.title}</span>
              <span style={{ fontSize: 11, color: '#888' }}>{selectedDoc.code} · {items.length} アイテム</span>
              <button onClick={handleRename} style={smallBtn('#6b7280')}>名称変更</button>
            </div>

            {/* タブ */}
            <div style={{ display: 'flex', borderBottom: '1px solid #e0e0e0', flexShrink: 0, background: '#f9fafb' }}>
              {([
                { id: 'items', label: 'アイテム編集' },
                { id: 'figures-tables', label: '図・表管理' },
                { id: 'models', label: '設計モデル管理' },
              ] as { id: Tab; label: string }[]).map(t => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  style={{
                    padding: '8px 16px', border: 'none', borderBottom: tab === t.id ? '2px solid #2563eb' : '2px solid transparent',
                    background: 'transparent', cursor: 'pointer', fontSize: 12,
                    color: tab === t.id ? '#2563eb' : '#555', fontWeight: tab === t.id ? 600 : 400,
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* タブコンテンツ */}
            <div style={{ flex: 1, overflow: 'auto' }}>
              {loading ? (
                <div style={{ padding: 20, color: '#aaa', fontSize: 12 }}>読み込み中...</div>
              ) : tab === 'items' ? (
                <ItemsTab doc={selectedDoc} items={items} onReload={reload} />
              ) : tab === 'figures-tables' ? (
                <FiguresTablesTab doc={selectedDoc} items={items} onReload={reload} />
              ) : (
                <ModelsTab doc={selectedDoc} items={items} onReload={reload} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─── T302: アイテム編集タブ ──────────────────────────────────────────
function ItemsTab({
  doc, items, onReload,
}: { doc: IntermediateDocumentRow; items: IntermediateItemRow[]; onReload: () => void }): React.JSX.Element {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editingUid, setEditingUid] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [showPromoteDialog, setShowPromoteDialog] = useState(false)
  const [extractedDocs, setExtractedDocs] = useState<ExtractedDocItem[]>([])

  const toggleSelect = (uid: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid); else next.add(uid)
      return next
    })
  }

  const handleSaveTitle = async (uid: string) => {
    if (!editTitle.trim()) return
    await window.api.store.execute(
      `UPDATE entity_registry SET title = ? WHERE uid = ?`, [editTitle.trim(), uid]
    )
    setEditingUid(null)
    onReload()
  }

  const handleDelete = async (uid: string) => {
    if (!confirm('このアイテムを削除しますか？')) return
    await window.api.intermediate.deleteItem(uid)
    setSelected(prev => { const n = new Set(prev); n.delete(uid); return n })
    onReload()
  }

  const handleMerge = async () => {
    const selUids = [...selected]
    if (selUids.length < 2) { alert('2つ以上のアイテムを選択してください'); return }
    const firstItem = items.find(i => i.uid === selUids[0])
    const defaultTitle = prompt('マージ後のタイトル:', firstItem?.title ?? '')
    if (defaultTitle === null) return
    await window.api.intermediate.mergeItems(selUids, selUids[0], defaultTitle)
    setSelected(new Set())
    onReload()
  }

  const handleAddItem = async () => {
    const title = prompt('アイテムのタイトル:', '')
    if (!title) return
    await window.api.intermediate.addItem(doc.uid, 'text', title)
    onReload()
  }

  const openPromoteDialog = async () => {
    const rows = (await window.api.store.query(
      `SELECT sd.uid, sd.file_name, er.code FROM extracted_document ed
       JOIN source_document sd ON sd.uid = ed.source_document_uid
       JOIN entity_registry er ON er.uid = ed.uid
       WHERE ed.extraction_status = 'success'
       ORDER BY er.created_at DESC`
    )) as ExtractedDocItem[]
    setExtractedDocs(rows)
    setShowPromoteDialog(true)
  }

  const handlePromote = async (extractedDocUid: string) => {
    const count = await window.api.intermediate.promoteFromExtracted(extractedDocUid, doc.uid)
    setShowPromoteDialog(false)
    alert(`${count} アイテムを昇格しました`)
    onReload()
  }

  return (
    <div style={{ padding: '12px 16px' }}>
      {/* ツールバー */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button onClick={openPromoteDialog} style={smallBtn('#2563eb')}>抽出データから昇格</button>
        <button onClick={handleAddItem} style={smallBtn('#059669')}>+ アイテム追加</button>
        <button onClick={handleMerge} disabled={selected.size < 2} style={smallBtn('#d97706', selected.size < 2)}>
          選択をマージ ({selected.size})
        </button>
        {selected.size > 0 && (
          <button onClick={() => setSelected(new Set())} style={smallBtn('#6b7280')}>選択解除</button>
        )}
      </div>

      {/* アイテム一覧 */}
      {items.length === 0 ? (
        <div style={{ color: '#aaa', fontSize: 12, padding: '20px 0' }}>
          アイテムがありません。「抽出データから昇格」または「アイテム追加」で作成してください。
        </div>
      ) : (
        <div>
          {items.map(item => (
            <div
              key={item.uid}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '7px 8px',
                borderBottom: '1px solid #f0f0f0', background: selected.has(item.uid) ? '#eff6ff' : 'transparent',
                borderRadius: 4,
              }}
            >
              <input
                type="checkbox"
                checked={selected.has(item.uid)}
                onChange={() => toggleSelect(item.uid)}
                style={{ flexShrink: 0 }}
              />
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 8, flexShrink: 0,
                background: '#f0f0f0', color: ITEM_TYPE_COLOR[item.item_type] ?? '#555', fontWeight: 600,
              }}>
                {ITEM_TYPE_LABEL[item.item_type] ?? item.item_type}
              </span>

              {editingUid === item.uid ? (
                <>
                  <input
                    autoFocus
                    value={editTitle}
                    onChange={e => setEditTitle(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveTitle(item.uid); if (e.key === 'Escape') setEditingUid(null) }}
                    style={{ flex: 1, padding: '3px 6px', fontSize: 12, border: '1px solid #2563eb', borderRadius: 4 }}
                  />
                  <button onClick={() => handleSaveTitle(item.uid)} style={smallBtn('#2563eb')}>保存</button>
                  <button onClick={() => setEditingUid(null)} style={smallBtn('#6b7280')}>✕</button>
                </>
              ) : (
                <>
                  <span
                    style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'pointer' }}
                    onDoubleClick={() => { setEditingUid(item.uid); setEditTitle(item.title) }}
                    title={item.title}
                  >
                    {item.title || <span style={{ color: '#ccc' }}>（ダブルクリックで編集）</span>}
                  </span>
                  <button
                    onClick={() => { setEditingUid(item.uid); setEditTitle(item.title) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#6b7280', padding: '2px 4px' }}
                  >✏</button>
                  <button
                    onClick={() => handleDelete(item.uid)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 11, color: '#dc2626', padding: '2px 4px' }}
                  >削</button>
                </>
              )}
              {item.resource_uid && (
                <span style={{ fontSize: 10, color: '#059669', flexShrink: 0 }}>↗リソース済</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 昇格ダイアログ */}
      {showPromoteDialog && (
        <div style={overlay}>
          <div style={dialog}>
            <h3 style={{ margin: '0 0 12px', fontSize: 14 }}>抽出済みドキュメントを選択</h3>
            {extractedDocs.length === 0 ? (
              <div style={{ color: '#aaa', fontSize: 12 }}>抽出完了のドキュメントがありません</div>
            ) : (
              <div style={{ maxHeight: 280, overflow: 'auto' }}>
                {extractedDocs.map(ed => (
                  <div
                    key={ed.uid}
                    onClick={() => handlePromote(ed.uid)}
                    style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f0f0f0', borderRadius: 4 }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#eff6ff')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    <div style={{ fontWeight: 500, fontSize: 12 }}>{ed.file_name}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{ed.code}</div>
                  </div>
                ))}
              </div>
            )}
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <button onClick={() => setShowPromoteDialog(false)} style={smallBtn('#6b7280')}>キャンセル</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── T303: 図・表管理タブ ────────────────────────────────────────────
function FiguresTablesTab({
  items, onReload,
}: { doc: IntermediateDocumentRow; items: IntermediateItemRow[]; onReload: () => void }): React.JSX.Element {
  const targetTypes = ['table', 'figure']
  const filtered = items.filter(i => targetTypes.includes(i.item_type))

  const handlePromote = async (item: IntermediateItemRow) => {
    const resourceType = RESOURCE_TYPE_MAP[item.item_type]
    if (!resourceType) return
    const title = prompt('リソースのタイトル:', item.title)
    if (!title) return
    const resourceUid = await window.api.intermediate.promoteToResource(item.uid, resourceType, title)
    alert(`リソースを作成しました: ${resourceUid}`)
    onReload()
  }

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
        item_type が「表」「図」のアイテムを設計リソースに昇格します。
      </div>
      {filtered.length === 0 ? (
        <div style={{ color: '#aaa', fontSize: 12 }}>図・表アイテムがありません</div>
      ) : (
        <div>
          {filtered.map(item => (
            <ResourceRow key={item.uid} item={item} onPromote={handlePromote} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── T304: 設計モデル管理タブ ────────────────────────────────────────
function ModelsTab({
  items, onReload,
}: { doc: IntermediateDocumentRow; items: IntermediateItemRow[]; onReload: () => void }): React.JSX.Element {
  const targetTypes = ['model', 'scenario', 'state_transition', 'interface', 'code']
  const filtered = items.filter(i => targetTypes.includes(i.item_type))

  const handlePromote = async (item: IntermediateItemRow) => {
    const resourceType = RESOURCE_TYPE_MAP[item.item_type]
    if (!resourceType) return
    const title = prompt('リソースのタイトル:', item.title)
    if (!title) return
    const resourceUid = await window.api.intermediate.promoteToResource(item.uid, resourceType, title)
    alert(`リソースを作成しました: ${resourceUid}`)
    onReload()
  }

  return (
    <div style={{ padding: '12px 16px' }}>
      <div style={{ fontSize: 12, color: '#888', marginBottom: 12 }}>
        モデル・シナリオ・状態遷移・インタフェース・コードアイテムを設計リソースに昇格します。
      </div>
      {filtered.length === 0 ? (
        <div style={{ color: '#aaa', fontSize: 12 }}>対象アイテムがありません</div>
      ) : (
        <div>
          {filtered.map(item => (
            <ResourceRow key={item.uid} item={item} onPromote={handlePromote} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── 共通: リソース昇格行 ────────────────────────────────────────────
function ResourceRow({
  item, onPromote,
}: { item: IntermediateItemRow; onPromote: (item: IntermediateItemRow) => void }): React.JSX.Element {
  const resourceLabel: Record<string, string> = {
    resource_table: 'resource_table', resource_figure: 'resource_figure',
    resource_model: 'resource_model', resource_scenario: 'resource_scenario',
    resource_state_transition: 'resource_state_transition',
    resource_interface: 'resource_interface', resource_code: 'resource_code',
  }
  const rt = RESOURCE_TYPE_MAP[item.item_type]

  return (
    <div style={{ padding: '8px 10px', borderBottom: '1px solid #f0f0f0', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 8, background: '#f0f0f0', color: ITEM_TYPE_COLOR[item.item_type] ?? '#555', fontWeight: 600, flexShrink: 0 }}>
        {ITEM_TYPE_LABEL[item.item_type] ?? item.item_type}
      </span>
      <span style={{ flex: 1, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.title}</span>
      {item.resource_uid ? (
        <span style={{ fontSize: 11, color: '#059669', flexShrink: 0 }}>✓ {resourceLabel[rt] ?? rt} 作成済</span>
      ) : (
        <button onClick={() => onPromote(item)} style={smallBtn('#7c3aed')}>
          → {resourceLabel[rt] ?? rt} 作成
        </button>
      )}
    </div>
  )
}

// ─── スタイルヘルパー ────────────────────────────────────────────────
function smallBtn(bg: string, disabled = false): React.CSSProperties {
  return {
    padding: '3px 10px', background: disabled ? '#d1d5db' : bg, color: '#fff',
    border: 'none', borderRadius: 4, cursor: disabled ? 'not-allowed' : 'pointer', fontSize: 11,
  }
}

const overlay: React.CSSProperties = {
  position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
}

const dialog: React.CSSProperties = {
  background: '#fff', borderRadius: 10, padding: 20, minWidth: 340, maxWidth: 480,
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
}
