import type { ApiError, ApiErrorCode } from '../../src/types/ipc'

/** 基盤APIエラー契約（sdd_function_architecture §2.3）を運ぶ例外 */
export class BackendError extends Error {
  readonly errorCode: ApiErrorCode
  readonly detail: string
  readonly retryable: boolean

  constructor(errorCode: ApiErrorCode, message: string, detail = '', retryable = false) {
    super(message)
    this.name = 'BackendError'
    this.errorCode = errorCode
    this.detail = detail
    this.retryable = retryable
  }

  toApiError(): ApiError {
    return {
      error_code: this.errorCode,
      message: this.message,
      detail: this.detail,
      retryable: this.retryable
    }
  }
}

/** 任意の例外を基盤APIエラー契約へ変換する。分類不能なものは internal とする */
export function toApiError(err: unknown): ApiError {
  if (err instanceof BackendError) {
    return err.toApiError()
  }
  if (err instanceof Error) {
    return {
      error_code: 'internal',
      message: err.message,
      detail: err.stack ?? '',
      retryable: false
    }
  }
  return {
    error_code: 'internal',
    message: String(err),
    detail: '',
    retryable: false
  }
}
