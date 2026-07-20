/**
 * MCP サーバのアクセスログ（MCP-009/010）。
 * JSON-RPC リクエスト単位で記録し、Renderer の下部パネル（MCPログ）から参照する。
 * - メモリ上のリングバッファ（最大500件）を正とし、mcp.getAccessLog で新しい順に返す
 * - プロジェクトが開いている間は logs/mcp/access-YYYY-MM-DD.jsonl へも追記する（日付毎・ローカル日付）
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { currentProject } from '../project/project-service'
import { eventBus } from '../events/event-bus'

export interface McpAccessLogEntry {
  /** ISO 8601 タイムスタンプ */
  ts: string
  /** JSON-RPC メソッド（initialize / tools/list / tools/call 等）。http はプロトコル外アクセス */
  method: string
  /** tools/call のツール名 */
  toolName: string | null
  /** 引数の要約（最大200文字。応答本文は記録しない） */
  argsSummary: string | null
  ok: boolean
  errorMessage: string | null
  durationMs: number
}

const MAX_ENTRIES = 500
const ARGS_SUMMARY_MAX = 200

export class McpAccessLog {
  private readonly entries: McpAccessLogEntry[] = []

  record(input: Omit<McpAccessLogEntry, 'ts' | 'argsSummary'> & { args?: unknown }): void {
    const entry: McpAccessLogEntry = {
      ts: new Date().toISOString(),
      method: input.method,
      toolName: input.toolName,
      argsSummary: summarizeArgs(input.args),
      ok: input.ok,
      errorMessage: input.errorMessage,
      durationMs: input.durationMs
    }
    this.entries.push(entry)
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES)
    this.appendToFile(entry)
    eventBus.emit('mcp.accessLogged', { method: entry.method, toolName: entry.toolName, ok: entry.ok })
  }

  /** 新しい順に返す */
  list(limit = 200): McpAccessLogEntry[] {
    const count = Math.min(Math.max(limit, 1), MAX_ENTRIES)
    return [...this.entries].reverse().slice(0, count)
  }

  clear(): void {
    this.entries.length = 0
  }

  /** プロジェクト未オープン時はファイル出力しない（デバッグログと同じ方針） */
  private appendToFile(entry: McpAccessLogEntry): void {
    const project = currentProject()
    if (!project) return
    try {
      const dir = join(project.info.rootPath, 'logs', 'mcp')
      mkdirSync(dir, { recursive: true })
      const now = new Date()
      const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
      appendFileSync(join(dir, `access-${stamp}.jsonl`), `${JSON.stringify(entry)}\n`, 'utf-8')
    } catch {
      // ログ出力失敗で MCP 応答を壊さない
    }
  }
}

function summarizeArgs(args: unknown): string | null {
  if (args === undefined || args === null) return null
  try {
    const text = JSON.stringify(args)
    return text.length > ARGS_SUMMARY_MAX ? `${text.slice(0, ARGS_SUMMARY_MAX)}…` : text
  } catch {
    return String(args).slice(0, ARGS_SUMMARY_MAX)
  }
}
