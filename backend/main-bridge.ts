/**
 * Backend → Main ブリッジ（P2-2）。
 * safeStorage 等の Electron Main 専用機能を parentPort 経由の逆方向 RPC で利用する。
 */
import type { MainBridgeRequest } from '../src/types/ipc'
import { isMainBridgeResponse } from '../src/types/ipc'
import { BackendError } from './api/errors'

interface PortLike {
  postMessage(message: unknown): void
}

const BRIDGE_TIMEOUT_MS = 10_000

let port: PortLike | null = null
let nextBridgeId = 1
const pending = new Map<
  number,
  { resolve: (v: unknown) => void; reject: (e: unknown) => void; timer: NodeJS.Timeout }
>()

/** backend/index.ts が起動時に呼ぶ */
export function initMainBridge(parentPort: PortLike): void {
  port = parentPort
}

/** parentPort の message ハンドラから呼ぶ。ブリッジ応答なら処理して true を返す */
export function handleBridgeMessage(data: unknown): boolean {
  if (!isMainBridgeResponse(data)) return false
  const entry = pending.get(data.bridgeId)
  if (!entry) return true
  pending.delete(data.bridgeId)
  clearTimeout(entry.timer)
  if (data.ok) {
    entry.resolve(data.result)
  } else {
    entry.reject(
      new BackendError(
        data.error?.error_code ?? 'internal',
        data.error?.message ?? 'main bridge error',
        data.error?.detail ?? '',
        data.error?.retryable ?? false
      )
    )
  }
  return true
}

export function callMain<T>(method: string, params?: unknown): Promise<T> {
  if (!port) {
    return Promise.reject(new BackendError('internal', 'Main ブリッジが初期化されていません', ''))
  }
  const bridgeId = nextBridgeId++
  const request: MainBridgeRequest = { bridgeId, bridgeMethod: method, bridgeParams: params ?? null }
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(bridgeId)
      reject(new BackendError('internal', `Main ブリッジがタイムアウトしました: ${method}`, '', true))
    }, BRIDGE_TIMEOUT_MS)
    pending.set(bridgeId, { resolve: resolve as (v: unknown) => void, reject, timer })
    port!.postMessage(request)
  })
}
