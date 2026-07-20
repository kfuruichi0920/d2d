/**
 * ローカル MCP サーバ（MCP-001〜003）。
 * MCP Streamable HTTP transport（JSON-RPC 2.0 / POST）を node:http で実装し、
 * AI エージェントへ設計情報クエリツール（mcp-tools.ts）を公開する。
 *
 * - 127.0.0.1 のみへバインドし、外部ネットワークへは公開しない
 * - 読み取り専用。プロジェクト未オープン時はツール呼び出しがエラー応答になる
 * - SSE ストリーム（GET）は未対応。単発 POST の JSON 応答のみ（将来拡張）
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'
import { MCP_TOOL_DEFINITIONS, callMcpTool, listMcpTools, type McpToolContext } from './mcp-tools'
import { McpAccessLog } from './access-log'

/** MCP プロトコル版数。initialize でクライアント指定があればそれを尊重する */
const DEFAULT_PROTOCOL_VERSION = '2025-06-18'
const SUPPORTED_PROTOCOL_VERSIONS = new Set(['2024-11-05', '2025-03-26', DEFAULT_PROTOCOL_VERSION])
const SERVER_INFO = { name: 'd2d-design-info', version: '0.1.0' }
const MAX_BODY_BYTES = 4 * 1024 * 1024
export const DEFAULT_MCP_PORT = 39400

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number | string | null
  method: string
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

export interface McpServerStatus {
  running: boolean
  port: number | null
  url: string | null
  toolCount: number
}

/** ツール実行文脈の供給者。プロジェクト未オープン時は null を返す */
export type McpContextProvider = () => McpToolContext | null

/** JSON-RPC 2.0 の Method not found（-32601）を表す内部例外 */
class MethodNotFoundError extends Error {}

export class McpServerService {
  private server: Server | null = null
  private port: number | null = null
  /** アクセスログ（MCP-009）。JSON-RPC リクエスト単位で記録する */
  readonly accessLog = new McpAccessLog()

  constructor(private readonly contextProvider: McpContextProvider) {}

  status(): McpServerStatus {
    return {
      running: this.server !== null,
      port: this.port,
      url: this.port === null ? null : `http://127.0.0.1:${this.port}/mcp`,
      toolCount: MCP_TOOL_DEFINITIONS.length
    }
  }

