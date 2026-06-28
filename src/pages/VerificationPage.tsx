// T408: 検証管理 UI（シナリオ×設計要素カバレッジ）

import React, { useState, useEffect, useCallback } from 'react'

interface DesignEntity {
  uid: string
  code: string
  title: string
  entity_type: string
}

interface ScenarioRow {
  uid: string
  code: string
  title: string
  steps_json: string | null
  trigger_text: string | null
}

interface VerifLink {
  scenario_uid: string
  scenario_title: string
  target_uid: string
  target_code: string
  target_title: string
  target_type: string
  relation_type: string
  confidence: number | null
}

interface CoverageItem extends DesignEntity {
  coveredBy: VerifLink[]
}

const RELATION_TYPES = ['verifies', 'validates', 'tests', 'depends_on', 'refines', 'implements']
const COVERAGE_TYPES = [
  'resource_text', 'resource_label', 'resource_list', 'resource_interface',
  'resource_state_transition', 'resource_data_structure', 'resource_scenario',
]

export default function VerificationPage() {
  const [scenarios, setScenarios] = useState<ScenarioRow[]>([])
  const [selected, setSelected] = useState<ScenarioRow | null>(null)
  const [coverageItems, setCoverageItems] = useState<CoverageItem[]>([])
  const [verifLinks, setVerifLinks] = useState<VerifLink[]>([])
  const [allDesign, setAllDesign] = useState<DesignEntity[]>([])
  const [activeTab, setActiveTab] = useState<'matrix' | 'coverage' | 'add'>('coverage')
  const [addTarget, setAddTarget] = useState<string>('')
  const [addRelation, setAddRelation] = useState<string>('verifies')
  const [saving, setSaving] = useState(false)
  const [filterType, setFilterType] = useState<string>('')

  const loadScenarios = useCallback(async () => {
    const rows = await window.api.store.query(
      `SELECT e.uid, e.code, e.title, s.steps_json, s.trigger_text
       FROM resource_scenario s JOIN entity_registry e ON e.uid=s.uid
       WHERE e.status='active' ORDER BY e.code`
    )
    setScenarios(rows as ScenarioRow[])
  }, [])

  const loadDesign = useCallback(async () => {
    const rows = await window.api.store.query(
      `SELECT uid, code, title, entity_type FROM entity_registry
       WHERE status='active' AND entity_type IN (${COVERAGE_TYPES.map(() => '?').join(',')})
       ORDER BY entity_type, code`,
      COVERAGE_TYPES
    )
    setAllDesign(rows as DesignEntity[])
  }, [])

  const loadVerifLinks = useCallback(async () => {
    const rows = await window.api.store.query(
      `SELECT tl.relation_type, tl.confidence,
              fs.uid AS scenario_uid, fs.title AS scenario_title,
              et.uid AS target_uid, et.code AS target_code, et.title AS target_title, et.entity_type AS target_type
       FROM trace_link tl
       JOIN entity_registry fs ON fs.uid=tl.from_uid AND fs.entity_type='resource_scenario'
       JOIN entity_registry et ON et.uid=tl.to_uid AND et.status='active'
       WHERE tl.relation_type IN (${RELATION_TYPES.map(() => '?').join(',')})
       ORDER BY fs.code, et.code`,
      RELATION_TYPES
    )
    setVerifLinks(rows as VerifLink[])
  }, [])

  useEffect(() => { loadScenarios(); loadDesign(); loadVerifLinks() }, [loadScenarios, loadDesign, loadVerifLinks])

  useEffect(() => {
    if (!allDesign.length) return
    const linked = verifLinks.reduce<Record<string, VerifLink[]>>((acc, l) => {
      if (!acc[l.target_uid]) acc[l.target_uid] = []
      acc[l.target_uid].push(l)
      return acc
    }, {})
    const items: CoverageItem[] = (filterType ? allDesign.filter((d) => d.entity_type === filterType) : allDesign)
      .map((d) => ({ ...d, coveredBy: linked[d.uid] ?? [] }))
    setCoverageItems(items)
  }, [allDesign, verifLinks, filterType])

  const scenarioLinks = selected
    ? verifLinks.filter((l) => l.scenario_uid === selected.uid)
    : []

  const handleAddLink = async () => {
    if (!selected || !addTarget) return
    setSaving(true)
    try {
      await window.api.design.createTraceLink(selected.uid, addTarget, addRelation as Parameters<typeof window.api.design.createTraceLink>[2])
      await loadVerifLinks()
      setAddTarget('')
    } finally { setSaving(false) }
  }

  const handleRemoveLink = async (fromUid: string, toUid: string) => {
    const links = await window.api.design.listTraceLinks(fromUid, 'from')
    const link = links.find((l) => l.to_uid === toUid && RELATION_TYPES.includes(l.relation_type))
    if (link) {
      await window.api.design.deleteTraceLink(link.uid)
      await loadVerifLinks()
    }
  }

  const covered = coverageItems.filter((c) => c.coveredBy.length > 0).length
  const total = coverageItems.length
  const pct = total > 0 ? Math.round((covered / total) * 100) : 0

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* 左: シナリオ一覧 */}
      <div style={{ width: 220, borderRight: '1px solid var(--srd-color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '8px 12px', fontWeight: 600, fontSize: 12, borderBottom: '1px solid var(--srd-color-border)' }}>
          検証シナリオ ({scenarios.length})
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          {scenarios.map((s) => {
            const linkCount = verifLinks.filter((l) => l.scenario_uid === s.uid).length
            return (
              <div
                key={s.uid}
                onClick={() => { setSelected(s); setActiveTab('add') }}
                style={{
                  padding: '7px 12px', cursor: 'pointer', fontSize: 12,
                  background: selected?.uid === s.uid ? 'var(--srd-color-surface-variant)' : 'transparent',
                  borderLeft: selected?.uid === s.uid ? '3px solid var(--srd-color-primary)' : '3px solid transparent',
                }}
              >
                <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                <div style={{ fontSize: 10, color: 'var(--srd-color-on-surface-variant)', marginTop: 1 }}>
                  {s.code} · {linkCount} リンク
                </div>
              </div>
            )
          })}
          {scenarios.length === 0 && <div style={{ padding: 12, fontSize: 12, color: 'var(--srd-color-on-surface-variant)' }}>シナリオがありません</div>}
        </div>
      </div>

      {/* 右: メインエリア */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* タブ */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--srd-color-border)', flexShrink: 0 }}>
          {(['coverage', 'matrix', 'add'] as const).map((t) => (
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
              {t === 'coverage' ? 'カバレッジ' : t === 'matrix' ? 'マトリクス' : 'リンク管理'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
          {/* ---- カバレッジ ---- */}
          {activeTab === 'coverage' && (
            <div>
              {/* サマリー */}
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <StatCard label="設計要素数" value={total} />
                <StatCard label="カバー済み" value={covered} color="#22c55e" />
                <StatCard label="未カバー" value={total - covered} color="#f87171" />
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '8px 16px', border: '1px solid var(--srd-color-border)', borderRadius: 8, minWidth: 80 }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#f87171' }}>{pct}%</div>
                  <div style={{ fontSize: 11, color: 'var(--srd-color-on-surface-variant)' }}>カバレッジ</div>
                </div>
              </div>

              {/* プログレスバー */}
              <div style={{ background: 'var(--srd-color-surface-variant)', height: 8, borderRadius: 4, marginBottom: 16, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: pct >= 80 ? '#22c55e' : pct >= 50 ? '#f59e0b' : '#f87171', borderRadius: 4, transition: 'width 0.3s' }} />
              </div>

              {/* フィルタ */}
              <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
                <select value={filterType} onChange={(e) => setFilterType(e.target.value)} style={{ padding: '3px 6px', background: 'var(--srd-color-surface)', color: 'var(--srd-color-on-surface)', border: '1px solid var(--srd-color-border)', borderRadius: 4, fontSize: 12 }}>
                  <option value="">全種別</option>
                  {COVERAGE_TYPES.map((t) => <option key={t} value={t}>{t.replace('resource_', '')}</option>)}
                </select>
              </div>

              {/* 要素一覧 */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--srd-color-surface-variant)' }}>
                    <th style={thStyle}>コード</th>
                    <th style={thStyle}>タイトル</th>
                    <th style={thStyle}>種別</th>
                    <th style={{ ...thStyle, width: 120 }}>カバー状況</th>
                  </tr>
                </thead>
                <tbody>
                  {coverageItems.map((c) => (
                    <tr key={c.uid} style={{ borderBottom: '1px solid var(--srd-color-border)' }}>
                      <td style={{ padding: '4px 8px', fontFamily: 'monospace', fontSize: 11 }}>{c.code}</td>
                      <td style={{ padding: '4px 8px' }}>{c.title}</td>
                      <td style={{ padding: '4px 8px', fontSize: 11, color: 'var(--srd-color-on-surface-variant)' }}>{c.entity_type.replace('resource_', '')}</td>
                      <td style={{ padding: '4px 8px' }}>
                        {c.coveredBy.length > 0 ? (
                          <span style={{ color: '#22c55e', fontSize: 11 }}>✓ {c.coveredBy.length} シナリオ</span>
                        ) : (
                          <span style={{ color: '#f87171', fontSize: 11 }}>✗ 未カバー</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ---- マトリクス ---- */}
          {activeTab === 'matrix' && (
            <div style={{ overflow: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    <th style={{ ...thStyle, minWidth: 120 }}>設計要素 \ シナリオ</th>
                    {scenarios.map((s) => (
                      <th key={s.uid} style={{ ...thStyle, writingMode: 'vertical-rl', minWidth: 28, maxWidth: 28, padding: '4px 4px', whiteSpace: 'nowrap', overflow: 'hidden' }} title={s.title}>
                        {s.code}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {coverageItems.slice(0, 50).map((c) => (
                    <tr key={c.uid} style={{ borderBottom: '1px solid var(--srd-color-border)' }}>
                      <td style={{ padding: '3px 8px', borderRight: '1px solid var(--srd-color-border)', whiteSpace: 'nowrap' }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 10, color: 'var(--srd-color-on-surface-variant)' }}>{c.code}</span>
                        {' '}{c.title.slice(0, 20)}
                      </td>
                      {scenarios.map((s) => {
                        const linked = c.coveredBy.some((l) => l.scenario_uid === s.uid)
                        return (
                          <td key={s.uid} style={{ padding: '2px 4px', textAlign: 'center', borderRight: '1px solid var(--srd-color-border)', background: linked ? '#d1fae5' : 'transparent' }}>
                            {linked ? '✓' : ''}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                  {coverageItems.length > 50 && (
                    <tr><td colSpan={scenarios.length + 1} style={{ padding: 8, textAlign: 'center', color: 'var(--srd-color-on-surface-variant)', fontSize: 11 }}>... 先頭50件を表示（全{coverageItems.length}件）</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* ---- リンク管理 ---- */}
          {activeTab === 'add' && (
            !selected ? (
              <div style={{ color: 'var(--srd-color-on-surface-variant)', textAlign: 'center', marginTop: 40 }}>左のシナリオを選択してください</div>
            ) : (
              <div>
                <h4 style={{ margin: '0 0 12px', fontSize: 14 }}>{selected.title}</h4>

                {/* 既存リンク */}
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>検証リンク ({scenarioLinks.length})</div>
                  {scenarioLinks.length === 0
                    ? <div style={{ fontSize: 12, color: 'var(--srd-color-on-surface-variant)' }}>リンクなし</div>
                    : scenarioLinks.map((l, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', borderBottom: '1px solid var(--srd-color-border)', fontSize: 12 }}>
                        <span style={{ padding: '1px 6px', background: 'var(--srd-color-surface-variant)', borderRadius: 8, fontSize: 11 }}>{l.relation_type}</span>
                        <span style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--srd-color-on-surface-variant)' }}>{l.target_code}</span>
                        <span>{l.target_title}</span>
                        <span style={{ fontSize: 10, color: 'var(--srd-color-on-surface-variant)' }}>({l.target_type.replace('resource_', '')})</span>
                        <div style={{ flex: 1 }} />
                        <button
                          onClick={() => handleRemoveLink(l.scenario_uid, l.target_uid)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626', fontSize: 12 }}
                        >×</button>
                      </div>
                    ))
                  }
                </div>

                {/* リンク追加 */}
                <div style={{ border: '1px solid var(--srd-color-border)', borderRadius: 6, padding: 12 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>リンクを追加</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={addRelation}
                      onChange={(e) => setAddRelation(e.target.value)}
                      style={{ padding: '4px 6px', background: 'var(--srd-color-surface)', color: 'var(--srd-color-on-surface)', border: '1px solid var(--srd-color-border)', borderRadius: 4, fontSize: 12 }}
                    >
                      {RELATION_TYPES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                    <select
                      value={addTarget}
                      onChange={(e) => setAddTarget(e.target.value)}
                      style={{ flex: 1, minWidth: 200, padding: '4px 6px', background: 'var(--srd-color-surface)', color: 'var(--srd-color-on-surface)', border: '1px solid var(--srd-color-border)', borderRadius: 4, fontSize: 12 }}
                    >
                      <option value="">設計要素を選択...</option>
                      {COVERAGE_TYPES.map((type) => {
                        const items = allDesign.filter((d) => d.entity_type === type)
                        if (items.length === 0) return null
                        return (
                          <optgroup key={type} label={type.replace('resource_', '')}>
                            {items.map((d) => (
                              <option key={d.uid} value={d.uid}>{d.code} {d.title}</option>
                            ))}
                          </optgroup>
                        )
                      })}
                    </select>
                    <button
                      onClick={handleAddLink}
                      disabled={!addTarget || saving}
                      style={{ padding: '4px 12px', background: 'var(--srd-color-primary)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}
                    >
                      追加
                    </button>
                  </div>
                </div>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ padding: '8px 16px', border: '1px solid var(--srd-color-border)', borderRadius: 8, minWidth: 80, textAlign: 'center' }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color ?? 'var(--srd-color-on-surface)' }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--srd-color-on-surface-variant)' }}>{label}</div>
    </div>
  )
}

const thStyle: React.CSSProperties = { padding: '4px 8px', textAlign: 'left', borderBottom: '2px solid var(--srd-color-border)', fontWeight: 600, fontSize: 11, borderRight: '1px solid var(--srd-color-border)' }
