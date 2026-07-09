import { describe, expect, it } from 'vitest'
import { runWorker, type WorkerProgress } from './worker-runner'

/**
 * 実 Python サブプロセスとの JSONL プロトコル結合テスト（P2-6）。
 * workers/python/main.py を起動して疎通を確認する。
 */
describe('runWorker（P2-6、実 Python 結合）', () => {
  it('worker.ping が progress と result を返す', async () => {
    const progresses: WorkerProgress[] = []
    const result = await runWorker({
      request: {
        job_id: 'test-job-1',
        project_uid: 'prj-1',
        worker_name: 'd2d-worker',
        command: 'worker.ping',
        parameters: { hello: '世界' }
      },
      onProgress: (p) => progresses.push(p),
      timeoutMs: 30_000
    })

    expect(result.status).toBe('success')
    expect((result.output as { echo: unknown }).echo).toEqual({ hello: '世界' })
    expect(progresses.length).toBeGreaterThanOrEqual(1)
    expect(progresses[0]!.job_id).toBe('test-job-1')
  }, 40_000)

  it('未知コマンドは worker 分類のエラー契約になる', async () => {
    await expect(
      runWorker({
        request: {
          job_id: 'test-job-2',
          project_uid: 'prj-1',
          worker_name: 'd2d-worker',
          command: 'no.such.command',
          parameters: {}
        },
        timeoutMs: 30_000
      })
    ).rejects.toMatchObject({ errorCode: 'worker' })
  }, 40_000)
})
