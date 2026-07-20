/**
 * MCPサーバ設定（MCP-002）。ツール設定配下のセクションとして表示する。
 * ローカル MCP サーバ（Streamable HTTP、127.0.0.1）の有効化とポートを管理し、
 * 適用時に Backend のサーバ状態へ即時反映する。
 */
import { useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'

interface McpStatusResult {
  enabled: boolean
  port: number
  running: boolean
  url: string | null
  toolCount: number
}

export function McpServerSettingsSection(): React.JSX.Element {
  const notify = useJobsStore((state) => state.notify)
  const [enabled, setEnabled] = useState(false)
  const [port, setPort] = useState('39400')
  const [status, setStatus] = useState<McpStatusResult | null>(null)
  const [applying, setApplying] = useState(false)

  const refresh = async (): Promise<void> => {
    const result = await invoke<McpStatusResult>('mcp.status')
    if (result.ok) {
      setStatus(result.result)
      setEnabled(result.result.enabled)
      setPort(String(result.result.port))
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const apply = async (): Promise<void> => {
    const portNumber = Number(port)
    if (!Number.isInteger(portNumber) || portNumber < 1024 || portNumber > 65535) {
      notify('error', 'MCPサーバのポートは1024〜65535の整数で指定してください')
      return
    }
    setApplying(true)
    const result = await invoke<McpStatusResult>('mcp.applySettings', { enabled, port: portNumber })
    setApplying(false)
    if (result.ok) {
      setStatus(result.result)
      notify(
        'info',
        result.result.running ? `MCPサーバを起動しました: ${result.result.url ?? ''}` : 'MCPサーバを停止しました'
      )
    } else {
      notify('error', 'MCPサーバ設定の適用に失敗しました', result.error.message)
      await refresh()
    }
  }

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }

  return (
    <section data-testid="setting-mcp-section">
      <h2 style={{ fontSize: 14, marginTop: 20 }}>└ MCPサーバ設定（MCP-001〜003）</h2>
      <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11.5 }}>
        AIエージェントが設計情報（要素一覧・検索・詳細・上流／下流トレース）を問い合わせできるローカルMCPサーバ
        （Streamable HTTP、127.0.0.1のみ）を起動します。読み取り専用で、プロジェクトを開いている間だけ応答します。
      </p>
      <label style={rowStyle} title="有効にすると適用時およびツール起動時にMCPサーバを自動起動します">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          data-testid="setting-mcp-enabled"
        />
        MCPサーバを有効にする
      </label>
      <div style={rowStyle}>
        <label style={{ width: 120, color: 'var(--d2d-fg-muted)' }} htmlFor="setting-mcp-port">
          ポート
        </label>
        <input
          id="setting-mcp-port"
          data-testid="setting-mcp-port"
          style={{ width: 120 }}
          value={port}
          onChange={(event) => setPort(event.target.value)}
          placeholder="既定: 39400"
          title="MCPサーバが127.0.0.1上で待ち受けるポート番号（1024〜65535）"
        />
      </div>
      <div style={rowStyle}>
        <button
          type="button"
          className="d2d-btn primary"
          onClick={() => void apply()}
          disabled={applying}
          data-testid="setting-mcp-apply"
        >
          MCPサーバ設定を適用
        </button>
        <span data-testid="setting-mcp-status">
          状態: {status ? (status.running ? `起動中（${status.url ?? ''}）` : '停止') : '取得中…'}
        </span>
      </div>
    </section>
  )
}
