/**
 * MCP サーバ API（MCP-001〜003）。
 * ツール設定「MCPサーバ設定」（mcp.enabled / mcp.port）と Status Bar の起動状態表示が使用する。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { SettingsService } from '../settings/settings-service'
import { DEFAULT_MCP_PORT, type McpServerService, type McpServerStatus } from '../mcp/mcp-service'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', String(params))
  }
  return params as Record<string, unknown>
}

export interface McpSettings {
  enabled: boolean
  port: number
}

export function readMcpSettings(settings: SettingsService): McpSettings {
  const enabled = settings.get('mcp.enabled') === true
  const rawPort = settings.get('mcp.port')
  const port = typeof rawPort === 'number' && Number.isInteger(rawPort) ? rawPort : DEFAULT_MCP_PORT
  return { enabled, port }
}

/** 設定に従ってサーバを起動／停止する（起動失敗は呼び出し元へ伝播） */
export async function applyMcpSettings(mcp: McpServerService, config: McpSettings): Promise<McpServerStatus> {
  return config.enabled ? mcp.start(config.port) : mcp.stop()
}

export function registerMcpApi(router: ApiRouter, settings: SettingsService, mcp: McpServerService): void {
  /** 起動状態（Status Bar・設定画面の表示用） */
  router.register('mcp.status', () => ({ ...readMcpSettings(settings), ...mcp.status() }))

  /** アクセスログの参照（MCP-009/010。下部パネル「MCPログ」が使用、新しい順） */
  router.register('mcp.getAccessLog', (params) => {
    const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    return mcp.accessLog.list(typeof p.limit === 'number' ? p.limit : undefined)
  })

  /** 設定の保存とサーバ状態への反映（MCP-002）。起動失敗時は設定を保存したままエラーを返す */
  router.register('mcp.applySettings', async (params) => {
    const p = asRecord(params)
    const current = readMcpSettings(settings)
    const next: McpSettings = {
      enabled: typeof p.enabled === 'boolean' ? p.enabled : current.enabled,
      port: p.port === undefined ? current.port : Number(p.port)
    }
    if (!Number.isInteger(next.port) || next.port < 1024 || next.port > 65535) {
      throw new BackendError('validation', 'MCPサーバのポートは1024〜65535の整数で指定してください', String(p.port))
    }
    settings.set('mcp.enabled', next.enabled)
    settings.set('mcp.port', next.port)
    const status = await applyMcpSettings(mcp, next)
    return { ...next, ...status }
  })
}
