import React, { useEffect, useState, useCallback } from 'react'
import type { CandidateRow, ReviewStatus, CandidateType } from '../types/d2d-api'

const STATUS_COLOR: Record<ReviewStatus, string> = {
  pending:  '#f59e0b',
  accepted: '#10b981',
  modified: '#3b82f6',
  rejected: '#6b7280',
}
const TYPE_LABELS: Record<CandidateType, string> = {
  term: '用語',
  trace_link: 'トレースリンク',
  summary: '要約',
  classification: '分類',
  custom: 'カスタム',
}

export function LlmCandidatePage(): React.JSX.Element {
  const [candidates, setCandidates] = useState<CandidateRow[]>([])
  const [stats, setStats] = useState({ pending: 0, accepted: 0, rejected: 0, modified: 0 })
  const [filter, setFilter] = useState<ReviewStatus | 'all'>('pending')
  const [selected, setSelected] = useState<CandidateRow | null>(null)
  const [editJson, setEditJson] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, s] = await Promise.all([
        window.api.llm.listCandidates({ status: filter === 'all' ? undefined : filter, limit: 200 }),
        window.api.llm.candidateStats(),
      ])
      setCandidates(list)
      setStats(s)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  const review = async (uid: string, status: ReviewStatus, json?: string) => {
    await window.api.llm.reviewCandidate(uid, status, json)
    setSelected(null)
    load()
  }

  const handleSelect = (c: CandidateRow) => {
    setSelected(c)
    setEditJson(JSON.stringify(JSON.parse(c.content_json), null, 2))
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontSize: 13 }}>
      {/* 左: 候補一覧 */}
      <div style={{ width: 340, borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* 統計チップ */}
        <div style={{ padding: '10px 12px', borderBottom: '1px solid #e0e0e0', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {(Object.entries(stats) as [ReviewStatus, number][]).map(([s, n]) => (
            <span key={s} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, background: STATUS_COLOR[s] + '22', color: STATUS_COLOR[s], fontWeight: 600 }}>
              {s}: {n}
            </span>
          ))}
        </div>

        {/* フィルタタブ */}
        <div style={{ display: 'flex', padding: '6px 8px', gap: 4, borderBottom: '1px solid #f0f0f0' }}>
          {(['all', 'pending', 'accepted', 'modified', 'rejected'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setFilter(s)}
              style={{ padding: '3px 8px', borderRadius: 4, border: 'none', cursor: 'pointer', fontSize: 11,
                background: filter === s ? '#2563eb' : '#f3f4f6', color: filter === s ? '#fff' : '#555' }}
            >
              {s === 'all' ? 'すべて' : s}
            </button>
          ))}
        </div>

        {/* リスト */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {loading ? (
            <div style={{ padding: 16, color: '#888' }}>読み込み中…</div>
          ) : candidates.length === 0 ? (
            <div style={{ padding: 16, color: '#aaa' }}>候補がありません</div>
          ) : (
            candidates.map((c) => (
              <div
                key={c.uid}
                onClick={() => handleSelect(c)}
                style={{
                  padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f5f5f5',
                  background: selected?.uid === c.uid ? '#eff6ff' : 'transparent',
                  borderLeft: selected?.uid === c.uid ? '3px solid #2563eb' : '3px solid transparent',
                }}
              >
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 2 }}>
                  <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#e0e7ff', color: '#3730a3' }}>
                    {TYPE_LABELS[c.candidate_type]}
                  </span>
                  <span style={{ marginLeft: 'auto', fontSize: 10, color: STATUS_COLOR[c.review_status], fontWeight: 600 }}>
                    {c.review_status}
                  </span>
                </div>
                <div style={{ color: '#333', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {truncate(c.content_json, 60)}
                </div>
                <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 2 }}>
                  {c.created_at.slice(0, 16).replace('T', ' ')}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 右: 詳細 */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {selected ? (
          <>
            <div style={{ padding: '10px 16px', borderBottom: '1px solid #e0e0e0', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>候補詳細</span>
              <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#e0e7ff', color: '#3730a3' }}>
                {TYPE_LABELS[selected.candidate_type]}
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                <button
                  onClick={() => review(selected.uid, 'accepted')}
                  style={actionBtn('#d1fae5', '#065f46')}
                >採用</button>
                <button
                  onClick={() => review(selected.uid, 'modified', editJson)}
                  style={actionBtn('#dbeafe', '#1e40af')}
                >修正して採用</button>
                <button
                  onClick={() => review(selected.uid, 'rejected')}
                  style={actionBtn('#fee2e2', '#991b1b')}
                >棄却</button>
              </div>
            </div>

            <div style={{ flex: 1, padding: 16, overflow: 'auto' }}>
              <div style={{ marginBottom: 8, fontSize: 11, color: '#888' }}>
                生成日時: {selected.created_at.slice(0, 19).replace('T', ' ')} |
                レビュー状態: <strong>{selected.review_status}</strong>
              </div>
              <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 12 }}>コンテンツ JSON (編集可)</div>
              <textarea
                value={editJson}
                onChange={(e) => setEditJson(e.target.value)}
                style={{
                  width: '100%', boxSizing: 'border-box', minHeight: 300, fontFamily: 'monospace',
                  fontSize: 12, border: '1px solid #d1d5db', borderRadius: 6, padding: 10,
                  background: '#f9fafb', resize: 'vertical',
                }}
              />
              {selected.reviewed_at && (
                <div style={{ marginTop: 8, fontSize: 11, color: '#6b7280' }}>
                  レビュー日時: {selected.reviewed_at.slice(0, 19).replace('T', ' ')}
                </div>
              )}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#aaa', fontSize: 14 }}>
            候補を選択してください
          </div>
        )}
      </div>
    </div>
  )
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + '…'
}

function actionBtn(bg: string, color: string): React.CSSProperties {
  return { padding: '4px 12px', background: bg, color, border: 'none', borderRadius: 5, cursor: 'pointer', fontSize: 12, fontWeight: 600 }
}
