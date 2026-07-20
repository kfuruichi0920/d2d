/**
 * MCPログ パネル（MCP-010）。MCPサーバのアクセスログを新しい順に表示する。
 * 正本は Backend のメモリリング（最大500件）+ logs/mcp/access-YYYY-MM-DD.jsonl。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'

interface McpAccessLogEntry {
  ts: string
  method: string
  toolName: string | null
  argsSummary: string | null
  ok: boolean
  errorMessage: string | null
  durationMs: number
}

export function McpLogPanel(): React.JSX.Element {
  const [entries, setEntries] = useState<McpAccessLogEntry[]>([])

  const reload = useCallback(async (): Promise<void> => {
    const result = await invoke<McpAccessLogEntry[]>('mcp.getAccessLog', { limit: 200 })
    if (result.ok) setEntries(result.result)
  }, [])

  useEffect(() => {
    void reload()
    // アクセス発生・サーバ状態変更で即時反映する
    return onBackendEvent((event) => {
      if (event === 'mcp.accessLogged' || event === 'mcp.statusChanged') void reload()
    })
  }, [reload])

  return (
    <div data-testid="mcp-log-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0, height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
        <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>
          MCPサーバへのアクセス履歴（最新200件。ファイル正本: logs/mcp/access-日付.jsonl）
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="d2d-btn small"
          onClick={() => void reload()}
          title="アクセスログを読み直します"
          data-testid="mcp-log-reload"
        >
          更新
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', fontFamily: 'Consolas, monospace', fontSize: 11.5 }}>
        {entries.length === 0 ? (
          <div className="d2d-empty">
            MCPアクセスログはまだありません（MCPサーバへの問い合わせが発生すると記録されます）
          </div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={`${entry.ts}-${index}`}
              style={{ padding: '1px 6px', borderBottom: '1px solid var(--d2d-border)' }}
              data-testid={`mcp-log-row-${index}`}
            >
              <span style={{ color: 'var(--d2d-fg-muted)' }}>{entry.ts.slice(11, 19)}</span>{' '}
              <span style={{ color: entry.ok ? 'var(--d2d-success, #16a34a)' : 'var(--d2d-error)' }}>
                [{entry.ok ? 'OK' : 'NG'}]
              </span>{' '}
              {entry.method}
              {entry.toolName && <> → {entry.toolName}</>}
              <span style={{ color: 'var(--d2d-fg-muted)' }}> {entry.durationMs}ms</span>
              {entry.argsSummary && <span style={{ color: 'var(--d2d-fg-muted)' }}> | {entry.argsSummary}</span>}
              {entry.errorMessage && <span style={{ color: 'var(--d2d-error)' }}> | {entry.errorMessage}</span>}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
