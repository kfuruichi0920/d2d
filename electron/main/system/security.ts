/**
 * Electron セキュリティ設定（P0-2、sdd_function_architecture §2.2）。
 * - CSP: ローカルリソースのみ許可し、リモートコンテンツの読込・実行を禁止する
 * - ナビゲーション: Renderer からの直接遷移を禁止し、外部リンクは shell.openExternal に限定する
 */
import { app, session, shell } from 'electron'

/** 本番用 CSP。ローカル（自己）リソースのみ許可する */
const PROD_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'", // React インラインstyle / デザイントークンCSS変数用
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ')

/** 開発時は Vite dev server（HMR の ws / inline）を許可する */
const DEV_CSP = [
  "default-src 'self' http://localhost:*",
  "script-src 'self' http://localhost:*",
  "style-src 'self' 'unsafe-inline' http://localhost:*",
  "img-src 'self' data: blob: http://localhost:*",
  "font-src 'self' data: http://localhost:*",
  "connect-src 'self' ws://localhost:* http://localhost:*",
  "object-src 'none'"
].join('; ')

export function applyCsp(isDev: boolean): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [isDev ? DEV_CSP : PROD_CSP]
      }
    })
  })
}

const ALLOWED_EXTERNAL_PROTOCOLS = new Set(['https:', 'http:'])

/** 全 WebContents に対しナビゲーション禁止・外部リンク制限を適用する */
export function hardenNavigation(): void {
  app.on('web-contents-created', (_event, contents) => {
    // 新規ウィンドウは開かせず、http(s) のみ OS 既定ブラウザへ委譲する
    contents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url)
        if (ALLOWED_EXTERNAL_PROTOCOLS.has(parsed.protocol)) {
          void shell.openExternal(url)
        }
      } catch {
        // 不正な URL は無視
      }
      return { action: 'deny' }
    })

    // Renderer からの直接ナビゲーションを禁止（dev server / ローカルファイル以外すべて拒否）
    contents.on('will-navigate', (event, url) => {
      const isLocal = url.startsWith('file://') || url.startsWith('http://localhost')
      if (!isLocal) {
        event.preventDefault()
      }
    })

    // webview タグは使用しない
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
    })
  })
}
