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

/**
 * Backend → Main のブリッジ要求。
 * safeStorage 等、Electron Main 専用の OS 統合機能を Backend から利用するための逆方向 RPC。
 * Main は OS 統合のみを担い、業務ロジックは実装しない（sdd_function_architecture §2）。
 */
export interface MainBridgeRequest {
  bridgeId: number
  bridgeMethod: string
  bridgeParams: unknown
}

/** Main → Backend のブリッジ応答 */
export interface MainBridgeResponse {
  bridgeId: number
  ok: boolean
  result?: unknown
  error?: ApiError
}

export type BackendMessage = BackendResponse | BackendEvent | MainBridgeRequest

export function isBackendEvent(msg: BackendMessage): msg is BackendEvent {
  return typeof (msg as BackendEvent).event === 'string'
}

export function isMainBridgeRequest(msg: BackendMessage): msg is MainBridgeRequest {
  return (
    typeof (msg as MainBridgeRequest).bridgeId === 'number' &&
    typeof (msg as MainBridgeRequest).bridgeMethod === 'string'
  )
}

export function isMainBridgeResponse(msg: unknown): msg is MainBridgeResponse {
  const m = msg as MainBridgeResponse
  return typeof m === 'object' && m !== null && typeof m.bridgeId === 'number' && typeof m.ok === 'boolean'
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
