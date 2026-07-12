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
  await expect
    .poll(async () => page.evaluate(async () => window.api.invoke('settings.get', { key: 'theme.displayMode' })))
    .toMatchObject({ ok: true, result: 'dark' })
  await expect
    .poll(async () => page.evaluate(async () => window.api.invoke('settings.get', { key: 'theme.colorTheme' })))
    .toMatchObject({ ok: true, result: 'konjo' })
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
  const secretRow = page.getByTestId('secret-row-openai_api_key')
  await secretRow.getByRole('button', { name: '表示' }).click()
  await expect(secretRow.getByTestId('secret-revealed-openai_api_key')).toHaveValue('sk-e2e-ui-secret')
  await secretRow.getByRole('button', { name: '隠す' }).click()
  await expect(secretRow.getByTestId('secret-revealed-openai_api_key')).toHaveCount(0)

  // 後始末
  await secretRow.getByRole('button', { name: '削除' }).click()
})

test('設定エディタでPlantUMLレンダリング設定を保存・解除できる（P2-2 / P10-3 UI）', async () => {
  // 直前の設定テストで開いたエディタを再利用し、同一 Resource の重複オープンを避ける。
  const settings = page.locator('[data-testid="settings-editor"]:visible')
  await expect(settings).toHaveCount(1)
  await expect(settings.getByTestId('app-settings-storage-notice')).toContainText('アプリ全体設定')
  await expect(settings.getByTestId('app-settings-storage-notice')).toContainText(
    'プロジェクト未読込でも保存・利用できます'
  )
  await expect(settings.getByTestId('app-settings-storage-path')).toContainText('settings.json')
  await expect(settings.getByTestId('app-secrets-storage-path')).toContainText('secrets.json')

  await settings.getByTestId('setting-plantuml-jar-path').fill('C:/tools/plantuml.jar')
  await settings.getByTestId('setting-plantuml-java-path').fill('C:/tools/java.exe')
  await settings.getByTestId('setting-plantuml-save').click()
  await expect(page.getByTestId('notifications')).toContainText('PlantUML レンダリング設定を保存しました')

  const jarSetting = await page.evaluate(async () =>
    window.api.invoke<string>('settings.get', { key: 'plantuml.jarPath' })
  )
  const javaSetting = await page.evaluate(async () =>
    window.api.invoke<string>('settings.get', { key: 'plantuml.javaPath' })
  )
  expect(jarSetting).toMatchObject({ ok: true, result: 'C:/tools/plantuml.jar' })
  expect(javaSetting).toMatchObject({ ok: true, result: 'C:/tools/java.exe' })

  // 後続の PlantUML 未設定時テストへ影響を残さない。
  await page.getByTestId('setting-plantuml-jar-path').fill('')
  await page.getByTestId('setting-plantuml-java-path').fill('')
  await page.getByTestId('setting-plantuml-save').click()
  await expect(page.getByTestId('notifications')).toContainText('PlantUML 設定を解除しました')
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

  // 抽出レビュー Editor（P5-6）: 共通要素一覧 + 構造プレビュー + Selection/Properties
  await page.getByTestId('stage-extracted').click()
  await page.getByTestId('extracted-doc-EXDOC-000001').click()
  await expect(page.getByTestId('extraction-review-editor')).toBeVisible()
  const elementGrid = page.getByTestId('element-grid')
  const rows = elementGrid.locator('tbody tr.d2d-grid-row')
  await expect(elementGrid).toContainText('1. 概要')
  await expect(elementGrid).toContainText('見出し')
  await expect(page.getByTestId('review-markdown')).toContainText('1.1 対象範囲')
  await expect(page.getByTestId('review-markdown')).toContainText('100ms以内')
  await expect(page.getByTestId('review-markdown').getByRole('img')).toBeVisible()
  await expect(page.getByTestId('preview-item-e1')).toHaveClass(/selected/)

  // キーボード選択: ↓で次要素へ移動し、プレビューとPropertiesを同期する。
  await rows.first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('preview-item-e2')).toHaveClass(/active/)
  await expect(page.getByTestId('extracted-item-properties')).toContainText('e2')
  await expect(page.getByTestId('extracted-item-properties')).toContainText('paragraph')

  // Ctrlで非連続複数選択し、選択中要素だけを一括で要修正にする。
  await rows.nth(3).click({ modifiers: ['Control'] })
  await expect(page.getByTestId('extraction-review-editor')).toContainText('2 選択')
  await page.getByTestId('selected-needsfix').click()
  await expect(rows.nth(1).locator('.review-needsfix')).toBeVisible()
  await expect(rows.nth(3).locator('.review-needsfix')).toBeVisible()

  // Shiftで連続範囲を選択できる。
  await rows.nth(5).click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('extraction-review-editor')).toContainText('3 選択')

  // 状態セルはクリックごとにサイクリック更新する（未確認→確認済）。
  await page.getByTestId('cycle-status-e1').click()
  await expect(rows.first().locator('.review-confirmed')).toBeVisible()

  // 採用確定 → ②正本化（extraction.completed）
  await page.getByTestId('approve-all-button').click()
  await expect(page.getByTestId('approve-all-button')).toContainText('正本確定済み')
  await expect(
    page.getByTestId('extraction-review-editor').locator('.d2d-badge.review-confirmed').first()
  ).toBeVisible()

  rmSync(docxPath, { force: true })
})

