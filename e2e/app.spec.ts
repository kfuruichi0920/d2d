import { test, expect, _electron as electron } from '@playwright/test'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

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

test('Backend でプロジェクトを作成・オープンできる（P1 疎通）', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] })
  const page = await app.firstWindow()
  await expect(page.getByText(/接続済み/)).toBeVisible({ timeout: 15_000 })

  const rootPath = join(tmpdir(), `d2d-e2e-${Date.now()}`)
  const created = await page.evaluate(
    async ([root]) => await window.api.invoke('project.create', { rootPath: root, name: 'E2Eプロジェクト' }),
    [rootPath]
  )
  expect(created).toMatchObject({
    ok: true,
    result: { name: 'E2Eプロジェクト', schemaVersion: '1.0.0', code: 'PRJ-000001' }
  })

  const reopened = await page.evaluate(
    async ([root]) => {
      await window.api.invoke('project.close')
      return await window.api.invoke('project.open', { path: root })
    },
    [rootPath]
  )
  expect(reopened).toMatchObject({ ok: true, result: { name: 'E2Eプロジェクト' } })

  await app.close()
  rmSync(rootPath, { recursive: true, force: true })
})
