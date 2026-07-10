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

test('②→③統合・編集・確定（P7）', async () => {
  // Explorer の「③へ統合」で intermediate_document を生成
  await expect(page.getByTestId('compose-EXDOC-000001')).toBeVisible()
  await page.getByTestId('compose-EXDOC-000001').click()
  await expect(page.getByTestId('intermediate-doc-IMDOC-000001')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('stage-intermediate')).toContainText('1')

  // Intermediate Document Editor を開く
  await page.getByTestId('intermediate-doc-IMDOC-000001').click()
  await expect(page.getByTestId('intermediate-editor')).toBeVisible()
  await expect(page.getByTestId('intermediate-editor')).toContainText('design_doc / DD')
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

test('スクリーンショットを保存する', async () => {
  await page.screenshot({ path: 'test-results/workbench.png' })
})