test('②→③統合・編集・確定（P7）', async () => {
  // プロジェクト設定でフェーズ・成果物を定義する
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette-input').fill('プロジェクト設定を開く')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('project-settings-editor')).toBeVisible()
  await page.getByTestId('artifact-name').fill('統合設計書')
  await page.getByTestId('artifact-type').fill('design_doc')
  await page.getByTestId('artifact-add').click()
  await page.getByTestId('phase-name').fill('詳細設計')
  await page.getByTestId('phase-id').fill('DD')
  await page.getByTestId('phase-add').click()

  // Explorer のフェーズ→成果物「取込」で統合元②を選択する
  await expect(page.getByTestId('artifact-slot-DD-design_doc')).toBeVisible()
  await page.getByTestId('artifact-slot-DD-design_doc').getByRole('button', { name: '取込' }).click()
  await page.getByTestId('intermediate-source-dialog').getByRole('checkbox').check()
  await page.getByTestId('intermediate-source-dialog').getByRole('button', { name: '選択して取込' }).click()
  await expect(page.getByTestId('intermediate-doc-IMDOC-000001')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('stage-intermediate')).toContainText('1')

  // Intermediate Document Editor を開く
  await page.getByTestId('intermediate-doc-IMDOC-000001').click()
  await expect(page.getByTestId('intermediate-editor')).toBeVisible()
  await expect(page.getByTestId('intermediate-editor')).toContainText('design_doc / DD')
  // 空の成果物へ統合元要素を明示統合する
  const sourceGrid = page.getByTestId('intermediate-source-grid')
  await sourceGrid.getByRole('row').nth(1).click()
  await sourceGrid
    .getByRole('row')
    .last()
    .click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: '選択②を最初に統合' }).click()
  await expect(page.getByTestId('intermediate-grid')).toContainText('1. 概要')
  await expect(page.getByTestId('intermediate-markdown')).toContainText('対象項目その1')

  // 要素編集（新ID割当・由来追跡）: 段落を選択して編集
  await page.getByTestId('intermediate-grid').getByText('本書はテスト用の仕様書である。要求REQ-001を含む。').click()
  await page.getByTestId('element-toolbar').getByRole('button', { name: '編集', exact: true }).click()
  await page.getByTestId('edit-textarea').fill('本書はテスト用の仕様書である。要求REQ-001および要求REQ-002を含む。')
  await page.getByTestId('edit-save').click()
  await expect(page.getByTestId('intermediate-markdown')).toContainText('REQ-002')

  // ③正本確定 → intermediate.updated
  await page.getByTestId('intermediate-approve').click()
  await expect(page.getByTestId('intermediate-approve')).toContainText('正本確定済み')
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

    // ③要素の LLM 正規化候補 → 採用で③へ反映（P7-4/P7-6、MID-026/027）
    const adopted = await page.evaluate(async () => {
      const mids = await window.api.invoke<{ uid: string }[]>('intermediate.list')
      if (!mids.ok || mids.result.length === 0) return { ok: false as const, step: 'list' }
      const midUid = mids.result[0]!.uid
      const enq = await window.api.invoke<{ jobId: string }>('intermediate.generateTextCandidate', {
        uid: midUid,
        elementId: 'i2',
        purpose: 'normalize'
      })
      if (!enq.ok) return { ok: false as const, step: 'enqueue', error: enq.error.message }
      for (let i = 0; i < 60; i++) {
        const got = await window.api.invoke<{
          status: string
          output: { llmRunUid: string; candidateText: string }
        }>('job.get', { jobId: enq.result.jobId })
        if (got.ok && got.result.status === 'success') {
          const adopt = await window.api.invoke('intermediate.adoptTextCandidate', {
            uid: midUid,
            elementId: 'i2',
            newText: got.result.output.candidateText,
            llmRunUid: got.result.output.llmRunUid
          })
          const md = await window.api.invoke<{ markdown: string }>('intermediate.getMarkdown', {
            uid: midUid,
            variant: 'clean'
          })
          return {
            ok: adopt.ok && md.ok,
            step: 'done',
            candidate: got.result.output.candidateText,
            markdown: md.ok ? md.result.markdown : ''
          }
        }
        if (got.ok && ['failed', 'aborted'].includes(got.result.status)) {
          return { ok: false as const, step: 'job-failed' }
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      return { ok: false as const, step: 'timeout' }
    })
    expect(adopted).toMatchObject({ ok: true, candidate: 'モックLLM応答: OK' })
    expect((adopted as { markdown: string }).markdown).toContain('モックLLM応答: OK')
  } finally {
    mock.close()
  }
})

