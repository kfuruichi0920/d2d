import React, { useEffect, useState } from 'react'
import type { LlmRunLog, LlmRunLogStats } from '../types/d2d-api'

export function LlmLogPage(): React.JSX.Element {
  const [logs, setLogs] = useState<LlmRunLog[]>([])
  const [stats, setStats] = useState<LlmRunLogStats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [l, s] = await Promise.all([
        window.api.llm.listLogs(100),
        window.api.llm.logStats(),
      ])
      setLogs(l)
      setStats(s)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  return (
    <div style={{ padding: 20, fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>LLM 実行ログ</h3>
        <button onClick={load} style={{ padding: '3px 10px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>更新</button>
      </div>

      {/* 統計カード */}
      {stats && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          <StatCard label="総実行回数" value={String(stats.total_runs)} />
          <StatCard label="総トークン" value={stats.total_tokens?.toLocaleString() ?? '—'} />
          <StatCard label="推定コスト" value={stats.total_cost_usd ? `$${stats.total_cost_usd.toFixed(4)}` : '—'} />
          <StatCard label="平均レイテンシ" value={stats.avg_latency_ms ? `${Math.round(stats.avg_latency_ms)}ms` : '—'} />
          <StatCard label="エラー" value={String(stats.error_count)} color={stats.error_count > 0 ? '#ef4444' : undefined} />
        </div>
      )}

      {loading ? (
        <div style={{ color: '#888' }}>読み込み中…</div>
      ) : logs.length === 0 ? (
        <div style={{ color: '#aaa' }}>LLM 実行ログがありません</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
              <th style={th}>日時</th>
              <th style={th}>プロバイダー</th>
              <th style={th}>モデル</th>
              <th style={th}>ツール</th>
              <th style={th}>入力 tokens</th>
              <th style={th}>出力 tokens</th>
              <th style={th}>コスト (USD)</th>
              <th style={th}>レイテンシ</th>
              <th style={th}>エラー</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => (
              <tr key={l.uid} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={td}>{l.created_at.slice(0, 16).replace('T', ' ')}</td>
                <td style={td}>{l.provider ?? '—'}</td>
                <td style={td}>{l.model_name ?? '—'}</td>
                <td style={td}>{l.tool_name ?? '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{l.prompt_tokens?.toLocaleString() ?? '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>{l.completion_tokens?.toLocaleString() ?? '—'}</td>
                <td style={{ ...td, textAlign: 'right' }}>
                  {l.estimated_cost_usd != null ? `$${l.estimated_cost_usd.toFixed(5)}` : '—'}
                </td>
                <td style={{ ...td, textAlign: 'right' }}>{l.latency_ms != null ? `${l.latency_ms}ms` : '—'}</td>
                <td style={td}>
                  {l.error_message ? (
                    <span style={{ color: '#ef4444' }} title={l.error_message}>
                      {l.error_message.slice(0, 40)}…
                    </span>
                  ) : (
                    <span style={{ color: '#10b981' }}>OK</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: string; color?: string }): React.JSX.Element {
  return (
    <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 16px', minWidth: 120 }}>
      <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color: color ?? '#111' }}>{value}</div>
    </div>
  )
}

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, color: '#555', fontSize: 11 }
const td: React.CSSProperties = { padding: '5px 8px', verticalAlign: 'middle' }
