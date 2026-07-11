import { create } from 'zustand'
import type { ApiError } from '../types/ipc'
import { invoke } from '../services/backend'

export type JobStatus = 'waiting' | 'running' | 'success' | 'failed' | 'partial' | 'aborted'

export interface JobRecord {
  jobId: string
  type: string
  status: JobStatus
  progress: number
  message: string | null
  error: ApiError | null
  createdAt?: string
  startedAt?: string | null
  completedAt?: string | null
}

export interface NotificationItem {
  id: number
  kind: 'info' | 'warning' | 'error'
  message: string
  detail?: string
}

interface JobsState {
  jobs: JobRecord[]
  notifications: NotificationItem[]
  runningCount: number
  applyUpdate(update: JobRecord): void
  refresh(): Promise<void>
  notify(kind: NotificationItem['kind'], message: string, detail?: string): void
  dismissNotification(id: number): void
}

let notificationSeq = 1

export const useJobsStore = create<JobsState>((set, get) => ({
  jobs: [],
  notifications: [],
  runningCount: 0,

  applyUpdate: (update) => {
    const jobs = [...get().jobs]
    const idx = jobs.findIndex((j) => j.jobId === update.jobId)
    if (idx >= 0) {
      jobs[idx] = { ...jobs[idx], ...update }
    } else {
      jobs.unshift(update)
    }
    set({ jobs, runningCount: jobs.filter((j) => j.status === 'running' || j.status === 'waiting').length })

    // 完了通知（sdd_ui_design §14 Notification）
    if (update.status === 'failed') {
      get().notify('error', `ジョブが失敗しました: ${update.type}`, update.error?.message)
    } else if (update.status === 'partial') {
      get().notify('warning', `ジョブが部分完了しました: ${update.type}`)
    } else if (update.status === 'success') {
      get().notify('info', `ジョブが完了しました: ${update.type}`)
    }
  },

  refresh: async () => {
    const res = await invoke<JobRecord[]>('job.list')
    if (res.ok) {
      set({
        jobs: res.result,
        runningCount: res.result.filter((j) => j.status === 'running' || j.status === 'waiting').length
      })
    }
  },

  notify: (kind, message, detail) => {
    const id = notificationSeq++
    set({ notifications: [...get().notifications, { id, kind, message, detail }] })
    // 情報通知は自動で消す
    if (kind === 'info') {
      setTimeout(() => get().dismissNotification(id), 5000)
    }
  },

  dismissNotification: (id) => {
    set({ notifications: get().notifications.filter((n) => n.id !== id) })
  }
}))
