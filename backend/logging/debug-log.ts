/**
 * デバッグログ出力（W11、NFR-010 拡張）。
 * フロント／バックエンド双方のデバッグログを、開いているプロジェクトの
 * `logs/debug/<source>-YYYY-MM-DD.log` に日付毎で追記する。
 * 出力レベルはプロジェクト設定 `logging.debugLevel`（error < warn < info < debug、既定 info）。
 * プロジェクト未オープン時はファイル出力しない（動作ログ・トーストは Renderer 側で保持）。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { currentProject } from '../project/project-service'
import { getProjectSettings } from '../settings/settings-service'

export type DebugLogLevel = 'error' | 'warn' | 'info' | 'debug'
export type DebugLogSource = 'frontend' | 'backend'

export const DEBUG_LOG_LEVEL_KEY = 'logging.debugLevel'
export const DEBUG_LOG_LEVELS: DebugLogLevel[] = ['error', 'warn', 'info', 'debug']

const LEVEL_ORDER: Record<DebugLogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 }

function isLevel(value: unknown): value is DebugLogLevel {
  return typeof value === 'string' && (DEBUG_LOG_LEVELS as string[]).includes(value)
}

/** 現在のプロジェクトのデバッグログレベル（未設定・未オープンは info） */
export function currentDebugLogLevel(): DebugLogLevel {
  const project = currentProject()
  if (!project) return 'info'
  try {
    const value = getProjectSettings(project.info.rootPath)[DEBUG_LOG_LEVEL_KEY]
    return isLevel(value) ? value : 'info'
  } catch {
    return 'info'
  }
}

function dateStamp(date: Date): string {
  // ローカル日付で日毎ファイルを切る（解析時の体感と一致させる）
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** 対象日のログファイルパス。プロジェクト未オープン時は null */
export function debugLogFilePath(source: DebugLogSource, date = new Date()): string | null {
  const project = currentProject()
  if (!project) return null
  return join(project.info.rootPath, 'logs', 'debug', `${source}-${dateStamp(date)}.log`)
}

/**
 * 1行追記する。レベルフィルタ・未オープンで書かなかった場合は false。
 * ログ出力の失敗は業務処理を妨げない（例外を投げない）。
 */
export function appendDebugLog(
  source: DebugLogSource,
  level: DebugLogLevel,
  message: string,
  detail?: string
): boolean {
  if (LEVEL_ORDER[level] > LEVEL_ORDER[currentDebugLogLevel()]) return false
  const path = debugLogFilePath(source)
  if (!path) return false
  try {
    mkdirSync(dirname(path), { recursive: true })
    const single = (text: string): string => text.replace(/\r?\n/g, '\\n')
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] ${single(message)}${detail ? ` | ${single(detail)}` : ''}\n`
    appendFileSync(path, line, 'utf8')
    return true
  } catch {
    return false
  }
}

/** 対象日ログの末尾 limit 行を返す（Panel のデバッグログ表示用） */
export function tailDebugLog(
  source: DebugLogSource,
  limit = 500,
  date = new Date()
): { file: string | null; lines: string[] } {
  const path = debugLogFilePath(source, date)
  if (!path || !existsSync(path)) return { file: path, lines: [] }
  try {
    const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean)
    return { file: path, lines: lines.slice(-Math.max(1, limit)) }
  } catch {
    return { file: path, lines: [] }
  }
}
