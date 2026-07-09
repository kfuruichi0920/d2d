import { create } from 'zustand'
import { invoke } from '../services/backend'

export interface ProjectInfo {
  projectUid: string
  name: string
  description: string | null
  rootPath: string
  schemaVersion: string
  code: string | null
}

/** Pipeline Navigator 用のステージ集計（sdd_ui_design §3.1） */
export interface PipelineStats {
  sources: number
  extracted: number
  intermediate: number
  designElements: number
  traceLinks: number
  candidates: number
}

interface ProjectState {
  project: ProjectInfo | null
  stats: PipelineStats | null
  setProject(project: ProjectInfo | null): void
  refresh(): Promise<void>
  refreshStats(): Promise<void>
}

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
    const res = await invoke<PipelineStats>('project.getPipelineStats')
    if (res.ok) set({ stats: res.result })
  }
}))