test('③→④候補生成→候補レビュー→採用の全経路（P8）', async () => {
  // 設計候補 JSON を返すモック LLM サーバ
  const candidateJson = JSON.stringify({
    elements: [
      { temp_id: 't1', category: 'REQ', title: '応答時間要求', description: '100ms以内', evidence: '100ms以内' },
      { temp_id: 't2', category: 'FUNC', title: '応答処理機能' }
    ],
    relations: [{ from_temp_id: 't2', to_temp_id: 't1', relation_type: 'satisfies', rationale: '機能が要求を満たす' }],
    warnings: []
  })
  const mock = createServer((req, res) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ message: { content: candidateJson }, prompt_eval_count: 100, eval_count: 50 }))
    })
  })
  await new Promise<void>((resolve) => mock.listen(0, '127.0.0.1', resolve))
  const port = (mock.address() as { port: number }).port

  try {
    await page.evaluate(
      async ([endpoint]) => {
        await window.api.invoke('settings.set', { key: 'llm.ollama.endpoint', value: endpoint })
      },
      [`http://127.0.0.1:${port}`]
    )

    // ③エディタから「④モデル候補を生成」→ 候補セットレビュー Editor が開く
    if (
      !(await page
        .getByTestId('documents-tree')
        .isVisible()
        .catch(() => false))
    ) {
      await page.getByTestId('activity-explorer').click()
    }
    await page.getByTestId('intermediate-doc-IMDOC-000001').click()
    await expect(page.getByTestId('intermediate-editor')).toBeVisible()
    await page.getByTestId('generate-design-candidates').click()
    await expect(page.getByTestId('candidate-editor')).toBeVisible({ timeout: 60_000 })

    // 候補が表形式で表示され、要素名変更が関係 From/To 表示へ追従する（MODEL-008）
    await expect(page.getByTestId('element-title-t1')).toHaveValue('応答時間要求')
    await expect(page.getByTestId('relation-row-0')).toContainText('t1: 応答時間要求')
    await page.getByTestId('element-title-t1').fill('応答時間要求（改）')
    await expect(page.getByTestId('relation-row-0')).toContainText('t1: 応答時間要求（改）')

    // 採用 → ④正本反映（同一トランザクション）→ ④ツリー・パイプライン件数へ反映
    await page.getByTestId('candidate-adopt-all').click()
    await expect(page.getByTestId('stage-design')).toContainText('2', { timeout: 15_000 })
    await expect(page.getByTestId('design-el-REQ-000001')).toBeVisible()
    await expect(page.getByTestId('design-el-FUNC-000001')).toBeVisible()

    // 設計要素ビューアで関係と根拠を確認（UI-013）
    await page.getByTestId('design-el-FUNC-000001').click()
    await expect(page.getByTestId('design-element-viewer')).toBeVisible()
    await expect(page.getByTestId('design-element-viewer')).toContainText('satisfies')
    await expect(page.getByTestId('design-element-viewer')).toContainText('応答時間要求（改）')
    await expect(page.getByTestId('design-element-viewer')).toContainText('based_on')
  } finally {
    mock.close()
  }
})

