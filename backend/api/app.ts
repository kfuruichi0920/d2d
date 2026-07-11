import type { PingResult } from '../../src/types/ipc'
import type { ApiRouter } from './router'

const startedAt = Date.now()

/** Backend 自身の状態確認系 API（接続監視・疎通確認用） */
export function registerAppApi(router: ApiRouter, backendVersion: string): void {
  router.register('app.ping', (): PingResult => {
    return {
      status: 'ok',
      pid: process.pid,
      backendVersion,
      schemaVersion: null, // P1（DBスキーマ）実装時に project.db から解決する
      uptimeMs: Date.now() - startedAt
    }
  })

  router.register('app.listMethods', () => router.methods())
}
