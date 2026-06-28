import React, { useEffect, useState, useCallback } from 'react'
import type { ResourceRow, ResourceEntityType } from '../types/d2d-api'
import { ResourceEditForm } from '../components/design/ResourceEditForm'

const RESOURCE_TYPES: { value: ResourceEntityType; label: string }[] = [
  { value: 'resource_label', label: 'ラベル' },
  { value: 'resource_text', label: 'テキスト' },
  { value: 'resource_list', label: 'リスト' },
  { value: 'resource_figure', label: '図' },
  { value: 'resource_table', label: '表' },
  { value: 'resource_formula', label: '数式' },
  { value: 'resource_code', label: 'コード' },
  { value: 'resource_model', label: 'モデル' },
  { value: 'resource_scenario', label: 'シナリオ' },
  { value: 'resource_interface', label: 'インターフェース' },
  { value: 'resource_state_transition', label: '状態遷移' },
  { value: 'resource_data_structure', label: 'データ構造' },
  { value: 'resource_reference', label: '参照' },
  { value: 'resource_metadata', label: 'メタデータ' },
  { value: 'resource_glossary', label: '用語' },
]

export function DesignElementsPage(): React.JSX.Element {
  const [selectedType, setSelectedType] = useState<ResourceEntityType>('resource_text')
  const [resources, setResources] = useState<ResourceRow[]>([])
  const [selected, setSelected] = useState<ResourceRow | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (type: ResourceEntityType) => {
    setLoading(true)
    setError(null)
    try {
      const list = await window.api.design.listResources(type)
      setResources(list)
      setSelected(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load(selectedType); setEditMode(false) }, [selectedType, load])

  const handleDelete = async (uid: string) => {
    if (!confirm('このリソースを削除しますか？')) return
    try {
      await window.api.design.deleteResource(uid)
      load(selectedType)
    } catch (e) {
      setError(String(e))
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontSize: 13 }}>
      {/* サイドバー: 種別選択 */}
      <div style={{ width: 180, borderRight: '1px solid #e0e0e0', overflow: 'auto', padding: '8px 0' }}>
        <div style={{ padding: '8px 12px', fontWeight: 600, color: '#555', fontSize: 12 }}>リソース種別</div>
        {RESOURCE_TYPES.map((t) => (
          <div
            key={t.value}
            onClick={() => setSelectedType(t.value)}
            style={{
              padding: '7px 16px',
              cursor: 'pointer',
              background: selectedType === t.value ? '#eff6ff' : 'transparent',
              color: selectedType === t.value ? '#1d4ed8' : '#333',
              fontWeight: selectedType === t.value ? 600 : 400,
            }}
          >
            {t.label}
          </div>
        ))}
      </div>

      {/* 中央: 一覧 */}
      <div style={{ width: 340, borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', borderBottom: '1px solid #e0e0e0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontWeight: 600 }}>
            {RESOURCE_TYPES.find(t => t.value === selectedType)?.label}
          </span>
          <span style={{ color: '#888', fontSize: 12 }}>({resources.length})</span>
        </div>
        {error && <div style={{ color: 'red', padding: 8, fontSize: 12 }}>{error}</div>}
        {loading ? (
          <div style={{ padding: 16, color: '#888' }}>読み込み中…</div>
        ) : (
          <div style={{ overflow: 'auto', flex: 1 }}>
            {resources.length === 0 ? (
              <div style={{ padding: 16, color: '#aaa' }}>データがありません</div>
            ) : (
              resources.map((r) => (
                <div
                  key={r.uid}
                  onClick={() => setSelected(r)}
                  style={{
                    padding: '9px 14px',
                    borderBottom: '1px solid #f0f0f0',
                    cursor: 'pointer',
                    background: selected?.uid === r.uid ? '#eff6ff' : 'transparent',
                  }}
                >
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.title}
                  </div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{r.code} · {r.status}</div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 右ペイン: 詳細 / 編集 */}
      <div style={{ flex: 1, padding: 20, overflow: 'auto' }}>
        {selected ? (
          <>
            {/* ヘッダー */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{selected.title}</h3>
                <div style={{ fontSize: 11, color: '#888' }}>
                  {selected.code} · {selected.entity_type} · {selected.status}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={() => setEditMode((v) => !v)}
                  style={{ padding: '4px 10px', background: editMode ? 'var(--srd-color-primary, #2563eb)' : 'var(--srd-color-surface-variant)', color: editMode ? '#fff' : 'var(--srd-color-on-surface)', border: '1px solid var(--srd-color-border)', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                >
                  {editMode ? '▶ 表示' : '✏ 編集'}
                </button>
                <button
                  onClick={() => handleDelete(selected.uid)}
                  style={{ padding: '4px 10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                >
                  削除
                </button>
              </div>
            </div>

            {/* 編集フォーム / 詳細ビュー */}
            {editMode ? (
              <ResourceEditForm
                resource={selected}
                onSaved={() => load(selectedType)}
              />
            ) : (
              <>
                <div style={{ background: '#f9fafb', borderRadius: 6, padding: 16, fontSize: 12 }}>
                  <pre style={{ margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                    {JSON.stringify(
                      Object.fromEntries(
                        Object.entries(selected).filter(([k]) => !['uid', 'code', 'title', 'status', 'entity_type', 'created_at', 'updated_at'].includes(k))
                      ),
                      null,
                      2
                    )}
                  </pre>
                </div>
                <div style={{ marginTop: 16 }}>
                  <TraceLinkSection uid={selected.uid} />
                </div>
              </>
            )}
          </>
        ) : (
          <div style={{ color: '#aaa' }}>リソースを選択してください</div>
        )}
      </div>
    </div>
  )
}

function TraceLinkSection({ uid }: { uid: string }): React.JSX.Element {
  const [links, setLinks] = useState<Awaited<ReturnType<typeof window.api.design.listTraceLinks>>>([])

  useEffect(() => {
    window.api.design.listTraceLinks(uid).then(setLinks).catch(() => {})
  }, [uid])

  if (links.length === 0) return <div style={{ color: '#aaa', fontSize: 12 }}>トレースリンクなし</div>

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6, color: '#555' }}>トレースリンク ({links.length})</div>
      {links.map((l) => (
        <div key={l.uid} style={{ fontSize: 12, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
          <span style={{ color: '#888' }}>{l.from_uid === uid ? '→' : '←'}</span>{' '}
          <strong>{l.relation_type}</strong>{' '}
          {l.from_uid === uid ? l.to_title : l.from_title}
          <span style={{ color: '#aaa', marginLeft: 6 }}>({l.from_uid === uid ? l.to_entity_type : l.from_entity_type})</span>
        </div>
      ))}
    </div>
  )
}