test('トレースクエリ→グラフ→マトリクス→整合性検査（P9）', async () => {
  // Trace Activity のクエリフォームから実行（P8 で採用した REQ/FUNC + satisfies が対象）
  await page.getByTestId('activity-trace').click()
  await expect(page.getByTestId('trace-sidebar')).toBeVisible()
  await page.getByTestId('trace-run').click()

  // 関係グラフ（SVG）: 起点 + 関係先ノードとホップ強調スライダー（TRACE-025）
  await expect(page.getByTestId('trace-graph')).toBeVisible()
  await expect(page.getByTestId('graph-node-REQ-000001')).toBeVisible()
  await expect(page.getByTestId('graph-node-FUNC-000001')).toBeVisible()
  await expect(page.getByTestId('trace-graph')).toContainText('satisfies')
  await expect(page.getByTestId('hop-slider')).toBeVisible()

  // グラフノードクリック → 設計要素ビューアへジャンプ（SEARCH-003 相当の導線）
  await page.getByTestId('graph-node-FUNC-000001').click()
  await expect(page.getByTestId('design-element-viewer')).toBeVisible()

  // トレースマトリクス（UI-014）: FUNC×REQ に ● が入る
  await page.getByTestId('open-matrix').click()
  await expect(page.getByTestId('trace-matrix')).toBeVisible()
  await expect(page.getByTestId('trace-matrix')).toContainText('FUNC-000001')
  await expect(page.getByTestId('trace-matrix').locator('td', { hasText: '●' }).first()).toBeVisible()

  // 根拠チェーン（UI-015）: ④要素 → ③中間文書
  await page.getByTestId('open-basis-chain').click()
  await expect(page.getByTestId('basis-chain')).toBeVisible()
  await expect(page.getByTestId('basis-chain')).toContainText('IMDOC-000001')

  // 整合性検査（Problems Panel）: REQ-000001 は verifies 未対応として検出される
  // Status Bar クリックで Panel を確実に開く（Ctrl+@ はトグルのため）
  await page.getByTestId('status-jobs').click()
  await page.getByTestId('panel-tab-problems').click()
  await expect(page.getByTestId('problems-list')).toContainText('検証未対応')
  await expect(page.getByTestId('problems-list')).toContainText('REQ-000001')

  // クエリ結果のエクスポート（TRACE-024）
  if (
    !(await page
      .getByTestId('trace-sidebar')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('activity-trace').click()
  }
  await page.getByTestId('trace-sidebar').getByRole('button', { name: 'markdown' }).click()
  await expect(page.getByTestId('notifications')).toContainText('クエリ結果を出力しました')
})

test('編集機能: 用語集・状態遷移・表編集・検証編集（P10）', async () => {
  if (
    !(await page
      .getByTestId('documents-tree')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('activity-explorer').click()
  }

  // --- 用語集（P10-6）: 登録→承認→③ Markdown でハイライト（EDIT-050/054/056） ---
  await page.getByTestId('open-glossary').click()
  await expect(page.getByTestId('glossary-editor')).toBeVisible()
  await page.getByTestId('glossary-term-input').fill('対象項目')
  await page.getByTestId('glossary-def-input').fill('検討の対象とする項目')
  await page.getByTestId('glossary-add').click()
  await expect(page.getByTestId('glossary-term-GLOSS-000001')).toBeVisible()
  await page.getByTestId('approve-GLOSS-000001').click()

  // ③から候補抽出（EDIT-051/055）
  await page.getByTestId('glossary-extract').click()
  await expect(page.getByTestId('glossary-candidates')).toBeVisible()

  // ③ Markdown プレビューに用語ハイライトが出る
  await page.getByTestId('intermediate-doc-IMDOC-000001').click()
  await expect(page.getByTestId('intermediate-editor')).toBeVisible()
  await expect(page.getByTestId('intermediate-markdown').locator('mark.d2d-term').first()).toHaveText('対象項目')

  // --- 表編集（P10-2）: セル修正→保存→Markdown へ反映（EDIT-022） ---
  await page.getByTestId('intermediate-grid').getByText('table', { exact: true }).click()
  await page.getByTestId('edit-table-button').click()
  await expect(page.getByTestId('table-cell-editor')).toBeVisible()
  await page.getByTestId('cell-1-1').fill('150ms以内')
  await page.getByTestId('table-save').click()
  await expect(page.getByTestId('intermediate-markdown')).toContainText('150ms以内')

  // --- 状態遷移（P10-4）: 作成→状態/イベント/遷移追加→検出→シミュレーション ---
  await page.getByTestId('add-state-machine').click()
  await expect(page.getByTestId('state-machine-editor')).toBeVisible()
  await page.getByTestId('new-state-input').fill('運転')
  await page.getByTestId('add-state').click()
  // 追加直後は遷移が無いので未到達として検出される（EDIT-035）
  await expect(page.getByTestId('state-problems')).toContainText('到達できない状態です: 運転')

  await page.getByTestId('new-event-input').fill('start')
  await page.getByTestId('add-event').click()
  await page.getByTestId('tr-from').selectOption('初期状態')
  await page.getByTestId('tr-event').selectOption('start')
  await page.getByTestId('tr-to').selectOption('運転')
  await page.getByTestId('add-transition').click()
  await expect(page.getByTestId('state-diagram')).toBeVisible()

  // 簡易シミュレーション（EDIT-034）
  await page.getByTestId('sim-input').fill('start')
  await page.getByTestId('sim-run').click()
  await expect(page.getByTestId('sim-result')).toContainText('最終状態: 運転')

  // --- 検証編集（P10-5）: REQ に検証項目を紐づけ → 検証未対応の解消（EDIT-040/041） ---
  await page.getByTestId('design-el-REQ-000001').click()
  await expect(page.getByTestId('design-element-viewer')).toBeVisible()
  await page.getByTestId('create-verification').click()
  await expect(page.getByTestId('design-element-viewer')).toContainText('verifies')

  // VERIF の検証詳細（EDIT-042）
  await page.getByTestId('design-el-VERIF-000001').click()
  await expect(page.getByTestId('verification-form')).toBeVisible()
  await page.getByTestId('verif-condition').fill('通常負荷時')
  await page.getByTestId('verif-expected').fill('100ms以内に応答する')
  await page.getByTestId('verif-save').click()

  // Problems から「検証未対応: REQ-000001」が消える
  await page.getByTestId('status-jobs').click()
  await page.getByTestId('panel-tab-problems').click()
  await expect(page.getByTestId('panel')).not.toContainText('検証（verifies）が未対応の要求です: REQ-000001')

  // --- モデルエディタ（P10-3 骨格）: jar 未設定の警告 + STRUCT 保存（FORM-002） ---
  await page.getByTestId('open-model-editor').click()
  await expect(page.getByTestId('model-editor')).toBeVisible()
  await page.getByTestId('model-render').click()
  await expect(page.getByTestId('notifications')).toContainText('レンダリングできません')
  await page.getByTestId('add-mapping').click()
  await page.getByTestId('model-save').click()
  await expect(page.getByTestId('design-el-STRUCT-000001')).toBeVisible()
})

test('DB to Text・ZIPアーカイブ差分・ストア閲覧・Git参照（P12）', async () => {
  // History Activity（M5 の入口）
  if (
    !(await page
      .getByTestId('history-sidebar')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('activity-history').click()
  }
  await expect(page.getByTestId('history-sidebar')).toBeVisible()

  // --- DB to Text 出力（P12-1、DATA-020〜023） ---
  await page.getByTestId('export-db-to-text').click()
  await expect(page.getByTestId('notifications')).toContainText('DB to Text を出力しました')

  // --- SQLite dump（P12-2） ---
  await page.getByTestId('export-sqlite-dump').click()
  await expect(page.getByTestId('notifications')).toContainText('SQLite dump を出力しました')

  // --- ZIP アーカイブ作成（P12-3、ジョブ実行 → archive.created でリスト更新） ---
  await page.getByTestId('archive-create').click()
  await expect(page.getByTestId('archives-list').locator('.d2d-list-row').first()).toBeVisible({ timeout: 30_000 })

  // --- 差分インポート（P12-4）: アーカイブ後に用語を追加してから比較する ---
  const added = await page.evaluate(
    async () => await window.api.invoke('glossary.addTerm', { term: 'アーカイブ後追加用語' })
  )
  expect(added).toMatchObject({ ok: true })
  await page.getByTestId('archives-list').locator('button', { hasText: '差分' }).first().click()
  await expect(page.getByTestId('archive-diff-editor')).toBeVisible()
  // entity_registry に追加分が現れる（左=アーカイブ / 右=現在）
  const registryRow = page.getByTestId('diff-row-entity_registry.jsonl')
  await expect(registryRow).toBeVisible()
  await registryRow.click()
  await expect(page.getByTestId('diff-editor')).toBeVisible()

  // --- ストア閲覧（P12-7、UI-020） ---
  if (
    !(await page
      .getByTestId('history-sidebar')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('activity-history').click()
  }
  await page.getByTestId('open-store-browser').click()
  await expect(page.getByTestId('store-browser')).toBeVisible()
  await page.getByTestId('store-table-entity_registry').click()
  await expect(page.getByTestId('store-rows')).toContainText('REQ-000001')

  // --- Git 履歴（P12-5）: 一時プロジェクトは非リポジトリ → 案内表示（GIT-007） ---
  await expect(page.getByTestId('git-not-repo')).toContainText('Git リポジトリではありません')
})

test('レポート生成→Markdown/HTMLプレビュー（P13）', async () => {
  if (
    !(await page
      .getByTestId('report-sidebar')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('activity-reports').click()
  }
  await expect(page.getByTestId('report-sidebar')).toBeVisible()

  // Markdown レポート生成（ジョブ → report.generated 通知 → 履歴へ反映）
  await page.getByTestId('report-generate').click()
  await expect(page.getByTestId('notifications')).toContainText('レポートを出力しました', { timeout: 30_000 })
  await expect(page.getByTestId('reports-list').locator('.d2d-list-row').first()).toBeVisible()

  // プレビュー: ②③④の内容が文書風に表示される（EXP-001/002/005）
  await page.getByTestId('reports-list').locator('.d2d-list-row').first().click()
  await expect(page.getByTestId('report-md-preview')).toBeVisible()
  await expect(page.getByTestId('report-md-preview')).toContainText('設計レポート')
  await expect(page.getByTestId('report-md-preview')).toContainText('④ 設計モデル')
  await expect(page.getByTestId('report-md-preview')).toContainText('REQ-000001')

  // HTML 形式（EXP-006）: 設計観点フィルタ REQ のみで生成
  if (
    !(await page
      .getByTestId('report-sidebar')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('activity-reports').click()
  }
  await page.getByTestId('report-format-html').click()
  await page.getByText('設計観点', { exact: false }).click()
  await page.getByTestId('report-cat-REQ').check()
  await page.getByTestId('report-generate').click()
  await expect(page.getByTestId('reports-list').locator('.d2d-list-row', { hasText: '.html' }).first()).toBeVisible({
    timeout: 30_000
  })
  await page.getByTestId('reports-list').locator('.d2d-list-row', { hasText: '.html' }).first().click()
  await expect(page.getByTestId('report-html-preview')).toBeVisible()
})

test('スクリーンショットを保存する', async () => {
  await page.screenshot({ path: 'test-results/workbench.png' })
})
