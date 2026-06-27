import React, { useEffect, useState } from 'react'
import type { JobRecord } from '../../../types/d2d-api'

const STATUS_COLOR: Record<string, string> = {
  pending: '#f59e0b',
  running: '#3b82f6',
  success: '#10b981',
  failed: '#ef4444',
  cancelled: '#9ca3af',
}

export function JobsView(): React.JSX.Element {
  const [jobs, setJobs] = useState<JobRecord[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    try {
      const list = await window.api.jobs.list()
      setJobs(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const off = window.api.events.on('d2d:job:updated', () => load())
    return off
  }, [])

  return (
    <div style={{ padding: 20, fontSize: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>ジョブ一覧</h3>
        <button onClick={load} style={{ padding: '3px 10px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer', fontSize: 12 }}>更新</button>
      </div>
      {loading ? <div style={{ color: '#888' }}>読み込み中…</div> : jobs.length === 0 ? (
        <div style={{ color: '#aaa' }}>ジョブがありません</div>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
              <th style={th}>種別</th>
              <th style={th}>ステータス</th>
              <th style={th}>開始日時</th>
              <th style={th}>完了日時</th>
              <th style={th}>操作</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.uid} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={td}>{j.batch_type}</td>
                <td style={td}>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, background: STATUS_COLOR[j.status] + '22', color: STATUS_COLOR[j.status], fontWeight: 600 }}>
                    {j.status}
                  </span>
                </td>
                <td style={td}>{j.started_at?.slice(0, 19).replace('T', ' ') ?? '—'}</td>
                <td style={td}>{j.completed_at?.slice(0, 19).replace('T', ' ') ?? '—'}</td>
                <td style={td}>
                  {j.status === 'failed' && (
                    <button onClick={() => window.api.jobs.retry(j.uid).then(load)} style={actionBtn}>再試行</button>
                  )}
                  {(j.status === 'pending' || j.status === 'running') && (
                    <button onClick={() => window.api.jobs.cancel(j.uid).then(load)} style={{ ...actionBtn, background: '#fee2e2', color: '#dc2626' }}>キャンセル</button>
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

const th: React.CSSProperties = { padding: '6px 8px', fontWeight: 600, color: '#555', fontSize: 12 }
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'middle' }
const actionBtn: React.CSSProperties = { padding: '2px 8px', background: '#e0e7ff', color: '#3730a3', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }
