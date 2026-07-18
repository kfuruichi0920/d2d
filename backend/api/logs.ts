/**
 * デバッグログ API（W11、NFR-010 拡張）。
 * Renderer からのログ追記（log.append）と、Panel 表示用の末尾読取（log.tail）を提供する。
 * レベルはプロジェクト設定 `logging.debugLevel`（settings.setProjectSetting で変更）。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import {
  appendDebugLog,
  currentDebugLogLevel,
  tailDebugLog,
  DEBUG_LOG_LEVELS,
  type DebugLogLevel,
  type DebugLogSource
} from '../logging/debug-log'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'params はオブジェクトである必要があります', '')
  }
  return params as Record<string, unknown>
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new BackendError('validation', `${key} は必須です`, '')
  }
  return value
}

function asLevel(value: unknown): DebugLogLevel {
  return typeof value === 'string' && (DEBUG_LOG_LEVELS as string[]).includes(value) ? (value as DebugLogLevel) : 'info'
}

function asSource(value: unknown): DebugLogSource {
  return value === 'backend' ? 'backend' : 'frontend'
}

export function registerLogsApi(router: ApiRouter): void {
  router.register('log.append', (params) => {
    const p = asRecord(params)
    const written = appendDebugLog(
      asSource(p.source),
      asLevel(p.level),
      requireString(p, 'message'),
      typeof p.detail === 'string' ? p.detail : undefined
    )
    return { written }
  })

  router.register('log.tail', (params) => {
    const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    const limit = typeof p.limit === 'number' && p.limit > 0 ? Math.min(2000, Math.floor(p.limit)) : 500
    return { ...tailDebugLog(asSource(p.source), limit), level: currentDebugLogLevel() }
  })
}
