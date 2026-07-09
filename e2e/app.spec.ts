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

test('safeStorage 機密保存とワーカージョブが動作する（P2 疎通）', async () => {
  const app = await electron.launch({ args: ['out/main/index.js'] })
  const page = await app.firstWindow()
  await expect(page.getByText(/接続済み/)).toBeVisible({ timeout: 15_000 })

  // P2-2: safeStorage 経由の機密保存（値は Renderer へ返さない）
  const secretKey = `e2e_test_key_${Date.now()}`
  const secret = await page.evaluate(
    async ([key]) => {
      const saved = await window.api.invoke('settings.setSecret', { key, value: 'sk-e2e-secret' })
      const has = await window.api.invoke('settings.hasSecret', { key })
      const exported = await window.api.invoke('settings.export')
      await window.api.invoke('settings.deleteSecret', { key })
      return { saved, has, exportedJson: JSON.stringify(exported) }
    },
    [secretKey]
  )
  expect(secret.saved).toMatchObject({ ok: true })
  expect(secret.has).toMatchObject({ ok: true, result: true })
  expect(secret.exportedJson).not.toContain('sk-e2e-secret') // CORE-046: 機密除外

  // P2-3/P2-6: ワーカー疎通ジョブの実行と完了待ち
  const job = await page.evaluate(async () => {
    const enq = await window.api.invoke<{ jobId: string }>('job.enqueue', {
      type: 'worker.ping',
      params: { from: 'e2e' }
    })
    if (!enq.ok) return enq
    const jobId = enq.result.jobId
    for (let i = 0; i < 60; i++) {
      const got = await window.api.invoke<{ status: string; output: unknown }>('job.get', { jobId })
      if (got.ok && ['success', 'failed', 'partial', 'aborted'].includes(got.result.status)) return got
      await new Promise((r) => setTimeout(r, 500))
    }
    return { ok: false, error: { error_code: 'internal', message: 'job timeout', detail: '', retryable: false } }
  })
  expect(job).toMatchObject({ ok: true, result: { status: 'success' } })

  await app.close()
})
