/**
 * Renderer ⇔ Main ⇔ Local Backend 間で共有する IPC / API 契約の型定義。
 * 基盤APIエラー契約は sdd_function_architecture.md §2.3 に従う。
 */

/** 基盤API共通エラー分類（sdd_function_architecture §2.3） */
export type ApiErrorCode =
  'validation' | 'not_found' | 'conflict' | 'io' | 'db' | 'worker' | 'llm' | 'cancelled' | 'internal'

/** 基盤API共通エラー応答 */
export interface ApiError {
  error_code: ApiErrorCode
  message: string
  detail: string
  retryable: boolean
}

/** Backend API 呼び出し結果のエンベロープ */
export type ApiResult<T> = { ok: true; result: T } | { ok: false; error: ApiError }

/** Main → Backend（utilityProcess MessagePort）のリクエスト */
export interface BackendRequest {
  id: number
  method: string
  params: unknown
}

/** Backend → Main のレスポンス */
export interface BackendResponse {
  id: number
  ok: boolean
  result?: unknown
  error?: ApiError
}

/** Backend → Main のイベント（購読通知。id を持たない push 型） */
export interface BackendEvent {
  event: string
  payload: unknown
}

export type BackendMessage = BackendResponse | BackendEvent

export function isBackendEvent(msg: BackendMessage): msg is BackendEvent {
  return typeof (msg as BackendEvent).event === 'string'
}

/** app.ping の応答 */
export interface PingResult {
  status: 'ok'
  pid: number
  backendVersion: string
  schemaVersion: string | null
  uptimeMs: number
}

/** Renderer に公開する window.api の形（preload の contextBridge と一致させる） */
export interface RendererApi {
  /** Backend API を操作単位メソッド名で呼び出す（例: 'app.ping'） */
  invoke<T = unknown>(method: string, params?: unknown): Promise<ApiResult<T>>
  /** Backend / Main が発行するイベントの購読。解除関数を返す */
  onEvent(listener: (event: string, payload: unknown) => void): () => void
  /** Main（OS統合）側の情報取得 */
  getVersions(): Promise<{ app: string; electron: string; chrome: string; node: string }>
}

declare global {
  interface Window {
    api: RendererApi
  }
}
