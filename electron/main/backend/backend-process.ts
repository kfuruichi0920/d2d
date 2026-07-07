/**
 * Local Backend プロセスの起動・停止・接続監視（P0-3）。
 * Main は Gateway として Backend への要求中継のみを行い、業務ロジックを持たない。
 */
import { utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'
import type { ApiError, ApiResult, BackendMessage, BackendRequest } from '../../../src/types/ipc'
import { isBackendEvent } from '../../../src/types/ipc'

const REQUEST_TIMEOUT_MS = 30_000
const MAX_RESTARTS = 3

interface Pending {
  resolve: (value: ApiResult<unknown>) => void
  timer: NodeJS.Timeout
}

export type BackendEventListener = (event: string, payload: unknown) => void

export class BackendProcessManager {
  private child: UtilityProcess | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly eventListeners = new Set<BackendEventListener>()
  private restartCount = 0
  private stopping = false
  private ready = false

  onEvent(listener: BackendEventListener): () => void {
    this.eventListeners.add(listener)
    return () => this.eventListeners.delete(listener)
  }

  isReady(): boolean {
    return this.ready
  }

  start(): void {
    if (this.child) return
    this.stopping = false
    // electron-vite が backend/index.ts を out/main/backend.js へビルドする
    const entry = join(__dirname, 'backend.js')
    const child = utilityProcess.fork(entry, [], {
      serviceName: 'd2d-local-backend',
      stdio: 'pipe'
    })
    this.child = child

    child.stdout?.on('data', (buf: Buffer) => console.log(buf.toString().trimEnd()))
    child.stderr?.on('data', (buf: Buffer) => console.error(buf.toString().trimEnd()))

    child.on('message', (raw: unknown) => this.handleMessage(raw as BackendMessage))

    child.on('exit', (code: number) => {
      this.child = null
      this.ready = false
      this.failAllPending({
        error_code: 'internal',
        message: 'Local Backend が終了しました',
        detail: `exit code=${code}`,
        retryable: true
      })
      if (!this.stopping) {
        if (this.restartCount < MAX_RESTARTS) {
          this.restartCount += 1
          console.error(
            `[main] Backend が異常終了（code=${code}）。再起動します (${this.restartCount}/${MAX_RESTARTS})`
          )
          this.start()
        } else {
          console.error('[main] Backend の再起動上限に達しました')
          this.emitEvent('backend.dead', { code })
        }
      }
    })
  }

  stop(): void {
    this.stopping = true
    this.ready = false
    this.failAllPending({
      error_code: 'cancelled',
      message: 'Local Backend を停止しました',
      detail: '',
      retryable: false
    })
    if (this.child) {
      this.child.kill()
      this.child = null
    }
  }

  /** Backend API を呼び出し、基盤APIエラー契約に従う結果を返す（例外は投げない） */
  call(method: string, params: unknown): Promise<ApiResult<unknown>> {
    const child = this.child
    if (!child) {
      return Promise.resolve({
        ok: false,
        error: {
          error_code: 'internal',
          message: 'Local Backend が起動していません',
          detail: '',
          retryable: true
        }
      })
    }
    const id = this.nextId++
    const request: BackendRequest = { id, method, params }
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve({
          ok: false,
          error: {
            error_code: 'internal',
            message: `Backend API がタイムアウトしました: ${method}`,
            detail: `timeout=${REQUEST_TIMEOUT_MS}ms`,
            retryable: true
          }
        })
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      child.postMessage(request)
    })
  }

  private handleMessage(msg: BackendMessage): void {
    if (isBackendEvent(msg)) {
      if (msg.event === 'backend.ready') {
        this.ready = true
        this.restartCount = 0
      }
      this.emitEvent(msg.event, msg.payload)
      return
    }
    const pending = this.pending.get(msg.id)
    if (!pending) return
    this.pending.delete(msg.id)
    clearTimeout(pending.timer)
    if (msg.ok) {
      pending.resolve({ ok: true, result: msg.result })
    } else {
      pending.resolve({
        ok: false,
        error:
          msg.error ??
          ({
            error_code: 'internal',
            message: 'unknown backend error',
            detail: '',
            retryable: false
          } satisfies ApiError)
      })
    }
  }

  private emitEvent(event: string, payload: unknown): void {
    for (const listener of this.eventListeners) {
      listener(event, payload)
    }
  }

  private failAllPending(error: ApiError): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.resolve({ ok: false, error })
    }
    this.pending.clear()
  }
}
