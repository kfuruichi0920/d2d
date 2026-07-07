/**
 * Renderer → Main → Local Backend の薄い中継ハンドラ。
 * Main では業務処理を実装せず、メソッド名の形式検査と転送のみ行う。
 */
import { ipcMain, type WebContents } from 'electron'
import type { BackendProcessManager } from '../../backend/backend-process'

/** 操作単位 API のメソッド名形式（例: app.ping / project.open） */
const METHOD_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/

export function registerApiHandlers(backend: BackendProcessManager): void {
  ipcMain.handle('api:invoke', async (_event, method: unknown, params: unknown) => {
    if (typeof method !== 'string' || !METHOD_PATTERN.test(method)) {
      return {
        ok: false,
        error: {
          error_code: 'validation',
          message: '不正な API メソッド名です',
          detail: String(method),
          retryable: false
        }
      }
    }
    return backend.call(method, params)
  })
}

/** Backend イベントを Renderer へ転送する購読を設定する */
export function forwardBackendEvents(backend: BackendProcessManager, getTargets: () => WebContents[]): () => void {
  return backend.onEvent((event, payload) => {
    for (const wc of getTargets()) {
      if (!wc.isDestroyed()) {
        wc.send('api:event', event, payload)
      }
    }
  })
}
