import React, { useEffect, useState, useCallback, useRef } from 'react'
import type { GlossaryTermRow, GlossarySynonymRow } from '../types/d2d-api'

export function GlossaryPage(): React.JSX.Element {
  const [terms, setTerms] = useState<GlossaryTermRow[]>([])
  const [selected, setSelected] = useState<GlossaryTermRow | null>(null)
  const [synonyms, setSynonyms] = useState<GlossarySynonymRow[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 新規作成フォーム
  const [showForm, setShowForm] = useState(false)
  const [newTerm, setNewTerm] = useState({ termText: '', definition: '', abbreviation: '', category: '' })
  const [newSynonym, setNewSynonym] = useState('')
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = useCallback(async (s?: string) => {
    setLoading(true)
    try {
      const list = await window.api.design.listGlossaryTerms(s ? { search: s } : {})
      setTerms(list)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleSearchChange = (v: string) => {
    setSearch(v)
    if (searchTimer.current) clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => load(v), 300)
  }

  const selectTerm = async (t: GlossaryTermRow) => {
    setSelected(t)
    const syns = await window.api.design.listSynonyms(t.uid)
    setSynonyms(syns)
  }

  const handleCreate = async () => {
    if (!newTerm.termText.trim()) return
    try {
      await window.api.design.createGlossaryTerm({
        termText: newTerm.termText.trim(),
        definition: newTerm.definition || undefined,
        abbreviation: newTerm.abbreviation || undefined,
        category: newTerm.category || undefined,
      })
      setNewTerm({ termText: '', definition: '', abbreviation: '', category: '' })
      setShowForm(false)
      load(search)
    } catch (e) {
      setError(String(e))
    }
  }

  const handleConfirm = async (uid: string) => {
    await window.api.design.confirmGlossaryTerm(uid)
    load(search)
    if (selected?.uid === uid) {
      const updated = await window.api.design.getGlossaryTerm(uid)
      if (updated) setSelected(updated)
    }
  }

  const handleDelete = async (uid: string) => {
    if (!confirm('この用語を削除しますか？')) return
    await window.api.design.deleteGlossaryTerm(uid)
    setSelected(null)
    load(search)
  }

  const handleAddSynonym = async () => {
    if (!selected || !newSynonym.trim()) return
    await window.api.design.addSynonym(selected.uid, newSynonym.trim())
    setNewSynonym('')
    const syns = await window.api.design.listSynonyms(selected.uid)
    setSynonyms(syns)
  }

  const handleDeleteSynonym = async (uid: string) => {
    await window.api.design.deleteSynonym(uid)
    if (selected) {
      const syns = await window.api.design.listSynonyms(selected.uid)
      setSynonyms(syns)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontSize: 13 }}>
      {/* 左: 用語一覧 */}
      <div style={{ width: 300, borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #e0e0e0' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>用語集</span>
            <button onClick={() => setShowForm(true)} style={smallBtnStyle}>+ 新規</button>
          </div>
          <input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="検索…"
            style={{ width: '100%', padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, boxSizing: 'border-box' }}
          />
        </div>
        {error && <div style={{ color: 'red', fontSize: 12, padding: 6 }}>{error}</div>}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ padding: 12, color: '#aaa' }}>読み込み中…</div>
          ) : terms.length === 0 ? (
            <div style={{ padding: 12, color: '#aaa' }}>用語がありません</div>
          ) : (
            terms.map((t) => (
              <div
                key={t.uid}
                onClick={() => selectTerm(t)}
                style={{
                  padding: '8px 12px',
                  borderBottom: '1px solid #f0f0f0',
                  cursor: 'pointer',
                  background: selected?.uid === t.uid ? '#eff6ff' : 'transparent',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 500 }}>{t.term_text}</span>
                  {t.abbreviation && <span style={{ fontSize: 11, color: '#888' }}>({t.abbreviation})</span>}
                  {t.confirmed_at && <span style={{ fontSize: 10, color: '#059669', marginLeft: 'auto' }}>✓</span>}
                  {t.is_prohibited === 1 && <span style={{ fontSize: 10, color: '#dc2626', marginLeft: 'auto' }}>禁止</span>}
                </div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>
                  {t.code} · 同義語 {t.synonym_count}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右: 詳細 */}
      <div style={{ flex: 1, padding: 20, overflow: 'auto' }}>
        {showForm ? (
          <div style={{ maxWidth: 480 }}>
            <h3 style={{ margin: '0 0 16px', fontSize: 15 }}>新規用語登録</h3>
            {(['termText', 'definition', 'abbreviation', 'category'] as const).map((k) => (
              <div key={k} style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 12, color: '#555', display: 'block', marginBottom: 3 }}>
                  {{ termText: '用語 *', definition: '定義', abbreviation: '略語', category: 'カテゴリ' }[k]}
                </label>
                <input
                  value={newTerm[k]}
                  onChange={(e) => setNewTerm({ ...newTerm, [k]: e.target.value })}
                  style={inputStyle}
                />
              </div>
            ))}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button onClick={handleCreate} style={btnStyle}>登録</button>
              <button onClick={() => setShowForm(false)} style={{ ...btnStyle, background: '#6b7280' }}>キャンセル</button>
            </div>
          </div>
        ) : selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <h3 style={{ margin: '0 0 4px', fontSize: 16 }}>{selected.term_text}</h3>
                <div style={{ fontSize: 11, color: '#888' }}>
                  {selected.code}
                  {selected.language && ` · ${selected.language}`}
                  {selected.category && ` · ${selected.category}`}
                  {selected.confirmed_at ? ' · 確認済' : ' · 未確認'}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {!selected.confirmed_at && (
                  <button onClick={() => handleConfirm(selected.uid)} style={{ ...smallBtnStyle, background: '#059669' }}>確認</button>
                )}
                <button onClick={() => handleDelete(selected.uid)} style={{ ...smallBtnStyle, background: '#dc2626' }}>削除</button>
              </div>
            </div>

            {selected.abbreviation && (
              <div style={{ marginBottom: 8 }}><strong>略語:</strong> {selected.abbreviation}</div>
            )}
            {selected.definition && (
              <div style={{ marginBottom: 8, background: '#f9fafb', borderRadius: 4, padding: '8px 12px' }}>
                {selected.definition}
              </div>
            )}

            <div style={{ marginTop: 16 }}>
              <div style={{ fontWeight: 600, fontSize: 12, color: '#555', marginBottom: 6 }}>
                同義語 ({synonyms.length})
              </div>
              {synonyms.map((s) => (
                <div key={s.uid} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid #f0f0f0' }}>
                  <span style={{ flex: 1 }}>{s.synonym_text}</span>
                  {s.synonym_kind && <span style={{ color: '#888', fontSize: 11 }}>{s.synonym_kind}</span>}
                  <button onClick={() => handleDeleteSynonym(s.uid)} style={{ padding: '1px 6px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 3, cursor: 'pointer', fontSize: 11 }}>×</button>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <input
                  value={newSynonym}
                  onChange={(e) => setNewSynonym(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddSynonym()}
                  placeholder="同義語を追加…"
                  style={{ ...inputStyle, flex: 1 }}
                />
                <button onClick={handleAddSynonym} style={smallBtnStyle}>追加</button>
              </div>
            </div>
          </>
        ) : (
          <div style={{ color: '#aaa' }}>用語を選択するか、新規登録してください</div>
        )}
      </div>
    </div>
  )
}

const smallBtnStyle: React.CSSProperties = {
  padding: '3px 10px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12,
}
const btnStyle: React.CSSProperties = {
  padding: '6px 16px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13,
}
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '5px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 13, boxSizing: 'border-box',
}
