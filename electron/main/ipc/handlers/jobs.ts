import { ipcMain } from 'electron'
import { listJobs, getJobLog, cancelJob, createJob } from '../../jobs/job-manager'
import type { BatchType } from '../../jobs/job-manager'

export function registerJobHandlers(): void {
  ipcMain.handle('jobs:list', () => listJobs())

  ipcMain.handle('jobs:getLog', (_event, jobId: string) => getJobLog(jobId))

  ipcMain.handle('jobs:cancel', (_event, jobId: string) => {
    cancelJob(jobId)
  })

  // retry: 同一設定で新しいジョブを作成する
  ipcMain.handle('jobs:retry', (_event, jobId: string) => {
    const jobs = listJobs(1000)
    const original = jobs.find((j) => j.uid === jobId)
    if (!original) throw new Error(`Job not found: ${jobId}`)
    createJob({
      batchType: original.batch_type as BatchType,
      settingsJson: original.settings_json ?? undefined,
      executedBy: original.executed_by ?? undefined
    })
  })
}
