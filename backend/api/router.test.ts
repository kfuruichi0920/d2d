import { describe, expect, it } from 'vitest'
import { ApiRouter } from './router'
import { BackendError, toApiError } from './errors'

describe('ApiRouter', () => {
  it('登録済みメソッドへディスパッチし ok 応答を返す', async () => {
    const router = new ApiRouter()
    router.register('app.echo', (params) => ({ echoed: params }))

    const res = await router.dispatch({ id: 1, method: 'app.echo', params: { a: 1 } })
    expect(res).toEqual({ id: 1, ok: true, result: { echoed: { a: 1 } } })
  })

  it('未登録メソッドは not_found エラー契約で返す', async () => {
    const router = new ApiRouter()
    const res = await router.dispatch({ id: 2, method: 'no.such', params: undefined })
    expect(res.ok).toBe(false)
    expect(res.error?.error_code).toBe('not_found')
    expect(res.error?.retryable).toBe(false)
    expect(res.id).toBe(2)
  })

  it('ハンドラが BackendError を投げた場合、分類・retryable を保持する', async () => {
    const router = new ApiRouter()
    router.register('job.fail', () => {
      throw new BackendError('worker', '抽出ワーカーが失敗しました', 'exit code=1', true)
    })
    const res = await router.dispatch({ id: 3, method: 'job.fail', params: undefined })
    expect(res.ok).toBe(false)
    expect(res.error).toEqual({
      error_code: 'worker',
      message: '抽出ワーカーが失敗しました',
      detail: 'exit code=1',
      retryable: true
    })
  })

  it('ハンドラの一般例外は internal へ変換する', async () => {
    const router = new ApiRouter()
    router.register('app.boom', () => {
      throw new Error('boom')
    })
    const res = await router.dispatch({ id: 4, method: 'app.boom', params: undefined })
    expect(res.ok).toBe(false)
    expect(res.error?.error_code).toBe('internal')
    expect(res.error?.message).toBe('boom')
  })

  it('空メソッド名は validation エラーとする', async () => {
    const router = new ApiRouter()
    const res = await router.dispatch({ id: 5, method: '', params: undefined })
    expect(res.ok).toBe(false)
    expect(res.error?.error_code).toBe('validation')
  })

  it('同名メソッドの二重登録は拒否する', () => {
    const router = new ApiRouter()
    router.register('app.ping', () => 'a')
    expect(() => router.register('app.ping', () => 'b')).toThrow(/already registered/)
  })

  it('非同期ハンドラを await して返す', async () => {
    const router = new ApiRouter()
    router.register('app.async', async () => {
      return await Promise.resolve(42)
    })
    const res = await router.dispatch({ id: 6, method: 'app.async', params: undefined })
    expect(res).toMatchObject({ ok: true, result: 42 })
  })
})

describe('toApiError', () => {
  it('非 Error 値も internal 契約へ変換する', () => {
    expect(toApiError('oops')).toEqual({
      error_code: 'internal',
      message: 'oops',
      detail: '',
      retryable: false
    })
  })
})
