import { create } from 'zustand'
import { invoke } from '../services/backend'
import type { PipelineStats, ProjectInfo } from '../types/api-contract'

export type { PipelineStats, ProjectInfo }

interface ProjectState {
  project: ProjectInfo | null
  stats: PipelineStats | null
  setProject(project: ProjectInfo | null): void
  refresh(): Promise<void>
  refreshStats(): Promise<void>
  /** Backendイベント起点の再集計要求。短時間に連続するイベントを1回の取得へ集約する */
  requestStatsRefresh(): void
}

/** イベント連続発生時（取込ジョブ等）の集約待ち時間（改善対応3） */
export const STATS_REFRESH_COALESCE_MS = 300
let statsRefreshTimer: ReturnType<typeof setTimeout> | null = null

export const useProjectStore = create<ProjectState>((set, get) => ({
  project: null,
  stats: null,

  setProject: (project) => {
    set({ project, stats: project ? get().stats : null })
    if (project) void get().refreshStats()
  },

  refresh: async () => {
    const res = await invoke<ProjectInfo | null>('project.getInfo')
    if (res.ok) {
      set({ project: res.result })
      if (res.result) void get().refreshStats()
    }
  },

  refreshStats: async () => {
    const res = await invoke('project.getPipelineStats')
    if (res.ok) set({ stats: res.result })
  },

  requestStatsRefresh: () => {
    if (statsRefreshTimer !== null) return
    statsRefreshTimer = setTimeout(() => {
      statsRefreshTimer = null
      void get().refreshStats()
    }, STATS_REFRESH_COALESCE_MS)
  }
}))
