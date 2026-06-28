// T407: 状態遷移編集 UI（一覧・遷移編集・簡易シミュレーション）

import React, { useState, useEffect, useCallback } from 'react'
import type { ResourceRow } from '../types/d2d-api'

interface State { name: string; description?: string }
interface Transition { from: string; to: string; trigger: string; guard?: string; action?: string }

interface SmData {
  uid: string
  title: string
  state_machine_name: string | null
  states_json: string | null
  events_json: string | null
  transitions_json: string | null
  initial_state: string | null
  final_states_json: string | null
}

function parse<T>(json: string | null | undefined, fallback: T): T {
  if (!json) return fallback
  try { return JSON.parse(json) as T } catch { return fallback }
}

export default function StateMachineEditorPage() {
  const [machines, setMachines] = useState<ResourceRow[]>([])
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [data, setData] = useState<SmData | null>(null)
  const [states, setStates] = useState<State[]>([])
  const [transitions, setTransitions] = useState<Transition[]>([])
  const [initialState, setInitialState] = useState<string>('')
  const [finalStates, setFinalStates] = useState<string[]>([])
  const [machineName, setMachineName] = useState('')
  // sim
  const [simActive, setSimActive] = useState(false)
  const [simCurrent, setSimCurrent] = useState<string>('')
  const [simHistory, setSimHistory] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'states' | 'transitions' | 'sim'>('states')

  useEffect(() => {
    window.api.design.listResources('resource_state_transition').then(setMachines)
  }, [])

  const loadMachine = useCallback(async (uid: string) => {
    const rows = await window.api.store.query(
      `SELECT e.uid, e.title, sm.state_machine_name, sm.states_json, sm.events_json, sm.transitions_json, sm.initial_state, sm.final_states_json
       FROM resource_state_transition sm JOIN entity_registry e ON e.uid=sm.uid WHERE sm.uid=?`,
      [uid]
    )
    if (rows.length === 0) return
    const d = rows[0] as SmData
    setData(d)
    setMachineName(d.state_machine_name ?? d.title)
    setStates(parse<State[]>(d.states_json, []))
    setTransitions(parse<Transition[]>(d.transitions_json, []))
    setInitialState(d.initial_state ?? '')
    setFinalStates(parse<string[]>(d.final_states_json, []))
    setSavedAt(null)
    setSimActive(false)
    setSimHistory([])
    setSimCurrent('')
  }, [])

  const handleSelect = (uid: string) => { setSelectedUid(uid); loadMachine(uid) }

  // ---- 状態の操作 ----
  const addState = () => setStates((s) => [...s, { name: `S${s.length + 1}` }])
  const removeState = (i: number) => setStates((s) => s.filter((_, j) => j !== i))
  const updateState = (i: number, key: keyof State, val: string) =>
    setStates((s) => s.map((x, j) => j === i ? { ...x, [key]: val } : x))

  // ---- 遷移の操作 ----
  const addTransition = () => setTransitions((t) => [...t, { from: states[0]?.name ?? '', to: '', trigger: '' }])
  const removeTransition = (i: number) => setTransitions((t) => t.filter((_, j) => j !== i))
  const updateTrans = (i: number, key: keyof Transition, val: string) =>
    setTransitions((t) => t.map((x, j) => j === i ? { ...x, [key]: val } : x))

  // ---- 保存 ----
  const handleSave = async () => {
    if (!selectedUid) return
    setSaving(true)
    try {
      await window.api.design.updateField(selectedUid, 'resource_state_transition', {
        state_machine_name: machineName,
        states_json: JSON.stringify(states),
        transitions_json: JSON.stringify(transitions),
        initial_state: initialState,
        final_states_json: JSON.stringify(finalStates),
      })
      setSavedAt(new Date().toLocaleTimeString())
    } finally { setSaving(false) }
  }

  // ---- シミュレーション ----
  const startSim = () => {
    setSimActive(true)
    setSimCurrent(initialState)
    setSimHistory([initialState])
  }
  const resetSim = () => { setSimActive(false); setSimCurrent(''); setSimHistory([]) }
  const fireTransition = (t: Transition) => {
    if (t.from !== simCurrent) return
    setSimCurrent(t.to)
    setSimHistory((h) => [...h, t.to])
  }

  const availableTransitions = transitions.filter((t) => t.from === simCurrent)
  const isFinal = finalStates.includes(simCurrent)
  const stateNames = states.map((s) => s.name)

  // ---- 検証 ----
  const validationErrors: string[] = []
  if (!initialState) validationErrors.push('初期状態が設定されていません')
  if (finalStates.length === 0) validationErrors.push('終了状態が設定されていません')
  for (const t of transitions) {
    if (!stateNames.includes(t.from)) validationErrors.push(`遷移 "${t.trigger}": 開始状態 "${t.from}" が未定義`)
    if (!stateNames.includes(t.to)) validationErrors.push(`遷移 "${t.trigger}": 終了状態 "${t.to}" が未定義`)
    if (!t.trigger) validationErrors.push(`遷移 "${t.from}→${t.to}" のトリガーが空です`)
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 左: マシン一覧 */}
      <div style={{ width: 200, borderRight: '1px solid var(--srd-color-border)', overflow: 'auto', flexShrink: 0 }}>
        <div style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12, borderBottom: '1px solid var(--srd-color-border)' }}>
          状態遷移 ({machines.length})
        </div>
        {machines.map((m) => (
          <div
            key={m.uid}
            onClick={() => handleSelect(m.uid)}
            style={{
              padding: '7px 12px', cursor: 'pointer', fontSize: 12,
              background: selectedUid === m.uid ? 'var(--srd-color-surface-variant)' : 'transparent',
              borderLeft: selectedUid === m.uid ? '3px solid var(--srd-color-primary)' : '3px solid transparent',
            }}
          >
            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.title}</div>
            <div style={{ fontSize: 10, color: 'var(--srd-color-on-surface-variant)' }}>{m.code}</div>
          </div>
        ))}
        {machines.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--srd-color-on-surface-variant)' }}>状態遷移リソースがありません</div>}
      </div>

      {/* 右: エディタ */}
      {!data ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--srd-color-on-surface-variant)' }}>
          左のリソースを選択してください
        </div>
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {/* ヘッダー */}
          <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--srd-color-border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            <input
              value={machineName}
              onChange={(e) => setMachineName(e.target.value)}
              style={{ fontWeight: 600, fontSize: 14, background: 'transparent', border: 'none', outline: 'none', color: 'var(--srd-color-on-surface)' }}
            />
            <div style={{ flex: 1 }} />
            {validationErrors.length > 0 && (
              <span style={{ fontSize: 11, color: '#f59e0b' }} title={validationErrors.join('\n')}>
                ⚠ {validationErrors.length} 件の警告
              </span>
            )}
            <button onClick={handleSave} disabled={saving} style={{ ...btnStyle, background: 'var(--srd-color-primary)', color: '#fff' }}>
              {saving ? '保存中...' : '保存'}
            </button>
            {savedAt && <span style={{ fontSize: 11, color: '#22c55e' }}>✓ {savedAt}</span>}
          </div>

          {/* タブ */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--srd-color-border)', flexShrink: 0 }}>
            {(['states', 'transitions', 'sim'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveTab(t)}
                style={{
                  padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: 12,
                  background: activeTab === t ? 'var(--srd-color-surface-variant)' : 'transparent',
                  borderBottom: activeTab === t ? '2px solid var(--srd-color-primary)' : '2px solid transparent',
                  color: activeTab === t ? 'var(--srd-color-on-surface)' : 'var(--srd-color-on-surface-variant)',
                }}
              >
                {t === 'states' ? `状態 (${states.length})` : t === 'transitions' ? `遷移 (${transitions.length})` : 'シミュレーション'}
              </button>
            ))}
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
            {/* ---- 状態タブ ---- */}
            {activeTab === 'states' && (
              <div>
                <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>状態一覧</span>
                  <button onClick={addState} style={btnStyle}>＋追加</button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--srd-color-surface-variant)' }}>
                      <th style={thStyle}>状態名</th>
                      <th style={thStyle}>説明</th>
                      <th style={{ ...thStyle, width: 60 }}>初期</th>
                      <th style={{ ...thStyle, width: 60 }}>終了</th>
                      <th style={{ ...thStyle, width: 40 }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {states.map((s, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--srd-color-border)' }}>
                        <td style={tdStyle}>
                          <input
                            value={s.name}
                            onChange={(e) => updateState(i, 'name', e.target.value)}
                            style={{ ...inpStyle, fontWeight: 600 }}
                          />
                        </td>
                        <td style={tdStyle}>
                          <input
                            value={s.description ?? ''}
                            onChange={(e) => updateState(i, 'description', e.target.value)}
                            style={inpStyle}
                          />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <input
                            type="radio"
                            name="initial"
                            checked={initialState === s.name}
                            onChange={() => setInitialState(s.name)}
                          />
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                          <input
                            type="checkbox"
                            checked={finalStates.includes(s.name)}
                            onChange={(e) => setFinalStates((prev) =>
                              e.target.checked ? [...prev, s.name] : prev.filter((f) => f !== s.name)
                            )}
                          />
                        </td>
                        <td style={tdStyle}>
                          <button onClick={() => removeState(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 14 }}>×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* ---- 遷移タブ ---- */}
            {activeTab === 'transitions' && (
              <div>
                <div style={{ marginBottom: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 600 }}>遷移一覧</span>
                  <button onClick={addTransition} style={btnStyle}>＋追加</button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: 'var(--srd-color-surface-variant)' }}>
                      {['開始状態', 'イベント/トリガー', '終了状態', 'ガード条件', 'アクション', ''].map((h) => (
                        <th key={h} style={thStyle}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {transitions.map((t, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--srd-color-border)' }}>
                        <td style={tdStyle}>
                          <select value={t.from} onChange={(e) => updateTrans(i, 'from', e.target.value)} style={{ ...inpStyle, background: 'var(--srd-color-surface)' }}>
                            {stateNames.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <input value={t.trigger} onChange={(e) => updateTrans(i, 'trigger', e.target.value)} style={inpStyle} placeholder="イベント名" />
                        </td>
                        <td style={tdStyle}>
                          <select value={t.to} onChange={(e) => updateTrans(i, 'to', e.target.value)} style={{ ...inpStyle, background: 'var(--srd-color-surface)' }}>
                            <option value="">--</option>
                            {stateNames.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </td>
                        <td style={tdStyle}>
                          <input value={t.guard ?? ''} onChange={(e) => updateTrans(i, 'guard', e.target.value)} style={inpStyle} placeholder="[条件]" />
                        </td>
                        <td style={tdStyle}>
                          <input value={t.action ?? ''} onChange={(e) => updateTrans(i, 'action', e.target.value)} style={inpStyle} placeholder="/ 処理" />
                        </td>
                        <td style={tdStyle}>
                          <button onClick={() => removeTransition(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 14 }}>×</button>
                        </td>
                      </tr>
                    ))}
                    {transitions.length === 0 && (
                      <tr><td colSpan={6} style={{ padding: 12, textAlign: 'center', color: 'var(--srd-color-on-surface-variant)' }}>遷移がありません</td></tr>
                    )}
                  </tbody>
                </table>

                {/* 検証結果 */}
                {validationErrors.length > 0 && (
                  <div style={{ marginTop: 16, background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 6, padding: 10 }}>
                    <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 4, color: '#92400e' }}>検証エラー</div>
                    {validationErrors.map((e, i) => <div key={i} style={{ fontSize: 12, color: '#92400e' }}>• {e}</div>)}
                  </div>
                )}
              </div>
            )}

            {/* ---- シミュレーションタブ ---- */}
            {activeTab === 'sim' && (
              <div>
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>簡易シミュレーション</div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={startSim} disabled={simActive || !initialState} style={btnStyle}>開始</button>
                    <button onClick={resetSim} disabled={!simActive} style={btnStyle}>リセット</button>
                  </div>
                </div>

                {simActive && (
                  <>
                    {/* 現在状態 */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, color: 'var(--srd-color-on-surface-variant)', marginBottom: 4 }}>現在の状態</div>
                      <div style={{
                        display: 'inline-block', padding: '8px 20px', borderRadius: 20,
                        background: isFinal ? '#d1fae5' : 'var(--srd-color-primary)',
                        color: isFinal ? '#065f46' : '#fff',
                        fontWeight: 700, fontSize: 16,
                      }}>
                        {simCurrent} {isFinal ? '（終了）' : ''}
                      </div>
                    </div>

                    {/* 発火可能な遷移 */}
                    <div style={{ marginBottom: 16 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>発火可能なイベント</div>
                      {availableTransitions.length === 0
                        ? <div style={{ fontSize: 12, color: 'var(--srd-color-on-surface-variant)' }}>{isFinal ? '終了状態です' : '遷移可能なイベントがありません'}</div>
                        : availableTransitions.map((t, i) => (
                          <button
                            key={i}
                            onClick={() => fireTransition(t)}
                            style={{ margin: '0 6px 6px 0', padding: '6px 14px', background: 'var(--srd-color-surface-variant)', border: '1px solid var(--srd-color-border)', borderRadius: 6, cursor: 'pointer', fontSize: 12 }}
                          >
                            <strong>{t.trigger}</strong>
                            {t.guard && <span style={{ color: '#888', marginLeft: 4 }}>[{t.guard}]</span>}
                            <span style={{ color: '#888', marginLeft: 4 }}>→ {t.to}</span>
                          </button>
                        ))
                      }
                    </div>

                    {/* 履歴 */}
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>遷移履歴</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
                        {simHistory.map((s, i) => (
                          <React.Fragment key={i}>
                            <span style={{ padding: '3px 10px', background: i === simHistory.length - 1 ? 'var(--srd-color-primary)' : 'var(--srd-color-surface-variant)', color: i === simHistory.length - 1 ? '#fff' : 'var(--srd-color-on-surface)', borderRadius: 10, fontSize: 12 }}>{s}</span>
                            {i < simHistory.length - 1 && <span style={{ color: 'var(--srd-color-on-surface-variant)' }}>→</span>}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '3px 8px', background: 'var(--srd-color-surface-variant)',
  color: 'var(--srd-color-on-surface)', border: '1px solid var(--srd-color-border)',
  borderRadius: 4, cursor: 'pointer', fontSize: 12,
}
const thStyle: React.CSSProperties = { padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--srd-color-border)', fontWeight: 600, fontSize: 11 }
const tdStyle: React.CSSProperties = { padding: 4, border: '1px solid var(--srd-color-border)' }
const inpStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '3px 6px',
  background: 'var(--srd-color-surface)', color: 'var(--srd-color-on-surface)',
  border: 'none', outline: 'none', fontSize: 12,
}
