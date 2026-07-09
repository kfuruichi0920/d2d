import { test, expect, _electron as electron } from '@playwright/test'

/**
 * E2E スモークテスト: アプリが起動し、Renderer → Main → Local Backend の
 * 疎通（app.ping）が画面に反映されることを確認する。
 */
test('アプリが起動し Local Backend と接続できる', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] })
  const window = await app.firstWindow()

  await expect(window.getByText('D2D — 設計情報デジタル化・トレーサビリティ支援ツール')).toBeVisible()
  await expect(window.getByText(/接続済み/)).toBeVisible({ timeout: 15_000 })

  await app.close()
})
