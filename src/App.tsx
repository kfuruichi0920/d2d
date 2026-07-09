import { useEffect, useState } from 'react'
import type { PingResult } from './types/ipc'

interface Versions {
  app: string
  electron: string
  chrome: string
  node: string
}

/**
 * P0 時点の疎通確認画面。
 * Renderer → Main IPC → Local Backend の経路が機能していることを表示する。
 * P3 で Workbench Shell に置き換える。
 */
export function App(): React.JSX.Element {
  const [ping, setPing] = useState<PingResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [versions, setVersions] = useState<Versions | null>(null)

  useEffect(() => {
    let cancelled = false

    async function load(): Promise<void> {
      try {
        const [pingResult, v] = await Promise.all([window.api.invoke<PingResult>('app.ping'), window.api.getVersions()])
        if (cancelled) return
        setVersions(v)
        if (pingResult.ok) {
          setPing(pingResult.result)
          setError(null)
        } else {
          setPing(null)
          setError(`${pingResult.error.error_code}: ${pingResult.error.message}`)
        }
      } catch (e) {
        if (cancelled) return
        setPing(null)
        setError(e instanceof Error ? e.message : String(e))
      }
    }

    void load()
    const unsubscribe = window.api.onEvent((event) => {
      if (event === 'backend.ready') void load()
    })
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  return (
    <main style={{ padding: 24 }}>
      <h1 style={{ fontSize: 18, fontWeight: 600 }}>D2D — 設計情報デジタル化・トレーサビリティ支援ツール</h1>
      <section style={{ marginTop: 16, border: '1px solid var(--d2d-border)', borderRadius: 4, padding: 16 }}>
        <h2 style={{ fontSize: 14, marginTop: 0 }}>Local Backend 接続状態</h2>
        {ping ? (
          <p style={{ color: 'var(--d2d-ok)' }}>
            接続済み — pid: <code>{ping.pid}</code> / backend v{ping.backendVersion} / uptime{' '}
            {Math.round(ping.uptimeMs / 1000)}s
          </p>
        ) : error ? (
          <p style={{ color: 'var(--d2d-error)' }}>接続エラー — {error}</p>
        ) : (
          <p>接続確認中…</p>
        )}
        {versions && (
          <p style={{ opacity: 0.7 }}>
            app v{versions.app} / Electron {versions.electron} / Chrome {versions.chrome} / Node {versions.node}
          </p>
        )}
      </section>
    </main>
  )
}
