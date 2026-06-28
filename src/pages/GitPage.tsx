// T802/T804: Git 連携・Diff ビューページ

import { useState, useEffect, useCallback } from 'react'
import type { GitCommit, GitStatusResult } from '../types/d2d-api'

type Tab = 'status' | 'log' | 'diff'

export default function GitPage() {
  const [tab, setTab] = useState<Tab>('status')
  const [status, setStatus] = useState<GitStatusResult | null>(null)
  const [log, setLog] = useState<GitCommit[]>([])
  const [diff, setDiff] = useState<string>('')
  const [selectedHash, setSelectedHash] = useState<string | null>(null)
  const [commitMsg, setCommitMsg] = useState('')
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    const s = await window.api.git.status()
    setStatus(s)
  }, [])

  const loadLog = useCallback(async () => {
    const l = await window.api.git.log(50)
    setLog(l)
  }, [])

  useEffect(() => {
    loadStatus()
    loadLog()
  }, [loadStatus, loadLog])

  async function handleInit() {
    setLoading(true)
    await window.api.git.init()
    await loadStatus()
    setMsg('Git リポジトリを初期化しました')
    setLoading(false)
  }

  async function handleCommit() {
    if (!commitMsg.trim()) return
    setLoading(true)
    try {
      await window.api.git.commit(commitMsg.trim())
      setCommitMsg('')
      await loadStatus()
      await loadLog()
      setMsg('コミットしました')
    } catch (e) {
      setMsg(`エラー: ${String(e)}`)
    }
    setLoading(false)
  }

  async function handleShowDiff(hash?: string) {
    setLoading(true)
    const d = hash ? await window.api.git.show(hash) : await window.api.git.diff()
    setDiff(d)
    setSelectedHash(hash ?? null)
    setTab('diff')
    setLoading(false)
  }

  const fileStatusColor = (s: string) => {
    if (s === 'M') return '#fbbf24'
    if (s === 'A' || s === '?') return '#34d399'
    if (s === 'D') return '#f87171'
    return '#94a3b8'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* タブバー */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--srd-color-border)', flexShrink: 0 }}>
        {(['status', 'log', 'diff'] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              padding: '6px 14px',
              background: tab === t ? 'var(--srd-color-surface-variant)' : 'transparent',
              color: tab === t ? 'var(--srd-color-on-surface)' : 'var(--srd-color-on-surface-variant)',
              border: 'none',
              borderBottom: tab === t ? '2px solid var(--srd-color-primary)' : '2px solid transparent',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {t === 'status' ? 'ステータス' : t === 'log' ? 'ログ' : 'Diff'}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button onClick={handleInit} disabled={loading} style={btnStyle}>git init</button>
      </div>

      {msg && (
        <div style={{ padding: '4px 12px', background: '#d1fae5', color: '#065f46', fontSize: 12 }}>
          {msg} <button onClick={() => setMsg(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 10, color: '#065f46' }}>×</button>
        </div>
      )}

      <div style={{ flex: 1, overflow: 'auto', padding: 12 }}>
        {/* --- ステータス --- */}
        {tab === 'status' && (
          <div>
            {status == null && <div style={{ color: 'var(--srd-color-on-surface-variant)' }}>読み込み中...</div>}
            {status && !status.isRepo && (
              <div style={{ color: 'var(--srd-color-on-surface-variant)', margin: '20px 0' }}>
                Git リポジトリではありません。「git init」で初期化できます。
              </div>
            )}
            {status?.isRepo && (
              <>
                <div style={{ marginBottom: 12, fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>ブランチ: </span>{status.branch}
                  {status.ahead > 0 && <span style={{ color: '#34d399', marginLeft: 8 }}>↑{status.ahead}</span>}
                  {status.behind > 0 && <span style={{ color: '#f87171', marginLeft: 4 }}>↓{status.behind}</span>}
                </div>

                {status.files.length === 0
                  ? <div style={{ color: 'var(--srd-color-on-surface-variant)', fontSize: 12 }}>変更なし（クリーン）</div>
                  : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 16 }}>
                      <tbody>
                        {status.files.map((f) => (
                          <tr key={f.path} style={{ borderBottom: '1px solid var(--srd-color-border)' }}>
                            <td style={{ padding: '4px 8px', width: 24, color: fileStatusColor(f.index || f.working_dir) }}>
                              {f.index || f.working_dir}
                            </td>
                            <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{f.path}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}

                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <input
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    placeholder="コミットメッセージ"
                    onKeyDown={(e) => e.key === 'Enter' && handleCommit()}
                    style={{ flex: 1, padding: '4px 8px', background: 'var(--srd-color-surface)', color: 'var(--srd-color-on-surface)', border: '1px solid var(--srd-color-border)', borderRadius: 4, fontSize: 12 }}
                  />
                  <button onClick={handleCommit} disabled={loading || !commitMsg.trim()} style={{ ...btnStyle, background: 'var(--srd-color-primary)', color: '#fff' }}>コミット</button>
                  <button onClick={() => handleShowDiff()} disabled={loading} style={btnStyle}>Diff を見る</button>
                </div>
              </>
            )}
          </div>
        )}

        {/* --- ログ --- */}
        {tab === 'log' && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--srd-color-border)', background: 'var(--srd-color-surface-variant)' }}>
                <th style={{ padding: '4px 8px', textAlign: 'left', width: 80 }}>ハッシュ</th>
                <th style={{ padding: '4px 8px', textAlign: 'left', width: 140 }}>日時</th>
                <th style={{ padding: '4px 8px', textAlign: 'left' }}>メッセージ</th>
                <th style={{ padding: '4px 8px', textAlign: 'left', width: 120 }}>作者</th>
                <th style={{ padding: '4px 8px', width: 60 }}></th>
              </tr>
            </thead>
            <tbody>
              {log.map((c) => (
                <tr key={c.hash} style={{ borderBottom: '1px solid var(--srd-color-border)' }}>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace', color: '#60a5fa' }}>{c.hash.slice(0, 7)}</td>
                  <td style={{ padding: '4px 8px', color: 'var(--srd-color-on-surface-variant)' }}>{c.date.slice(0, 16)}</td>
                  <td style={{ padding: '4px 8px' }}>{c.message}</td>
                  <td style={{ padding: '4px 8px', color: 'var(--srd-color-on-surface-variant)' }}>{c.author_name}</td>
                  <td style={{ padding: '4px 8px' }}>
                    <button onClick={() => handleShowDiff(c.hash)} style={btnStyle}>Diff</button>
                  </td>
                </tr>
              ))}
              {log.length === 0 && (
                <tr><td colSpan={5} style={{ padding: 12, color: 'var(--srd-color-on-surface-variant)', textAlign: 'center' }}>コミット履歴なし</td></tr>
              )}
            </tbody>
          </table>
        )}

        {/* --- Diff --- */}
        {tab === 'diff' && (
          <div>
            {selectedHash && (
              <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--srd-color-on-surface-variant)' }}>
                コミット: <span style={{ fontFamily: 'monospace', color: '#60a5fa' }}>{selectedHash.slice(0, 12)}</span>
              </div>
            )}
            {loading && <div style={{ color: 'var(--srd-color-on-surface-variant)' }}>読み込み中...</div>}
            {!loading && (
              <pre style={{ fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'monospace' }}>
                {diff.split('\n').map((line, i) => {
                  const color = line.startsWith('+') && !line.startsWith('+++') ? '#34d399'
                    : line.startsWith('-') && !line.startsWith('---') ? '#f87171'
                    : line.startsWith('@@') ? '#60a5fa'
                    : 'inherit'
                  return <span key={i} style={{ color, display: 'block' }}>{line}</span>
                })}
              </pre>
            )}
            {!loading && !diff && <div style={{ color: 'var(--srd-color-on-surface-variant)' }}>差分なし</div>}
          </div>
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '3px 8px',
  background: 'var(--srd-color-surface-variant)',
  color: 'var(--srd-color-on-surface)',
  border: '1px solid var(--srd-color-border)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
}