  async start(port: number): Promise<McpServerStatus> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new BackendError('validation', 'MCPサーバのポートは1024〜65535の整数で指定してください', String(port))
    }
    if (this.server) {
      if (this.port === port) return this.status()
      await this.stop()
    }
    const server = createServer((req, res) => void this.handleRequest(req, res))
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const onError = (error: Error): void => rejectPromise(error)
      server.once('error', onError)
      server.listen(port, '127.0.0.1', () => {
        server.off('error', onError)
        resolvePromise()
      })
    }).catch((error: Error) => {
      throw new BackendError('io', `MCPサーバを起動できませんでした（ポート ${port}）`, error.message, true)
    })
    this.server = server
    this.port = port
    eventBus.emit('mcp.statusChanged', this.status())
    return this.status()
  }

  async stop(): Promise<McpServerStatus> {
    const server = this.server
    if (!server) return this.status()
    this.server = null
    this.port = null
    await new Promise<void>((resolvePromise) => {
      server.close(() => resolvePromise())
      // keep-alive 接続を残さず確実に停止する
      server.closeAllConnections?.()
    })
    eventBus.emit('mcp.statusChanged', this.status())
    return this.status()
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1`)
      if (url.pathname !== '/mcp') {
        this.sendJson(res, 404, { error: 'not_found' })
        return
      }
      if (req.method !== 'POST') {
        // SSE ストリーム（GET）・セッション削除（DELETE)は未対応
        res.writeHead(405, { Allow: 'POST' }).end()
        return
      }
      const body = await this.readBody(req)
      let parsed: unknown
      try {
        parsed = JSON.parse(body)
      } catch {
        this.sendJson(res, 400, {
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' }
        })
        return
      }
      // 通知（id なし）はバッチも含め 202 で受理する
      const requests = Array.isArray(parsed) ? parsed : [parsed]
      const responses = requests
        .filter((request): request is JsonRpcRequest => this.isJsonRpcRequest(request))
        .filter((request) => request.id !== undefined && request.id !== null)
        .map((request) => this.dispatch(request))
      if (responses.length === 0) {
        res.writeHead(202).end()
        return
      }
      this.sendJson(res, 200, Array.isArray(parsed) ? responses : responses[0])
    } catch (error) {
      this.sendJson(res, 500, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) }
      })
    }
  }

  private isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
    return (
      typeof value === 'object' &&
      value !== null &&
      (value as Record<string, unknown>).jsonrpc === '2.0' &&
      typeof (value as Record<string, unknown>).method === 'string'
    )
  }

  private dispatch(request: JsonRpcRequest): JsonRpcResponse {
    const id = request.id ?? null
    const startedAt = Date.now()
    const params = (request.params ?? {}) as Record<string, unknown>
    const toolName = request.method === 'tools/call' && typeof params.name === 'string' ? params.name : null
    const logResult = (ok: boolean, errorMessage: string | null): void => {
      this.accessLog.record({
        method: request.method,
        toolName,
        args: toolName ? params.arguments : undefined,
        ok,
        errorMessage,
        durationMs: Date.now() - startedAt
      })
    }
    const response = this.dispatchInner(request, id)
    if (response.error) {
      logResult(false, response.error.message)
    } else {
      const isError = (response.result as { isError?: boolean } | undefined)?.isError === true
      const errorText = isError
        ? ((response.result as { content?: { text?: string }[] }).content?.[0]?.text ?? 'ツールエラー')
        : null
      logResult(!isError, errorText)
    }
    return response
  }

  private dispatchInner(request: JsonRpcRequest, id: number | string | null): JsonRpcResponse {
    try {
      return { jsonrpc: '2.0', id, result: this.handleMethod(request) }
    } catch (error) {
      if (error instanceof MethodNotFoundError) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: error.message } }
      }
      if (error instanceof BackendError) {
        // ツール実行エラーは MCP 仕様どおり result.isError で返す（プロトコルエラーと区別）
        if (request.method === 'tools/call') {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              content: [{ type: 'text', text: `${error.message}${error.detail ? `（${error.detail}）` : ''}` }],
              isError: true
            }
          }
        }
        return { jsonrpc: '2.0', id, error: { code: -32602, message: error.message, data: error.detail } }
      }
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) }
      }
    }
  }

  private handleMethod(request: JsonRpcRequest): unknown {
    const params = (request.params ?? {}) as Record<string, unknown>
    switch (request.method) {
      case 'initialize': {
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
        return {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.has(requested) ? requested : DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
          instructions:
            'D2D の設計情報（原本・抽出・中間データ・設計モデル・トレース関係）を照会するツールを提供します。' +
            'まず list_element_types で全体像を把握し、search_elements → get_elements → trace_upstream / trace_downstream の順で深掘りしてください。'
        }
      }
      case 'ping':
        return {}
      case 'tools/list':
        // 静的6ツール + 定義済み分析スロット（MCP-011。プロジェクト未オープン時は静的分のみ）
        return { tools: listMcpTools(this.contextProvider()) }
      case 'tools/call': {
        const name = typeof params.name === 'string' ? params.name : ''
        const ctx = this.contextProvider()
        if (!ctx) {
          throw new BackendError('conflict', 'プロジェクトが開かれていないため設計情報を応答できません', '')
        }
        const result = callMcpTool(ctx, name, params.arguments)
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
      }
      default:
        throw new MethodNotFoundError(`Method not found: ${request.method}`)
    }
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolvePromise, rejectPromise) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size > MAX_BODY_BYTES) {
          rejectPromise(new Error('リクエストボディが大きすぎます'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', rejectPromise)
    })
  }

  private sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
    const body = JSON.stringify(payload)
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body)
    })
    res.end(body)
  }
}
