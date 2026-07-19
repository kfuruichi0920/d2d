/**
 * project-store の統計再取得コアレス化の検証（改善対応3）。
 * 短時間に連続する requestStatsRefresh が 1 回の project.getPipelineStats に集約されること。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STATS_REFRESH_COALESCE_MS, useProjectStore } from './project-store'
import type { PipelineStats } from '../types/api-contract'

const stats: PipelineStats = {
  sources: 1,
  extracted: 2,
  intermediate: 3,
  designElements: 4,
  traceLinks: 5,
  candidates: 6
}

let invokeCalls: string[] = []

beforeEach(() => {
  vi.useFakeTimers()
  invokeCalls = []
  // Renderer 前提の window.api を node 環境へスタブする
  ;(globalThis as { window?: unknown }).window = {
    api: {
      invoke: (method: string) => {
        invokeCalls.push(method)
        return Promise.resolve({ ok: true, result: stats })
      },
      onEvent: () => () => undefined
    }
  }
})

afterEach(() => {
  vi.useRealTimers()
  delete (globalThis as { window?: unknown }).window
})

describe('requestStatsRefresh', () => {
  it('連続要求を1回の取得へ集約する', async () => {
    const store = useProjectStore.getState()
    store.requestStatsRefresh()
    store.requestStatsRefresh()
    store.requestStatsRefresh()
    expect(invokeCalls).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(STATS_REFRESH_COALESCE_MS)
    expect(invokeCalls).toEqual(['project.getPipelineStats'])
    expect(useProjectStore.getState().stats).toEqual(stats)
  })

  it('集約時間経過後の新しい要求は再度取得する', async () => {
    const store = useProjectStore.getState()
    store.requestStatsRefresh()
    await vi.advanceTimersByTimeAsync(STATS_REFRESH_COALESCE_MS)
    store.requestStatsRefresh()
    await vi.advanceTimersByTimeAsync(STATS_REFRESH_COALESCE_MS)
    expect(invokeCalls).toEqual(['project.getPipelineStats', 'project.getPipelineStats'])
  })
})
