/**
 * 外部ワーカー基盤（P2-6、sdd_function_architecture §11、NFR-032）。
 * Python ワーカーをサブプロセスとして起動し、stdin へ 1 行 JSON を送り、
 * stdout の改行区切り JSON（progress / result / error）を受け取る。
 * APIキー実値は渡さず api_key_ref のみ渡す（§11.1）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { BackendError } from '../api/errors'
import { resolveWorkerLaunch } from '../runtime-paths'

export interface WorkerRequest {
  job_id: string
  project_uid: string
  worker_name: string
  command: string
  parameters: Record<string, unknown>
  auth?: { api_key_ref: string }
}

export interface WorkerProgress {
  type: 'progress'
  job_id: string
  percent: number
  message: string
}

export interface WorkerResult {
  type: 'result'
  job_id: string
  status: 'success' | 'failed' | 'partial'
  output?: unknown
  output_ref?: string
}

export interface WorkerErrorMessage {
  type: 'error'
  job_id: string
  error_code: string
  message: string
  detail?: string
}

export type WorkerMessage = WorkerProgress | WorkerResult | WorkerErrorMessage

export interface RunWorkerOptions {
  request: WorkerRequest
  onProgress?: (progress: WorkerProgress) => void
  signal?: AbortSignal
  timeoutMs?: number
  /** テスト用に Python エントリポイントを差し替える */
  workerEntryPath?: string
}

const DEFAULT_TIMEOUT_MS = 10 * 60_000

/** 実行する Python コマンドを解決する（sdd_tech_stack §5.2）。テスト用エントリ差替時に使用 */
export function resolvePythonCommand(): string {
  if (process.env.D2D_PYTHON) return process.env.D2D_PYTHON
  return process.platform === 'win32' ? 'python' : 'python3'
}

export function defaultWorkerEntry(): string {
  // 開発時: python workers/python/main.py
  // パッケージ済み: resources/workers/python/d2d-worker(.exe) を直接起動（P14-5、sdd_tech_stack §5.4）
  return resolveWorkerLaunch().entryPath
}

/**
 * ワーカーを 1 コマンド実行し、result を返す。
 * ワーカーの error 出力・異常終了は worker 分類の BackendError へ変換する（§2.3）。
 */
export function runWorker(options: RunWorkerOptions): Promise<WorkerResult> {
  // テストは .py エントリを差し替えて Python 実行、通常は環境に応じて python / d2d-worker.exe を解決
  const launch = options.workerEntryPath
    ? { command: resolvePythonCommand(), args: [options.workerEntryPath], entryPath: options.workerEntryPath }
    : resolveWorkerLaunch()
  if (!existsSync(launch.entryPath)) {
    return Promise.reject(new BackendError('worker', 'ワーカーエントリポイントが見つかりません', launch.entryPath))
  }

  return new Promise<WorkerResult>((resolve, reject) => {
    const child = spawn(launch.command, launch.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        // Windows の CP932 文字化け対策（sdd_tech_stack §5.3）
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1'
      }
    })

    let settled = false
    let stderrBuf = ''
    let lineBuf = ''
    let workerError: WorkerErrorMessage | null = null

    const timeout = setTimeout(() => {
      fail(
        new BackendError(
          'worker',
          'ワーカーがタイムアウトしました',
          `timeout=${options.timeoutMs ?? DEFAULT_TIMEOUT_MS}ms`,
          true
        )
      )
      child.kill()
    }, options.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    const onAbort = (): void => {
      fail(new BackendError('cancelled', 'ワーカー実行が中断されました', '', true))
      child.kill()
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })

    function cleanup(): void {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }

    function fail(err: BackendError): void {
      if (settled) return
      settled = true
      cleanup()
      reject(err)
    }

    function succeed(result: WorkerResult): void {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }

    child.on('error', (err) => {
      fail(new BackendError('worker', 'ワーカーの起動に失敗しました', err.message, false))
    })

    child.stderr.on('data', (buf: Buffer) => {
      stderrBuf += buf.toString('utf-8')
    })

    child.stdout.on('data', (buf: Buffer) => {
      lineBuf += buf.toString('utf-8')
      for (;;) {
        const nl = lineBuf.indexOf('\n')
        if (nl < 0) break
        const line = lineBuf.slice(0, nl).trim()
        lineBuf = lineBuf.slice(nl + 1)
        if (!line) continue
        handleLine(line)
      }
    })

    function handleLine(line: string): void {
      let msg: WorkerMessage
      try {
        msg = JSON.parse(line) as WorkerMessage
      } catch {
        // JSONL 以外の出力はログ扱いで無視する
        return
      }
      switch (msg.type) {
        case 'progress':
          options.onProgress?.(msg)
          return
        case 'result':
          succeed(msg)
          return
        case 'error':
          workerError = msg
          return
      }
    }

    child.on('close', (code) => {
      if (settled) return
      if (workerError) {
        fail(
          new BackendError(
            'worker',
            workerError.message,
            workerError.detail ?? `error_code=${workerError.error_code}`,
            true
          )
        )
      } else {
        fail(
          new BackendError(
            'worker',
            `ワーカーが結果を返さず終了しました (exit=${code})`,
            stderrBuf.slice(0, 2000),
            true
          )
        )
      }
    })

    // §11.1: リクエストを 1 行 JSON で送信する
    child.stdin.write(`${JSON.stringify(options.request)}\n`)
    child.stdin.end()
  })
}
