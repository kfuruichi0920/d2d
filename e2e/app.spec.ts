import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * E2E: Workbench（P3）+ Backend 基盤（P0〜P2）の統合検証。
 */

let app: ElectronApplication
let page: Page
const projectRoot = join(tmpdir(), `d2d-e2e-p3-${Date.now()}`)

test.beforeAll(async () => {
  app = await electron.launch({ args: ['out/main/index.js'] })
  page = await app.firstWindow()
  await expect(page.getByTestId('workbench')).toBeVisible({ timeout: 15_000 })
})

test.afterAll(async () => {
  // アプリ終了後に一時プロジェクトを削除する（DB を掴んだまま消さない）
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
})

test('Workbench シェルが表示される（P3-1）', async () => {
  await expect(page.getByTestId('activity-bar')).toBeVisible()
  await expect(page.getByTestId('pipeline-navigator')).toBeVisible()
  await expect(page.getByTestId('status-bar')).toBeVisible()
  await expect(page.getByTestId('welcome-editor')).toBeVisible()

  // Activity 切替（Explorer → Jobs）
  await page.getByTestId('activity-jobs').click()
  await expect(page.getByTestId('primary-sidebar')).toContainText('Jobs')
  // 同じ Activity 再クリックで Side Bar が閉じる
  await page.getByTestId('activity-jobs').click()
  await expect(page.getByTestId('primary-sidebar')).toBeHidden()
  await page.getByTestId('activity-explorer').click()
})

test('コマンドパレットからテーマを切り替えられる（P3-2 / P3-3）', async () => {
  await page.keyboard.press('Control+Shift+P')
  await expect(page.getByTestId('command-palette')).toBeVisible()

  await page.getByTestId('palette-input').fill('カラーテーマ: asagi')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-panda-theme', 'asagi')

  // 表示モード light へ
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette-input').fill('表示モード: light')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-d2d-mode', 'light')

  // 戻す（konjo + dark → konjo-dark 変種）
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette-input').fill('表示モード: dark')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette-input').fill('カラーテーマ: konjo')
  await page.keyboard.press('Enter')
  await expect(page.locator('html')).toHaveAttribute('data-panda-theme', 'konjo-dark')
})

test('作業モード切替とレイアウトプリセット（P3-7）', async () => {
  await page.keyboard.press('Control+4') // M3: モデル化
  await expect(page.getByTestId('status-mode')).toContainText('M3')
  // M3 プリセットは Panel(LLM Logs) と Secondary(candidates) を開く
  await expect(page.getByTestId('panel')).toBeVisible()
  await expect(page.getByTestId('secondary-sidebar')).toBeVisible()

  await page.keyboard.press('Control+1') // M0
  await expect(page.getByTestId('status-mode')).toContainText('M0')
})

test('プロジェクト作成でタイトル・パイプラインが更新される（P1〜P3 連携）', async () => {
  const created = await page.evaluate(
    async ([root]) => await window.api.invoke('project.create', { rootPath: root, name: 'P3プロジェクト' }),
    [projectRoot]
  )
  expect(created).toMatchObject({ ok: true })

  // project.opened イベント → タイトル・ステータスバー・パイプライン件数へ反映
  await expect(page.getByTestId('title-project')).toContainText('P3プロジェクト')
  await expect(page.getByTestId('status-project')).toContainText('P3プロジェクト')
  await expect(page.getByTestId('stage-source')).toContainText('0')

  // ダッシュボードを開く
  await page.getByTestId('explorer-project-row').click()
  await expect(page.getByTestId('dashboard-editor')).toBeVisible()
  await expect(page.getByTestId('dashboard-editor')).toContainText('schema_version')
})

test('ジョブ実行が Jobs Panel と Status Bar に反映される（P3-5）', async () => {
  const enq = await page.evaluate(
    async () =>
      await window.api.invoke<{ jobId: string }>('job.enqueue', { type: 'worker.ping', params: { from: 'e2e' } })
  )
  expect(enq).toMatchObject({ ok: true })

  // Status Bar クリック → Jobs Panel 表示
  await page.getByTestId('status-jobs').click()
  await expect(page.getByTestId('panel')).toBeVisible()
  await expect(page.getByTestId('jobs-list')).toContainText('worker.ping')
  await expect(page.getByTestId('jobs-list').locator('.d2d-badge.status-success').first()).toBeVisible({
    timeout: 30_000
  })

  // ジョブログを開く（V-16）
  await page.getByRole('button', { name: 'ログ' }).first().click()
  await expect(page.getByTestId('job-log-editor')).toBeVisible()
  await expect(page.getByTestId('job-log-editor')).toContainText('ジョブ開始')
})

test('設定エディタで機密情報を暗号化保存できる（P2-2 UI）', async () => {
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette-input').fill('設定を開く')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('settings-editor')).toBeVisible()

  await page.getByTestId('secret-value-input').fill('sk-e2e-ui-secret')
  await page.getByTestId('secret-save').click()
  await expect(page.getByTestId('settings-editor')).toContainText('登録済み')

  // 後始末
  await page.getByRole('button', { name: '削除' }).first().click()
})

