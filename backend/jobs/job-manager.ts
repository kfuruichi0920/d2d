/**
 * ジョブ管理（P2-3、CORE-020〜024、NFR-003/011）。
 *
 * - 長時間処理をジョブとして登録し、UI と分離して逐次実行する
 * - 状態: waiting / running / success / failed / partial / aborted（DDL batch_operation_info と同じ集合）
 * - 進捗・状態変化は job.updated イベントで通知する
 * - ジョブログは logs/jobs/<job_uid>.jsonl へ JSONL 追記する
 * - failed / partial / aborted は条件付き再実行（retry）できる
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BackendError, toApiError } from '../api/errors'
import type { ApiError } from '../../src/types/ipc'
import { EventBus } from '../events/event-bus'
import { newUid } from '../store/uid'

export type JobStatus = 'waiting' | 'running' | 'success' | 'failed' | 'partial' | 'aborted'

export interface JobContext {
  jobId: string
  signal: AbortSignal
  /** 0-100 の進捗とメッセージを通知する */
  reportProgress(percent: number, message?: string): void
  /** ログ行を追記する（進捗以外の詳細ログ） */
  log(level: 'info' | 'warn' | 'error', message: string, data?: unknown): void
}

export interface JobResult {
  status: 'success' | 'partial'
  output?: unknown
}

export type JobExecutor = (params: unknown, ctx: JobContext) => Promise<JobResult>

export interface JobRecord {
  jobId: string
  type: string
  params: unknown
  status: JobStatus
  progress: number
  message: string | null
  output: unknown
  error: ApiError | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
  retryOfJobId: string | null
}

const MAX_RETAINED_JOBS = 500

export class JobManager {
  private readonly executors = new Map<string, JobExecutor>()
  private readonly jobs = new Map<string, JobRecord>()
  private readonly aborters = new Map<string, AbortController>()
  private readonly queue: string[] = []
  private running = false
  /** ジョブログ出力先ディレクトリ（プロジェクト open 時に設定される）。未設定時はログを出さない */
  private logDir: string | null = null

  constructor(private readonly bus: EventBus) {}

  registerExecutor(type: string, executor: JobExecutor): void {
    if (this.executors.has(type)) {
      throw new Error(`Job executor already registered: ${type}`)
    }
    this.executors.set(type, executor)
  }

  executorTypes(): string[] {
    return [...this.executors.keys()]
  }

  setLogDir(dir: string | null): void {
    this.logDir = dir
  }

  /** ジョブを登録しキューへ投入する（CORE-020） */
  enqueue(type: string, params: unknown, retryOfJobId: string | null = null): JobRecord {
    if (!this.executors.has(type)) {
      throw new BackendError('validation', `未登録のジョブ種別です: ${type}`, '')
    }
    const job: JobRecord = {
      jobId: newUid(),
      type,
      params,
      status: 'waiting',
      progress: 0,
      message: null,
      output: null,
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      retryOfJobId
    }
    this.jobs.set(job.jobId, job)
    this.trimJobs()
    this.queue.push(job.jobId)
    this.writeLog(job.jobId, 'info', `ジョブ登録: ${type}`, { params })
    this.notify(job)
    // pump() は同期的に実行を開始し得るため、登録時点のスナップショットを先に取る
    const snapshot = { ...job }
    void this.pump()
    return snapshot
  }

  get(jobId: string): JobRecord {
    const job = this.jobs.get(jobId)
    if (!job) {
      throw new BackendError('not_found', `ジョブが見つかりません: ${jobId}`, '')
    }
    return { ...job }
  }

  list(): JobRecord[] {
    return [...this.jobs.values()].map((j) => ({ ...j })).reverse()
  }

  /** 実行中ジョブへ中断を要求する（協調キャンセル。CORE-021 の「中断」） */
  cancel(jobId: string): JobRecord {
    const job = this.jobs.get(jobId)
    if (!job) {
      throw new BackendError('not_found', `ジョブが見つかりません: ${jobId}`, '')
    }
    if (job.status === 'waiting') {
      const idx = this.queue.indexOf(jobId)
      if (idx >= 0) this.queue.splice(idx, 1)
      this.finish(job, 'aborted', null, {
        error_code: 'cancelled',
        message: '実行前に中断されました',
        detail: '',
        retryable: true
      })
    } else if (job.status === 'running') {
      this.aborters.get(jobId)?.abort()
    } else {
      throw new BackendError('conflict', `完了済みジョブは中断できません: ${job.status}`, '')
    }
    return this.get(jobId)
  }

