import { create } from 'zustand'
import { invoke } from '../services/backend'
import { useLogsStore } from './logs-store'
import type { JobRecord, JobStatus } from '../types/api-contract'

export type { JobRecord, JobStatus }

/** トーストの自動消去時間。エラーは通常の3倍表示する（W11） */
const TOAST_DISMISS_MS = 5000
const ERROR_TOAST_DISMISS_MS = TOAST_DISMISS_MS * 3

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
    // すべて自動で消す。エラーは通常の3倍の時間表示する（W11）
    setTimeout(() => get().dismissNotification(id), kind === 'error' ? ERROR_TOAST_DISMISS_MS : TOAST_DISMISS_MS)
    // 動作ログへ記録し、デバッグログファイルにも残す（失敗は無視）
    useLogsStore.getState().append(kind, message, detail)
    void invoke('log.append', {
      source: 'frontend',
      level: kind === 'warning' ? 'warn' : kind,
      message,
      detail
    }).catch(() => undefined)
  },

  dismissNotification: (id) => {
    set({ notifications: get().notifications.filter((n) => n.id !== id) })
  }
}))