test('原本取込→Word抽出→レビュー→②正本確定の全経路（P4/P5）', async () => {
  // テスト用 docx を Python で生成
  const docxPath = join(tmpdir(), `d2d-e2e-spec-${Date.now()}.docx`)
  execFileSync(process.platform === 'win32' ? 'python' : 'python3', [
    join(process.cwd(), 'workers', 'python', 'tests', 'make_docx.py'),
    docxPath
  ])

  // 取込ジョブ（P4-1）: ダイアログを介さず API で開始し、UI 反映を検証する
  const imported = await page.evaluate(
    async ([path]) => await window.api.invoke<{ jobId: string }>('document.import', { filePath: path }),
    [docxPath]
  )
  expect(imported).toMatchObject({ ok: true })

  // Explorer ①原本ツリーへ出現（source.imported イベント）。
  // Activity 再クリックはトグルのため、非表示時のみクリックして Explorer を確実に開く
  if (
    !(await page
      .getByTestId('documents-tree')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('activity-explorer').click()
  }
  await expect(page.getByTestId('source-doc-DOC-000001')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('stage-source')).toContainText('1')

  // 原本ビュー（P4-2）から抽出ジョブを実行（P5）
  await page.getByTestId('source-doc-DOC-000001').click()
  await expect(page.getByTestId('original-viewer')).toBeVisible()
  await expect(page.getByTestId('original-viewer')).toContainText('SHA-256')
  await page.getByTestId('extract-button').click()

  // 抽出完了 → ②抽出データがツリーへ出現
  await expect(page.getByTestId('extracted-doc-EXDOC-000001')).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('stage-extracted')).toContainText('1')

  // 抽出レビュー Editor（P5-6）: 要素一覧 + Markdown 対照表示
  await page.getByTestId('extracted-doc-EXDOC-000001').click()
  await expect(page.getByTestId('extraction-review-editor')).toBeVisible()
  await expect(page.getByTestId('element-grid')).toContainText('1. 概要')
  await expect(page.getByTestId('element-grid')).toContainText('heading')
  await expect(page.getByTestId('review-markdown')).toContainText('1.1 対象範囲')
  await expect(page.getByTestId('review-markdown')).toContainText('100ms以内')

  // 採用確定 → ②正本化（extraction.completed）
  await page.getByTestId('approve-all-button').click()
  await expect(page.getByTestId('approve-all-button')).toContainText('正本確定済み')
  await expect(
    page.getByTestId('extraction-review-editor').locator('.d2d-badge.review-confirmed').first()
  ).toBeVisible()

  rmSync(docxPath, { force: true })
})

test('LLM 実行（モック Ollama）→ ログビューまでの全経路（P6）', async () => {
  // モック Ollama サーバを起動（Backend の fetch が接続する）
  const mock = createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          message: { content: 'モックLLM応答: OK' },
          prompt_eval_count: 15,
          eval_count: 5
        })
      )
    })
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const port = (mock.address() as { port: number }).port

  try {
    // Provider を ollama（ローカル扱い）+ モック endpoint に設定
    await page.evaluate(
      async ([endpoint]) => {
        await window.api.invoke('settings.set', { key: 'llm.provider', value: 'ollama' })
        await window.api.invoke('settings.set', { key: 'llm.ollama.endpoint', value: endpoint })
        await window.api.invoke('settings.set', { key: 'llm.ollama.model', value: 'mock-model' })
      },
      [`http://127.0.0.1:${port}`]
    )

    // 送信前確認（LLM-040）: preview はローカル・警告なしで送信内容を返す
    const preview = await page.evaluate(
      async () =>
        await window.api.invoke<{ external: boolean; maskedMessages: { content: string }[] }>('llm.preview', {
          messages: [{ role: 'user', content: 'テスト送信 sk-abcdefghijklmnop1234' }]
        })
    )
    expect(preview).toMatchObject({ ok: true, result: { external: false } })
    if (preview.ok) {
      expect(preview.result.maskedMessages[0]!.content).not.toContain('sk-abcdefghijklmnop1234')
    }

    // LLM 実行ジョブ → 完了待ち
    const run = await page.evaluate(async () => {
      const enq = await window.api.invoke<{ jobId: string }>('llm.run', {
        messages: [{ role: 'user', content: 'こんにちは' }],
        processName: 'e2e-test'
      })
      if (!enq.ok) return enq
      for (let i = 0; i < 60; i++) {
        const got = await window.api.invoke<{ status: string; output: { llmRunUid: string } }>('job.get', {
          jobId: enq.result.jobId
        })
        if (got.ok && ['success', 'failed', 'aborted'].includes(got.result.status)) return got
        await new Promise((r) => setTimeout(r, 250))
      }
      return { ok: false as const, error: { error_code: 'internal', message: 'timeout', detail: '', retryable: false } }
    })
    expect(run).toMatchObject({ ok: true, result: { status: 'success' } })

    // Panel の LLM Logs に実行が表示される（UI-018）
    await page.getByTestId('status-jobs').click()
    await page.getByTestId('panel-tab-llm').click()
    await expect(page.getByTestId('llm-logs-list')).toContainText('e2e-test')
    await expect(page.getByTestId('llm-logs-list')).toContainText('ollama/mock-model')
    await expect(page.getByTestId('llm-logs-list')).toContainText('in:15 out:5')

    // ログビューアで応答本文を確認（LLM-011/015）
    await page.getByTestId('llm-logs-list').locator('.d2d-list-row').first().click()
    await expect(page.getByTestId('llm-run-viewer')).toBeVisible()
    await expect(page.getByTestId('llm-result-text')).toContainText('モックLLM応答: OK')
  } finally {
    mock.close()
  }
})

test('スクリーンショットを保存する', async () => {
  await page.screenshot({ path: 'test-results/workbench.png' })
})
