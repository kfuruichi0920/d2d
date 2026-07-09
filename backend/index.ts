/**
 * Local Backend エントリポイント。
 * Electron Main から utilityProcess.fork で別プロセスとして起動され、
 * process.parentPort（MessagePort）経由で BackendRequest / BackendResponse を交換する。
 *
 * Main は Gateway / Shell であり業務ロジックを持たない。DB・ファイルI/O・解析・
 * LLM 通信等の業務ロジックはすべて本プロセス側に実装する
 * （sdd_function_architecture §2「初期実装方針（2026-07確定）」）。
 */
import type { BackendRequest } from '../src/types/ipc'
import { ApiRouter } from './api/router'
import { registerAppApi } from './api/app'
import { registerProjectApi } from './api/project'

const BACKEND_VERSION = '0.1.0'

interface ParentPort {
  on(event: 'message', listener: (e: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

function getParentPort(): ParentPort {
  const port = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (!port) {
    // 単体起動（デバッグ）時は疎通確認だけして終了する
    console.error('[backend] parentPort がありません。utilityProcess.fork から起動してください。')
    process.exit(1)
  }
  return port
}

function isBackendRequest(data: unknown): data is BackendRequest {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return typeof d.id === 'number' && typeof d.method === 'string'
}

function main(): void {
  const router = new ApiRouter()
  registerAppApi(router, BACKEND_VERSION)
  registerProjectApi(router)

  const port = getParentPort()

  port.on('message', (e) => {
    const data = e.data
    if (!isBackendRequest(data)) {
      console.error('[backend] 不正なリクエストを無視しました:', JSON.stringify(data).slice(0, 200))
      return
    }
    void router.dispatch(data).then((response) => {
      port.postMessage(response)
    })
  })

  // 起動完了イベント（Main の接続監視が購読する）
  port.postMessage({ event: 'backend.ready', payload: { pid: process.pid, version: BACKEND_VERSION } })
  console.log(`[backend] started pid=${process.pid} version=${BACKEND_VERSION}`)
}

main()
