import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventBus } from '../events/event-bus'
import { JobManager, type JobRecord } from './job-manager'
import { BackendError } from '../api/errors'

function waitForStatus(jobs: JobManager, jobId: string, statuses: string[], timeoutMs = 5000): Promise<JobRecord> {
  return vi.waitFor(
    () => {
      const job = jobs.get(jobId)
      if (!statuses.includes(job.status)) throw new Error(`status=${job.status}`)
      return job
    },
    { timeout: timeoutMs }
  )
}

describe('JobManager（P2-3）', () => {
  let dir: string
  let bus: EventBus
  let jobs: JobManager
  let events: { event: string; payload: unknown }[]

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-job-'))
    bus = new EventBus()
    events = []
    bus.onAny((event, payload) => events.push({ event, payload }))
    jobs = new JobManager(bus)
    jobs.setLogDir(dir)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('成功ジョブ: waiting→running→success、進捗・イベント・JSONLログを出す', async () => {
    jobs.registerExecutor('test.ok', async (_params, ctx) => {
      ctx.reportProgress(30, '前半')
      ctx.log('info', '中間ログ', { step: 1 })
      ctx.reportProgress(80, '後半')
      return { status: 'success', output: { answer: 42 } }
    })

    const job = jobs.enqueue('test.ok', { input: 'x' })
    expect(job.status).toBe('waiting')

    const done = await waitForStatus(jobs, job.jobId, ['success'])
    expect(done.progress).toBe(100)
    expect(done.output).toEqual({ answer: 42 })

    // job.updated イベントが状態遷移を通知している（CORE-030〜032 / UI-009）
    const updates = events.filter((e) => e.event === 'job.updated').map((e) => (e.payload as { status: string }).status)
    expect(updates).toContain('waiting')
    expect(updates).toContain('running')
    expect(updates).toContain('success')

    // JSONL ログ（CORE-022）
    const logFiles = readdirSync(dir)
    expect(logFiles).toContain(`${job.jobId}.jsonl`)
    const lines = readFileSync(join(dir, `${job.jobId}.jsonl`), 'utf-8')
      .trim()
      .split('\n')
    expect(lines.length).toBeGreaterThanOrEqual(3)
    expect(JSON.parse(lines[0]!)).toMatchObject({ level: 'info' })
  })

  it('失敗ジョブ: エラー契約を保持し、retryable なら再実行できる（CORE-024）', async () => {
    let attempt = 0
    jobs.registerExecutor('test.flaky', async () => {
      attempt++
      if (attempt === 1) {
        throw new BackendError('worker', '一時的に失敗', '', true)
      }
      return { status: 'success', output: { attempt } }
    })

    const job = jobs.enqueue('test.flaky', {})
    const failed = await waitForStatus(jobs, job.jobId, ['failed'])
    expect(failed.error).toMatchObject({ error_code: 'worker', retryable: true })

    const retried = jobs.retry(job.jobId)
    expect(retried.retryOfJobId).toBe(job.jobId)
    const done = await waitForStatus(jobs, retried.jobId, ['success'])
    expect(done.output).toEqual({ attempt: 2 })
  })

  it('retryable=false のジョブは再実行を拒否する', async () => {
    jobs.registerExecutor('test.fatal', async () => {
      throw new BackendError('validation', '入力不正', '', false)
    })
    const job = jobs.enqueue('test.fatal', {})
    await waitForStatus(jobs, job.jobId, ['failed'])
    expect(() => jobs.retry(job.jobId)).toThrowError(/再実行不可/)
  })

  it('部分完了（partial）を扱える（CORE-021）', async () => {
    jobs.registerExecutor('test.partial', async () => ({ status: 'partial', output: { done: 3, failed: 1 } }))
    const job = jobs.enqueue('test.partial', {})
    const done = await waitForStatus(jobs, job.jobId, ['partial'])
    expect(done.output).toEqual({ done: 3, failed: 1 })
    // partial は再実行対象（CORE-021）
    expect(() => jobs.retry(job.jobId)).not.toThrow()
  })

  it('実行中ジョブの協調キャンセルで aborted になる', async () => {
    jobs.registerExecutor('test.slow', async (_params, ctx) => {
      for (let i = 0; i < 100; i++) {
        if (ctx.signal.aborted) throw new Error('aborted')
        await new Promise((r) => setTimeout(r, 20))
      }
      return { status: 'success' }
    })
    const job = jobs.enqueue('test.slow', {})
    await waitForStatus(jobs, job.jobId, ['running'])
    jobs.cancel(job.jobId)
    const done = await waitForStatus(jobs, job.jobId, ['aborted'])
    expect(done.error?.error_code).toBe('cancelled')
  })

  it('待機中ジョブのキャンセルは即 aborted になる', async () => {
    jobs.registerExecutor('test.block', async () => {
      await new Promise((r) => setTimeout(r, 300))
      return { status: 'success' }
    })
    jobs.registerExecutor('test.queued', async () => ({ status: 'success' }))

    const blocker = jobs.enqueue('test.block', {})
    const queued = jobs.enqueue('test.queued', {})
    jobs.cancel(queued.jobId)
    expect(jobs.get(queued.jobId).status).toBe('aborted')
    await waitForStatus(jobs, blocker.jobId, ['success'])
  })

  it('未登録ジョブ種別は validation エラー', () => {
    expect(() => jobs.enqueue('no.such', {})).toThrowError(/未登録のジョブ種別/)
  })
})
