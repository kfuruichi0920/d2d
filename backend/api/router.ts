import type { BackendRequest, BackendResponse } from '../../src/types/ipc'
import { BackendError, toApiError } from './errors'

export type ApiHandler = (params: unknown) => Promise<unknown> | unknown

/**
 * 操作単位 API のルーター。
 * メソッド名は「機能領域.操作」形式（例: 'app.ping', 'project.open'）とする。
 * 細かいレコード取得 API は登録しない（sdd_function_architecture §2）。
 */
export class ApiRouter {
  private readonly handlers = new Map<string, ApiHandler>()

  register(method: string, handler: ApiHandler): void {
    if (this.handlers.has(method)) {
      throw new Error(`API method already registered: ${method}`)
    }
    this.handlers.set(method, handler)
  }

  methods(): string[] {
    return [...this.handlers.keys()]
  }

  async dispatch(request: BackendRequest): Promise<BackendResponse> {
    const { id, method, params } = request
    try {
      if (typeof method !== 'string' || method.length === 0) {
        throw new BackendError('validation', 'method is required', 'BackendRequest.method が空です')
      }
      const handler = this.handlers.get(method)
      if (!handler) {
        throw new BackendError('not_found', `unknown API method: ${method}`)
      }
      const result = await handler(params)
      return { id, ok: true, result }
    } catch (err) {
      return { id, ok: false, error: toApiError(err) }
    }
  }
}
