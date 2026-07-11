/**
 * Backend API の薄い型付きラッパー。
 * 失敗（ok:false）はそのまま返し、表示側でエラー契約（sdd_function_architecture §2.3）を扱う。
 */
import type { ApiError, ApiResult } from '../types/ipc'

export async function invoke<T>(method: string, params?: unknown): Promise<ApiResult<T>> {
  return window.api.invoke<T>(method, params)
}

/** 結果が必要な呼び出し。失敗時は throw する（呼び出し側で catch して通知） */
export async function invokeOrThrow<T>(method: string, params?: unknown): Promise<T> {
  const res = await window.api.invoke<T>(method, params)
  if (!res.ok) {
    throw new BackendApiError(res.error)
  }
  return res.result
}

export class BackendApiError extends Error {
  readonly apiError: ApiError
  constructor(apiError: ApiError) {
    super(`${apiError.error_code}: ${apiError.message}`)
    this.apiError = apiError
  }
}

export function onBackendEvent(listener: (event: string, payload: unknown) => void): () => void {
  return window.api.onEvent(listener)
}
