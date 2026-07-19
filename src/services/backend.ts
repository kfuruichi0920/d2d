/**
 * Backend API の薄い型付きラッパー（改善対応1: API呼び出しの型安全化）。
 * - メソッド名は `ApiMethod`（backend/api の登録と同期する union）で制約し、typo を排除する。
 * - `ApiContracts` 登録済みメソッドは params / result も型検査される。
 * 失敗（ok:false）はそのまま返し、表示側でエラー契約（sdd_function_architecture §2.3）を扱う。
 */
import type { ApiError, ApiResult } from '../types/ipc'
import type { ApiMethod } from '../types/api-methods'
import type { ApiContracts, ContractMethod } from '../types/api-contract'

type ContractParams<M extends ContractMethod> = ApiContracts[M]['params'] extends void
  ? []
  : [params: ApiContracts[M]['params']]

export async function invoke<M extends ContractMethod>(
  method: M,
  ...params: ContractParams<M>
): Promise<ApiResult<ApiContracts[M]['result']>>
export async function invoke<T = unknown>(method: ApiMethod, params?: unknown): Promise<ApiResult<T>>
export async function invoke(method: ApiMethod, params?: unknown): Promise<ApiResult<unknown>> {
  return window.api.invoke(method, params)
}

/** 結果が必要な呼び出し。失敗時は throw する（呼び出し側で catch して通知） */
export async function invokeOrThrow<M extends ContractMethod>(
  method: M,
  ...params: ContractParams<M>
): Promise<ApiContracts[M]['result']>
export async function invokeOrThrow<T = unknown>(method: ApiMethod, params?: unknown): Promise<T>
export async function invokeOrThrow(method: ApiMethod, params?: unknown): Promise<unknown> {
  const res = await window.api.invoke(method, params)
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