  /** 失敗・部分完了・中断ジョブの条件付き再実行（CORE-024） */
  retry(jobId: string): JobRecord {
    const job = this.get(jobId)
    if (!['failed', 'partial', 'aborted'].includes(job.status)) {
      throw new BackendError(
        'conflict',
        `再実行できる状態ではありません: ${job.status}`,
        'failed / partial / aborted のみ再実行できます'
      )
    }
    if (job.error && !job.error.retryable) {
      throw new BackendError('conflict', 'このジョブは再実行不可のエラーで終了しています', job.error.message)
    }
    return this.enqueue(job.type, job.params, jobId)
  }

  private async pump(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      for (;;) {
        const jobId = this.queue.shift()
        if (!jobId) break
        const job = this.jobs.get(jobId)
        if (!job || job.status !== 'waiting') continue
        await this.run(job)
      }
    } finally {
      this.running = false
    }
  }

  private async run(job: JobRecord): Promise<void> {
    const executor = this.executors.get(job.type)
    if (!executor) return

    const aborter = new AbortController()
    this.aborters.set(job.jobId, aborter)
    job.status = 'running'
    job.startedAt = new Date().toISOString()
    this.writeLog(job.jobId, 'info', 'ジョブ開始')
    this.notify(job)

    const ctx: JobContext = {
      jobId: job.jobId,
      signal: aborter.signal,
      reportProgress: (percent, message) => {
        job.progress = Math.max(0, Math.min(100, Math.round(percent)))
        if (message !== undefined) job.message = message
        this.notify(job)
      },
      log: (level, message, data) => this.writeLog(job.jobId, level, message, data)
    }

    try {
      const result = await executor(job.params, ctx)
      if (aborter.signal.aborted) {
        this.finish(job, 'aborted', null, {
          error_code: 'cancelled',
          message: 'ジョブが中断されました',
          detail: '',
          retryable: true
        })
      } else {
        this.finish(job, result.status, result.output ?? null, null)
      }
    } catch (err) {
      if (aborter.signal.aborted) {
        this.finish(job, 'aborted', null, {
          error_code: 'cancelled',
          message: 'ジョブが中断されました',
          detail: err instanceof Error ? err.message : '',
          retryable: true
        })
      } else {
        this.finish(job, 'failed', null, toApiError(err))
      }
    } finally {
      this.aborters.delete(job.jobId)
    }
  }

  private finish(job: JobRecord, status: JobStatus, output: unknown, error: ApiError | null): void {
    job.status = status
    job.output = output
    job.error = error
    job.completedAt = new Date().toISOString()
    if (status === 'success') job.progress = 100
    this.writeLog(job.jobId, error ? 'error' : 'info', `ジョブ終了: ${status}`, error ?? undefined)
    this.notify(job)
  }

  private notify(job: JobRecord): void {
    this.bus.emit('job.updated', {
      jobId: job.jobId,
      type: job.type,
      status: job.status,
      progress: job.progress,
      message: job.message,
      error: job.error
    })
  }

  /** ジョブログ JSONL 追記（CORE-022、sdd_directory §2: logs/jobs/<job_uid>.jsonl） */
  private writeLog(jobId: string, level: string, message: string, data?: unknown): void {
    if (!this.logDir) return
    try {
      const path = join(this.logDir, `${jobId}.jsonl`)
      mkdirSync(dirname(path), { recursive: true })
      const line = JSON.stringify({
        ts: new Date().toISOString(),
        level,
        message,
        ...(data !== undefined ? { data } : {})
      })
      appendFileSync(path, `${line}\n`, 'utf-8')
    } catch {
      // ログ書込失敗でジョブ本体を失敗させない
    }
  }

  /** 完了済みの古いジョブをメモリから間引く */
  private trimJobs(): void {
    if (this.jobs.size <= MAX_RETAINED_JOBS) return
    for (const [id, job] of this.jobs) {
      if (this.jobs.size <= MAX_RETAINED_JOBS) break
      if (['success', 'failed', 'aborted', 'partial'].includes(job.status)) {
        this.jobs.delete(id)
      }
    }
  }
}
