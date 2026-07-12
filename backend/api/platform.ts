/**
 * プラットフォーム基盤 API（P2: settings / job / feature / worker）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import type { SettingsService } from '../settings/settings-service'
import { getProjectSettings, setProjectSetting } from '../settings/settings-service'
import { listFeatures } from '../features/feature-registry'
import { requireProject } from '../project/project-service'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', String(params))
  }
  return params as Record<string, unknown>
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new BackendError('validation', `${key} は必須の文字列です`, '')
  }
  return value
}

export function registerSettingsApi(router: ApiRouter, settings: SettingsService): void {
  router.register('settings.getStorageInfo', () => settings.getStorageInfo())
  router.register('settings.getAll', () => settings.getAll())
  router.register('settings.get', (params) => settings.get(requireString(asRecord(params), 'key')))
  router.register('settings.set', (params) => {
    const p = asRecord(params)
    settings.set(requireString(p, 'key'), p.value)
    return { saved: true }
  })
  router.register('settings.delete', (params) => {
    settings.delete(requireString(asRecord(params), 'key'))
    return { deleted: true }
  })

  // 機密情報（CORE-044/045）。値の取得 API は提供しない（Backend 内部利用のみ）
  router.register('settings.setSecret', async (params) => {
    const p = asRecord(params)
    await settings.setSecret(requireString(p, 'key'), requireString(p, 'value'))
    return { saved: true }
  })
  router.register('settings.hasSecret', (params) => settings.hasSecret(requireString(asRecord(params), 'key')))
  router.register('settings.listSecretKeys', () => settings.listSecretKeys())
  router.register('settings.getSecret', async (params) =>
    settings.getSecretValue(requireString(asRecord(params), 'key'))
  )
  router.register('settings.deleteSecret', (params) => {
    settings.deleteSecret(requireString(asRecord(params), 'key'))
    return { deleted: true }
  })

  // エクスポート / インポート（CORE-046。機密除外）
  router.register('settings.export', () => settings.exportSettings())
  router.register('settings.import', (params) => ({ imported: settings.importSettings(params) }))

  // プロジェクト別設定（CORE-041）
  router.register('settings.getProjectSettings', () => {
    const project = requireProject()
    return getProjectSettings(project.paths.root)
  })
  router.register('settings.setProjectSetting', (params) => {
    const p = asRecord(params)
    const project = requireProject()
    setProjectSetting(project.paths.root, requireString(p, 'key'), p.value)
    return { saved: true }
  })
}

export function registerJobApi(router: ApiRouter, jobs: JobManager): void {
  router.register('job.list', () => jobs.list())
  router.register('job.get', (params) => jobs.get(requireString(asRecord(params), 'jobId')))
  router.register('job.enqueue', (params) => {
    const p = asRecord(params)
    return jobs.enqueue(requireString(p, 'type'), p.params ?? {})
  })
  router.register('job.cancel', (params) => jobs.cancel(requireString(asRecord(params), 'jobId')))
  router.register('job.retry', (params) => jobs.retry(requireString(asRecord(params), 'jobId')))
  router.register('job.listTypes', () => jobs.executorTypes())

  /** ジョブログ JSONL の読み出し（CORE-022、V-16 Job Log Viewer） */
  router.register('job.getLog', (params) => {
    const jobId = requireString(asRecord(params), 'jobId')
    // ジョブ実在確認（見つからなければ not_found 契約）
    jobs.get(jobId)
    const project = requireProject()
    const logPath = join(project.paths.logsDir, 'jobs', `${jobId}.jsonl`)
    if (!existsSync(logPath)) return []
    return readFileSync(logPath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => {
        try {
          return JSON.parse(line) as unknown
        } catch {
          return { ts: '', level: 'info', message: line }
        }
      })
  })
}

export function registerFeatureApi(router: ApiRouter): void {
  router.register('feature.list', () => listFeatures())
}
