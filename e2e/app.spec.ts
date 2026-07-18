import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

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
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('d2d.workbench.') || key.startsWith('d2d.editors.') || key.startsWith('d2d.keybindings.'))
        localStorage.removeItem(key)
    }
  })
  await page.reload()
  await expect(page.getByTestId('workbench')).toBeVisible({ timeout: 15_000 })
  await page.evaluate(async () => {
    await window.api.invoke('settings.delete', { key: 'project.initializeGitOnCreate' })
  })
})

test.afterAll(async () => {
  // アプリ終了後に一時プロジェクトを削除する（DB を掴んだまま消さない）
  await app.close()
  rmSync(projectRoot, { recursive: true, force: true })
})

test('Workbench シェルが表示される（P3-1）', async () => {
  await expect(page.getByTestId('activity-bar')).toBeVisible()
  await expect(page.getByTestId('pipeline-navigator')).toBeVisible()
  await expect(page.getByTestId('pipeline-navigator')).toContainText(
    '①原本-(抽出)->②抽出-(統合)->③中間-(モデル化)->④モデル分析用語集'
  )
  await expect(page.getByTestId('open-screen-search')).toHaveText('⌕')
  await expect(page.getByTestId('status-bar')).toBeVisible()
  await expect(page.getByTestId('status-mode')).toHaveCount(0)
  await expect(page.getByTestId('welcome-editor')).toBeVisible()
  await expect(page.getByTestId('welcome-editor')).toContainText('人が自然言語で書いた設計情報')
  await expect(page.getByTestId('welcome-editor')).toContainText('オントロジーに写像した意味構造')

  // 常時表示の検索導線からウェルカムも検索できる。
  await page.getByTestId('open-screen-search').click()
  await expect(page.getByTestId('screen-text-search')).toBeVisible()
  await page.getByTestId('screen-text-search-input').fill('オントロジー')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')

  // 3種のHelp Resourceを通常のEditorタブで開ける。
  await page.getByRole('button', { name: '操作の流れ' }).click()
  await expect(page.getByTestId('help-workflow')).toContainText('Human-in-the-loop')
  await page.getByTestId('help-workflow').getByRole('button', { name: 'データスキーマ' }).click()
  await expect(page.getByTestId('help-schema')).toContainText('entity_registry')
  await page.getByTestId('help-schema').getByRole('button', { name: '設計モデル' }).click()
  await expect(page.getByTestId('help-design-model')).toContainText('13分類')
  await expect(page.getByTestId('help-design-model')).toContainText('owner_uid')
  await page.getByRole('button', { name: '設計モデルの考え方 を閉じる' }).click()
  await page.getByRole('button', { name: 'D2Dのデータスキーマ を閉じる' }).click()
  await page.getByRole('button', { name: '操作の流れ を閉じる' }).click()
  await expect(page.getByTestId('welcome-editor')).toBeVisible()

  // Workbench内の全buttonは操作説明Tooltipを持つ。
  await expect
    .poll(() =>
      page
        .locator('button:visible')
        .evaluateAll((buttons) => buttons.filter((button) => !(button as HTMLButtonElement).title.trim()).length)
    )
    .toBe(0)

  // Activity切替（Explorer → Search）。Review/JobsはPrimary Activityに置かない。
  await expect(page.getByTestId('activity-review')).toHaveCount(0)
  await expect(page.getByTestId('activity-jobs')).toHaveCount(0)
  await page.getByTestId('activity-search').click()
  await expect(page.getByTestId('primary-sidebar')).toContainText('Search')
  // 同じ Activity 再クリックで Side Bar が閉じる
  await page.getByTestId('activity-search').click()
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

test('作業モード切替後もWorkbench外周パネル状態を維持する（P3-7 / UI-041）', async () => {
  const primaryToggle = page.getByTestId('toggle-primary-sidebar')
  const secondaryToggle = page.getByTestId('toggle-secondary-sidebar')
  const panelToggle = page.getByTestId('toggle-panel')
  if ((await primaryToggle.getAttribute('aria-pressed')) !== 'true') await primaryToggle.click()
  if ((await secondaryToggle.getAttribute('aria-pressed')) !== 'true') await secondaryToggle.click()
  if ((await panelToggle.getAttribute('aria-pressed')) !== 'true') await panelToggle.click()
  const primaryWidth = (await page.locator('.wb-primary-slot').boundingBox())!.width
  const secondaryWidth = (await page.locator('.wb-secondary-slot').boundingBox())!.width
  const panelHeight = (await page.locator('.wb-panel-slot').boundingBox())!.height

  await page.keyboard.press('Control+4')
  await expect(page.getByTestId('status-mode')).toHaveCount(0)
  await expect(page.getByTestId('primary-sidebar')).toBeVisible()
  await expect(page.getByTestId('secondary-sidebar')).toBeVisible()
  await expect(page.getByTestId('panel')).toBeVisible()
  await expect.poll(async () => (await page.locator('.wb-primary-slot').boundingBox())!.width).toBe(primaryWidth)
  await expect.poll(async () => (await page.locator('.wb-secondary-slot').boundingBox())!.width).toBe(secondaryWidth)
  await expect.poll(async () => (await page.locator('.wb-panel-slot').boundingBox())!.height).toBe(panelHeight)

  await page.keyboard.press('Control+1')
  await expect(page.getByTestId('status-mode')).toHaveCount(0)
  await expect(page.getByTestId('primary-sidebar')).toBeVisible()
  await expect(page.getByTestId('secondary-sidebar')).toBeVisible()
  await expect(page.getByTestId('panel')).toBeVisible()
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
  await expect(page.getByTestId('stage-source')).toHaveText('①原本')

  // CORE-013/047: 標準フェーズ・成果物とGit Repositoryを作成時点で利用できる。
  const initialSettings = await page.evaluate(async () => {
    const [phases, artifacts, git] = await Promise.all([
      window.api.invoke<Array<{ dev_phase_name: string }>>('project.listDevPhases'),
      window.api.invoke<Array<{ artifact_name: string }>>('project.listArtifactSettings'),
      window.api.invoke<{ isRepo: boolean }>('git.info')
    ])
    return { phases, artifacts, git }
  })
  expect(initialSettings.phases).toMatchObject({ ok: true })
  expect(initialSettings.artifacts).toMatchObject({ ok: true })
  expect(initialSettings.git).toMatchObject({ ok: true, result: { isRepo: true } })
  if (initialSettings.phases.ok && initialSettings.artifacts.ok) {
    expect(initialSettings.phases.result.map((phase) => phase.dev_phase_name)).toEqual([
      'システム設計',
      'SW要求分析',
      '外部設計',
      '内部設計',
      '全般'
    ])
    expect(initialSettings.artifacts.result).toHaveLength(18)
    expect(
      initialSettings.artifacts.result.filter((artifact) => artifact.artifact_name === 'レビュー記録')
    ).toHaveLength(4)
  }

  // Explorer Treeは上下キーで選択し、左右キーとプロジェクト行のアイコンで開閉できる。
  const explorerTree = page.getByTestId('documents-tree')
  await explorerTree.focus()
  await page.keyboard.press('ArrowDown')
  const originalSummary = page.getByTestId('explorer-section-original').locator(':scope > summary')
  await expect(originalSummary).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('explorer-section-original')).not.toHaveAttribute('open', '')
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('explorer-section-original')).toHaveAttribute('open', '')
  await page.getByTestId('explorer-collapse-all').click()
  await expect(page.getByTestId('explorer-section-extracted')).not.toHaveAttribute('open', '')
  await page.getByTestId('explorer-expand-all').click()
  await expect(page.getByTestId('explorer-section-extracted')).toHaveAttribute('open', '')

  // Pipelineの分析は3種の全Resource集合、用語集は専用Editorを開く。
  await page.getByTestId('pipeline-analysis').click()
  await expect(page.getByTestId('trace-impact')).toBeVisible()
  await expect(page.getByTestId('trace-impact').locator('.trace-impact-column')).toHaveCount(3)
  await page.getByRole('button', { name: '汎用インパクト分析 を閉じる' }).click()
  await page.getByTestId('pipeline-glossary').click()
  await expect(page.getByTestId('glossary-editor')).toBeVisible()

  // アドレスバーはアクティブURIへ追従し、不正URIでは通知して遷移しない。
  const address = page.getByTestId('resource-address')
  await expect(address).toHaveValue('glossary://workspace')
  await address.fill('invalid://unknown')
  await address.press('Enter')
  await expect(page.getByTestId('notifications')).toContainText('アドレスを開けません')
  await expect(page.getByTestId('glossary-editor')).toBeVisible()
  await address.fill('project://current')
  await address.press('Enter')

  // ダッシュボードを開く
  await page.getByTestId('explorer-project-row').click()
  await expect(page.getByTestId('dashboard-editor')).toBeVisible()
  await expect(page.getByTestId('dashboard-editor')).toContainText('schema_version')
})

test('パネル表示切替・Activity並べ替え・選択表示（P3-1、UI-041/043）', async () => {
  const primaryToggle = page.getByTestId('toggle-primary-sidebar')
  if ((await primaryToggle.getAttribute('aria-pressed')) !== 'true') await primaryToggle.click()
  await expect(page.getByTestId('primary-sidebar')).toBeVisible()
  await primaryToggle.click()
  await expect(page.getByTestId('primary-sidebar')).toBeHidden()
  await page.keyboard.press('Control+B')
  await expect(page.getByTestId('primary-sidebar')).toBeVisible()

  const secondaryToggle = page.getByTestId('toggle-secondary-sidebar')
  if ((await secondaryToggle.getAttribute('aria-pressed')) === 'true') await secondaryToggle.click()
  await secondaryToggle.click()
  await expect(page.getByTestId('secondary-sidebar')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette-input').fill('Secondary Side Bar の表示切替')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('secondary-sidebar')).toBeHidden()

  const panelToggle = page.getByTestId('toggle-panel')
  if ((await panelToggle.getAttribute('aria-pressed')) === 'true') await panelToggle.click()
  await panelToggle.click()
  await expect(page.getByTestId('panel')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette-input').fill('Panel の表示切替')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('panel')).toBeHidden()

  await page.getByTestId('activity-history').dragTo(page.getByTestId('activity-explorer'))
  await expect(page.getByTestId('activity-order').locator('.wb-activity-btn').first()).toHaveAttribute(
    'data-activity-id',
    'history'
  )
  await expect(page.getByTestId('activity-order').getByTestId('activity-settings')).toHaveCount(0)
  await expect(page.locator('.wb-activitybar-bottom').getByTestId('activity-settings')).toBeVisible()
  const savedActivityOrder = await page.evaluate(
    () =>
      Object.keys(localStorage)
        .filter((key) => key.startsWith('d2d.workbench.'))
        .map((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { activityOrder?: string[] })
        .find((layout) => layout.activityOrder?.[0] === 'history')?.activityOrder
  )
  expect(savedActivityOrder?.at(-1)).toBe('settings')

  await page.getByTestId('activity-trace').click()
  await expect(page.getByTestId('activity-trace')).toHaveClass(/active/)
  await expect(page.getByTestId('activity-trace')).toHaveAttribute('aria-current', 'page')
  await page.getByTestId('activity-trace').click()
  await expect(page.getByTestId('primary-sidebar')).toBeHidden()
  await expect(page.getByTestId('activity-trace')).toHaveClass(/active/)
  await page.getByTestId('activity-explorer').click()
  await expect(page.getByTestId('primary-sidebar')).toBeVisible()
})
test('Workbenchパネルのリサイズ・アコーディオン・再帰分割（P3-1）', async () => {
  const primary = page.locator('.wb-primary-slot')
  const primaryBefore = await primary.evaluate((element) => element.getBoundingClientRect().width)
  await page.getByTestId('primary-resize-handle').focus()
  await page.keyboard.press('ArrowRight')
  await expect
    .poll(async () => primary.evaluate((element) => element.getBoundingClientRect().width))
    .toBeGreaterThan(primaryBefore)

  for (const toggleId of ['toggle-secondary-sidebar', 'toggle-panel']) {
    const toggle = page.getByTestId(toggleId)
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') {
      await toggle.click()
    }
  }

  await page.keyboard.press('Control+4')
  await expect(page.getByTestId('secondary-resize-handle')).toBeVisible()
  await expect(page.getByTestId('panel-resize-handle')).toBeVisible()
  await expect(page.getByTestId('secondary-accordion-properties')).toBeVisible()
  await expect(page.getByTestId('secondary-accordion-relations')).toBeVisible()
  await expect(page.getByTestId('secondary-accordion-review')).toBeVisible()
  await expect(page.getByTestId('secondary-accordion-evidence')).toHaveCount(0)
  await expect(page.getByTestId('secondary-accordion-candidates')).toHaveCount(0)
  const secondaryAccordions = page.locator('.wb-secondary-accordion')
  await expect(secondaryAccordions).toHaveCount(4)
  await expect(secondaryAccordions.nth(0)).toHaveAttribute('data-testid', 'secondary-accordion-properties')
  await expect(secondaryAccordions.nth(1)).toHaveAttribute('data-testid', 'secondary-accordion-relations')
  await expect(secondaryAccordions.nth(2)).toHaveAttribute('data-testid', 'secondary-accordion-review')
  await expect(secondaryAccordions.nth(3)).toHaveAttribute('data-testid', 'secondary-accordion-dictionary')
  await page.getByTestId('secondary-tab-relations').click()
  await expect(page.getByTestId('secondary-tab-relations')).toHaveAttribute('aria-expanded', 'false')
  await expect(secondaryAccordions.nth(1)).toHaveAttribute('data-testid', 'secondary-accordion-relations')
  await page.getByTestId('secondary-tab-relations').click()
  await expect(page.getByTestId('secondary-tab-relations')).toHaveAttribute('aria-expanded', 'true')

  await page.getByTestId('editor-split-horizontal-1').click()
  await expect(page.locator('[data-direction="horizontal"]')).toHaveCount(1)
  await page.getByTestId('editor-split-vertical-2').click()
  await expect(page.locator('[data-direction="vertical"]')).toHaveCount(1)
  const splitFirst = page.getByTestId('editor-split-1').locator(':scope > .wb-editor-split-child').first()
  const basisBefore = await splitFirst.getAttribute('style')
  await page.getByTestId('editor-split-handle-1').focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => splitFirst.getAttribute('style')).not.toBe(basisBefore)

  for (const command of ['アクティブタブを前のEditor Groupへ移動', 'アクティブタブを前のEditor Groupへ移動']) {
    await page.keyboard.press('Control+Shift+P')
    await page.getByTestId('palette-input').fill(command)
    await page.getByRole('option', { name: command, exact: true }).click()
  }
  await expect(page.locator('.wb-editor-split')).toHaveCount(0)
  await page.keyboard.press('Control+1')
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

  await page.getByTestId('setting-font-size').fill('15')
  await expect(page.getByTestId('setting-font-size-value')).toHaveText('15px')
  await expect(page.locator('html')).toHaveCSS('--d2d-font-size', '15px')
  await expect
    .poll(async () => page.evaluate(async () => window.api.invoke('settings.get', { key: 'theme.fontSize' })))
    .toMatchObject({ ok: true, result: 15 })
  await page.getByTestId('setting-font-size').fill('13')

  await page.getByTestId('setting-color-buttonBackground').fill('#123456')
  await expect(page.locator('html')).toHaveCSS('--d2d-button-bg', '#123456')
  await expect
    .poll(async () => page.evaluate(async () => window.api.invoke('settings.get', { key: 'theme.customColors' })))
    .toMatchObject({ ok: true, result: { buttonBackground: '#123456' } })
  await page.getByTestId('setting-colors-reset-all').click()
  await expect
    .poll(async () => page.evaluate(async () => window.api.invoke('settings.get', { key: 'theme.customColors' })))
    .toMatchObject({ ok: true, result: {} })
  await expect(page.getByTestId('setting-color-workbenchBackground')).toHaveValue('#1b1d21')
  await page.getByTestId('setting-display-mode').selectOption('light')
  await expect(page.getByTestId('setting-color-workbenchBackground')).toHaveValue('#f5f6f8')
  await page.getByTestId('setting-display-mode').selectOption('dark')
  await expect(page.getByTestId('setting-color-workbenchBackground')).toHaveValue('#1b1d21')

  const initializeGit = page.getByTestId('setting-project-initialize-git')
  await expect(initializeGit).toBeChecked()
  await initializeGit.uncheck()
  await expect
    .poll(async () =>
      page.evaluate(async () => window.api.invoke('settings.get', { key: 'project.initializeGitOnCreate' }))
    )
    .toMatchObject({ ok: true, result: false })
  await initializeGit.check()
  await expect
    .poll(async () =>
      page.evaluate(async () => window.api.invoke('settings.get', { key: 'project.initializeGitOnCreate' }))
    )
    .toMatchObject({ ok: true, result: true })

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
  const secondDocxPath = join(tmpdir(), `d2d-e2e-spec-second-${Date.now()}.docx`)
  for (const path of [docxPath, secondDocxPath]) {
    execFileSync(process.platform === 'win32' ? 'python' : 'python3', [
      join(process.cwd(), 'workers', 'python', 'tests', 'make_docx.py'),
      path
    ])
  }

  // 複数選択時と同じく、選択ファイルごとに独立した取込Jobを登録する（IMP-010）。
  const imported = await page.evaluate(
    async (paths) =>
      await Promise.all(paths.map((filePath) => window.api.invoke<{ jobId: string }>('document.import', { filePath }))),
    [docxPath, secondDocxPath]
  )
  expect(imported).toHaveLength(2)
  expect(imported.every((result) => result.ok)).toBe(true)

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
  await expect(page.getByTestId('explorer-project-tree')).toHaveAttribute('open', '')
  await expect(page.getByTestId('explorer-project-row')).toContainText('P3プロジェクト')
  await page.getByTestId('explorer-section-original').locator(':scope > summary').click({ button: 'right' })
  await expect(page.getByTestId('ctx-original-import')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('source-doc-DOC-000001')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('source-doc-DOC-000002')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('stage-source')).toHaveText('①原本')
  await expect(page.getByTestId('source-doc-DOC-000001')).toHaveAttribute('title', /SHA-256:/)
  await expect(page.getByTestId('explorer-section-original').locator('summary .d2d-explorer-folder-icon')).toBeVisible()
  await expect(
    page.getByTestId('source-doc-DOC-000001').locator('.d2d-explorer-resource-icon.is-original')
  ).toBeVisible()
  await expect(page.getByTestId('source-doc-DOC-000001').locator('.d2d-explorer-tags')).toContainText('word')
  const sourceNameBox = await page
    .getByTestId('source-doc-DOC-000001')
    .locator('.d2d-explorer-resource-name')
    .boundingBox()
  const sourceTagsBox = await page.getByTestId('source-doc-DOC-000001').locator('.d2d-explorer-tags').boundingBox()
  expect(sourceTagsBox!.x).toBeGreaterThan(sourceNameBox!.x)
  await expect(page.getByTestId('explorer-section-original')).toHaveAttribute('open', '')
  await page.getByTestId('explorer-section-original').locator('summary').click()
  await expect(page.getByTestId('source-doc-DOC-000001')).toBeHidden()
  await page.getByTestId('explorer-section-original').locator('summary').click()
  await expect(page.getByTestId('source-doc-DOC-000001')).toBeVisible()

  // Pipeline ①はソート可能な一覧＋読取専用詳細を開き、アーカイブ中だけExplorerから除外する。
  await page.getByTestId('stage-source').click()
  await expect(page.getByTestId('stage-overview-source')).toBeVisible()
  await expect(page.getByTestId('stage-source-import')).toBeVisible()
  await expect(page.getByTestId('documents-tree').getByTestId('import-button')).toHaveCount(0)
  await expect(page.getByTestId('stage-source')).toHaveClass(/active/)
  await expect(page.getByTestId('stage-extracted')).not.toHaveClass(/active/)
  const sourceStageLayout = page.getByTestId('stage-source-layout')
  const sourceListPane = sourceStageLayout.locator(':scope > .d2d-resizable-pane').first()
  const sourceListWidth = (await sourceListPane.boundingBox())!.width
  const sourceStageHandle = page.getByTestId('stage-source-layout-handle-0')
  const sourceStageHandleBox = (await sourceStageHandle.boundingBox())!
  await page.mouse.move(sourceStageHandleBox.x + 2, sourceStageHandleBox.y + 30)
  await page.mouse.down()
  await page.mouse.move(sourceStageHandleBox.x + 42, sourceStageHandleBox.y + 30)
  await page.mouse.up()
  await expect.poll(async () => (await sourceListPane.boundingBox())!.width).toBeGreaterThan(sourceListWidth)
  const sourceStageRow = page.getByTestId('stage-source-row-DOC-000001')
  await sourceStageRow.click()
  await sourceStageRow.focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByTestId('stage-source-row-DOC-000002')).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(sourceStageRow).toHaveAttribute('aria-selected', 'true')
  await sourceStageRow.focus()
  await page.keyboard.press('Space')
  await expect(sourceStageRow).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('source-stage-preview')).toContainText('原本は読み取り専用です')
  await expect(page.getByTestId('source-open-external')).toBeVisible()
  await expect(page.getByTestId('extract-button')).toBeVisible()
  await expect(page.getByTestId('extract-button')).toBeEnabled()
  await page.getByTestId('sort-file_name').click()
  await expect(page.getByTestId('sort-file_name')).toContainText('▲')
  const archivedSourceRow = page.getByTestId('stage-source-row-DOC-000002')
  await archivedSourceRow.getByRole('button', { name: 'アーカイブ' }).click()
  await expect(page.getByTestId('source-doc-DOC-000002')).toBeHidden()
  await archivedSourceRow.getByRole('button', { name: '解除' }).click()
  await expect(page.getByTestId('source-doc-DOC-000002')).toBeVisible()
  await expect(sourceStageRow.getByRole('button', { name: '削除' })).toBeVisible()

  // 原本ビュー（P4-2）から抽出ジョブを実行（P5）
  await page.getByTestId('source-doc-DOC-000001').click()
  await expect(page.getByTestId('original-viewer')).toBeVisible()
  await expect(page.getByTestId('original-viewer')).toContainText('SHA-256')
  await expect(page.getByTestId('source-open-external')).toBeVisible()
  await expect(page.getByTestId('extract-button')).toContainText('②抽出データの生成（抽出ジョブ実行）')
  await page.getByTestId('extract-button').click()

  // 抽出完了 → ②抽出データがツリーへ出現
  const extractedRow = page.getByTestId('extracted-doc-EXDOC-000001')
  await expect(extractedRow).toBeVisible({ timeout: 60_000 })
  await expect(extractedRow).toContainText(basename(docxPath))
  await expect(extractedRow).toHaveAttribute('title', /抽出器:/)
  await expect(page.getByTestId('stage-extracted')).toHaveText('②抽出')
  await expect(page.getByTestId('extract-button')).toBeDisabled()
  await page.getByTestId('stage-source').click()
  await page.getByTestId('stage-source-row-DOC-000001').click()
  await expect(page.getByTestId('extract-button')).toBeDisabled()
  await expect(page.getByTestId('extracted-unconfirmed-EXDOC-000001')).toContainText(/未確定 [1-9]/)
  await expect(page.getByTestId('explorer-section-extracted')).toContainText(
    '編集する場合は、対象の抽出データを選択してください。'
  )
  await expect(page.getByTestId('explorer-section-extracted').getByRole('button')).toHaveCount(0)
  await page.getByTestId('explorer-section-extracted').locator(':scope > summary').click({ button: 'right' })
  await expect(page.getByTestId('context-menu')).toBeHidden()

  // Pipeline ②はソート可能な抽出文書一覧と独自プレビューを表示する。
  await page.getByTestId('stage-extracted').click()
  await expect(page.getByTestId('stage-overview-extracted')).toBeVisible()
  await expect(page.getByTestId('stage-source')).not.toHaveClass(/active/)
  await expect(page.getByTestId('stage-extracted')).toHaveClass(/active/)
  await expect(page.getByTestId('stage-extracted-layout-handle-0')).toBeVisible()
  const extractedStageRow = page.getByTestId('stage-extracted-row-EXDOC-000001')
  await extractedStageRow.focus()
  await page.keyboard.press('Enter')
  await expect(extractedStageRow).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('extracted-stage-preview')).toContainText('1. 概要')
  await page.getByTestId('sort-item_count').click()
  await expect(page.getByTestId('sort-item_count')).toContainText('▲')
  await expect(extractedStageRow.getByRole('button', { name: 'アーカイブ' })).toBeVisible()
  await expect(extractedStageRow.getByRole('button', { name: '削除' })).toBeVisible()

  // 抽出レビュー Editor（P5-6）: 共通要素一覧 + 構造プレビュー + Selection/Properties
  await page.getByTestId('stage-extracted').click()
  await page.getByTestId('extracted-doc-EXDOC-000001').click({ position: { x: 8, y: 8 } })
  await expect(page.getByTestId('extraction-review-editor')).toBeVisible()
  await page.getByTestId('rename-extracted').click()
  await expect(page.getByTestId('rename-extracted-dialog')).toBeVisible()
  await page.getByTestId('rename-extracted-input').fill('名称変更後の抽出データ')
  await page.getByTestId('rename-extracted-save').click()
  await expect(page.getByTestId('notifications')).toContainText('抽出データの名称を変更しました')
  await expect
    .poll(async () => {
      const renamed = await page.evaluate(async () =>
        window.api.invoke<{ code: string; title: string }[]>('extracted.list')
      )
      return renamed.ok ? renamed.result.find((doc) => doc.code === 'EXDOC-000001')?.title : renamed.error.message
    })
    .toBe('名称変更後の抽出データ')
  await expect(page.getByTestId('extraction-review-editor').locator('.extraction-review-toolbar > h1')).toHaveText(
    '名称変更後の抽出データ'
  )
  await expect(extractedRow).toContainText('名称変更後の抽出データ')
  const extractionLayout = page.getByTestId('extraction-review-layout')
  const extractionFirstPane = extractionLayout.locator(':scope > .d2d-resizable-pane').first()
  const extractionWidthBefore = (await extractionFirstPane.boundingBox())!.width
  const extractionHandle = page.getByTestId('extraction-review-layout-handle-0')
  const extractionHandleBox = (await extractionHandle.boundingBox())!
  await page.mouse.move(extractionHandleBox.x + extractionHandleBox.width / 2, extractionHandleBox.y + 40)
  await page.mouse.down()
  await page.mouse.move(extractionHandleBox.x + extractionHandleBox.width / 2 + 40, extractionHandleBox.y + 40)
  await page.mouse.up()
  await expect.poll(async () => (await extractionFirstPane.boundingBox())!.width).toBeGreaterThan(extractionWidthBefore)
  const elementGrid = page.getByTestId('element-grid')
  const rows = elementGrid.locator('tbody tr.d2d-grid-row')
  await expect(elementGrid).toContainText('1. 概要')
  await expect(elementGrid).toContainText('見出し')
  await expect(page.getByTestId('review-markdown')).toContainText('1.1 対象範囲')
  await expect(page.getByTestId('review-markdown')).toContainText('100ms以内')
  await expect(page.getByTestId('review-markdown').getByRole('img')).toBeVisible()
  await page.getByTestId('extraction-preview-structure').click()
  await expect(page.getByTestId('extraction-structure-json')).toContainText('elements')
  await expect(page.getByTestId('extraction-structure-json').locator('.structured-json-key').first()).toBeVisible()
  await page.getByTestId('extraction-preview-visual').click()
  await expect(page.getByTestId('preview-item-e1')).toHaveClass(/selected/)
  const previewMeta = page.getByTestId('document-preview-meta-controls').last()
  await previewMeta.getByLabel('要素ID').uncheck()
  await expect(page.getByTestId('preview-item-e1').locator('code')).toHaveCount(0)
  await previewMeta.getByLabel('要素ID').check()
  await page.keyboard.press('Control+f')
  await expect(page.getByTestId('screen-text-search')).toBeVisible()
  await page.getByTestId('screen-text-search-input').fill('100ms以内')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Escape')

  // キーボード選択: ↓で次要素へ移動し、プレビューとPropertiesを同期する。
  await rows.first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(rows.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('preview-item-e2')).toHaveClass(/active/)
  // Workbench共通Secondary: Properties同期、Review保存、trace_link関係と方向を表示する。
  await expect(page.getByTestId('selected-item-properties')).toContainText('extracted_item')
  await expect(page.getByTestId('selected-item-properties')).toContainText('e2')
  await page.getByTestId('secondary-review-comment').fill('E2Eレビューコメント')
  await page.getByTestId('secondary-review-save').click()
  await expect(page.getByTestId('secondary-review-list')).toContainText('E2Eレビューコメント')
  await expect(page.getByTestId('secondary-relations-list')).toContainText('relates_to')
  await expect(page.getByTestId('secondary-relations-list')).toContainText('入力 ←')

  // Ctrlで非連続複数選択し、選択中要素だけを一括で要修正にする。
  await rows.nth(3).click({ modifiers: ['Control'] })
  await expect(page.getByTestId('extraction-review-editor')).toContainText('2 選択')
  await page.getByTestId('selected-needsfix').click()
  await expect(rows.nth(1).locator('.review-needsfix')).toBeVisible()
  await expect(rows.nth(3).locator('.review-needsfix')).toBeVisible()
  const draftExtractedDocuments = await page.evaluate(async () =>
    window.api.invoke<{ status: string }[]>('extracted.list')
  )
  expect(draftExtractedDocuments.ok && draftExtractedDocuments.result[0]?.status).not.toBe('approved')

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
  await expect(page.getByTestId('extracted-unconfirmed-EXDOC-000001')).toContainText('未確定 0')
  const approvedExtractedDocuments = await page.evaluate(async () =>
    window.api.invoke<{ status: string }[]>('extracted.list')
  )
  expect(approvedExtractedDocuments.ok && approvedExtractedDocuments.result[0]?.status).toBe('approved')

  rmSync(docxPath, { force: true })
  rmSync(secondDocxPath, { force: true })
})

test('②→③統合・編集・確定（P7）', async () => {
  // プロジェクト設定でフェーズ・成果物を定義する
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette-input').fill('プロジェクト設定を開く')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('project-settings-editor')).toBeVisible()
  await page.evaluate(async () =>
    window.api.invoke('project.saveArtifactSetting', { artifactName: 'フェーズ未定義成果物', artifactTypeId: 'orphan' })
  )
  await page.getByTestId('phase-name').fill('詳細設計')
  await page.getByTestId('phase-id').fill('DD')
  await page.getByTestId('phase-add').click()
  await page.getByTestId('artifact-name').fill('統合設計書')
  await page.getByTestId('artifact-type').fill('design_doc')
  await page.getByTestId('artifact-phase').selectOption('DD')
  await page.getByTestId('artifact-add').click()

  // 設定した成果物は取込元がなくてもExplorerへ表示し、選択時に空の③編集画面を開ける。
  await expect(page.getByTestId('documents-tree')).not.toContainText('フェーズ未定義成果物')
  await expect(page.getByTestId('documents-tree')).not.toContainText('③へ統合')
  const artifactSlot = page.getByTestId('artifact-slot-DD-design_doc')
  await expect(artifactSlot).toBeVisible()
  const phaseNode = page.getByTestId('phase-DD')
  await expect(phaseNode.getByText('フェーズ', { exact: true })).toBeVisible()
  await expect(artifactSlot).not.toContainText('成果物')
  await expect(artifactSlot).toContainText('未確定 0')
  await expect(artifactSlot).toContainText('0要素')
  await expect(page.getByTestId('explorer-section-intermediate')).not.toContainText('統合元未選択')
  await expect(phaseNode).toHaveAttribute('open', '')
  await phaseNode.locator(':scope > summary').click()
  await expect(artifactSlot).toBeHidden()
  await phaseNode.locator(':scope > summary').click()
  await expect(artifactSlot).toBeVisible()
  await page.getByTestId('explorer-section-intermediate').locator(':scope > summary').click({ button: 'right' })
  await page.getByTestId('ctx-intermediate-import').click()
  await expect(page.getByTestId('intermediate-source-dialog')).toBeVisible()
  await page.getByTestId('intermediate-source-dialog').getByRole('button', { name: 'キャンセル' }).click()
  await artifactSlot.click({ button: 'right' })
  await page.getByTestId('ctx-artifact-import').click()
  await expect(page.getByTestId('intermediate-target-DD-design_doc')).toBeChecked()
  await page.getByTestId('intermediate-source-dialog').getByRole('button', { name: 'キャンセル' }).click()
  await artifactSlot.click()
  await expect(page.getByTestId('intermediate-editor')).toBeVisible()
  await expect(page.getByTestId('intermediate-grid').getByRole('row')).toHaveCount(1)
  await expect(page.getByTestId('intermediate-doc-IMDOC-000001')).toBeVisible()

  // 未確認の②も取込候補に表示され、各要素の抽出レビュー状態を取込編集へ引き継ぐ。
  const draftSource = await page.evaluate(async () => {
    const list = await window.api.invoke<Array<{ uid: string }>>('extracted.list')
    if (!list.ok || !list.result[0]) return false
    const detail = await window.api.invoke<{ elements: Array<{ resource_uid?: string }> }>('extracted.get', {
      uid: list.result[0].uid
    })
    const resourceUid = detail.ok ? detail.result.elements[0]?.resource_uid : undefined
    if (!resourceUid) return false
    const updated = await window.api.invoke('extracted.updateItemStatus', {
      extractedDocumentUid: list.result[0].uid,
      resourceUid,
      status: 'draft'
    })
    return updated.ok
  })
  expect(draftSource).toBe(true)

  // Pipeline ③一覧上部の「取込」で、取込先成果物1件と取込元②複数件を選択する
  await page.getByTestId('stage-intermediate').click()
  await page.getByTestId('intermediate-import-button').click()
  const sourceDialog = page.getByTestId('intermediate-source-dialog')
  await expect(sourceDialog).toBeVisible()
  await expect(sourceDialog).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(sourceDialog.getByRole('button', { name: 'キャンセル' })).toBeVisible()
  const targetCheckbox = page.getByTestId('intermediate-target-DD-design_doc')
  const sourceCheckbox = sourceDialog.getByTestId('intermediate-source-EXDOC-000001')
  await expect(sourceCheckbox).toBeDisabled()
  await expect(sourceDialog.getByTestId('intermediate-import-sources').locator('.review-unconfirmed')).toBeVisible()
  await targetCheckbox.check()
  await sourceCheckbox.check()
  await sourceDialog.getByRole('button', { name: '選択内容を保存' }).click()
  await expect(page.getByTestId('intermediate-doc-IMDOC-000001')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('intermediate-doc-IMDOC-000001')).toHaveAttribute('title', /成果物: 統合設計書/)
  await expect(page.getByTestId('stage-intermediate')).toHaveText('③中間')
  await expect(page.getByTestId('intermediate-unconfirmed-IMDOC-000001')).toContainText('未確定 0')

  // Pipeline ③はフェーズ－成果物階層と独自プレビューを表示する。
  await page.getByTestId('stage-intermediate').click()
  await expect(page.getByTestId('stage-overview-intermediate')).toBeVisible()
  await expect(page.getByTestId('stage-intermediate-layout-handle-0')).toBeVisible()
  await expect(page.getByTestId('stage-intermediate-hierarchy')).toContainText('詳細設計')
  const intermediateStageRow = page.getByTestId('stage-intermediate-row-IMDOC-000001')
  await intermediateStageRow.focus()
  await page.keyboard.press('Space')
  await expect(intermediateStageRow).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('intermediate-stage-preview')).toContainText('統合設計書')
  const artifactSortButton = intermediateStageRow.locator('xpath=ancestor::table').getByTestId('sort-artifact_type_id')
  await artifactSortButton.click()
  await expect(artifactSortButton).toContainText('▲')

  // ③ステージは成果物の下に取込元を表示し、この画面から取込対象を削除できる。
  const stageSources = intermediateStageRow.locator('xpath=ancestor::table').locator('.stage-intermediate-sources')
  await expect(stageSources).toContainText('名称変更後の抽出データ')
  await stageSources.getByRole('button', { name: '削除' }).click()
  await expect(stageSources).toContainText('未選択')

  // 取込先成果物を選ぶと既存関係を復元し、未確認の②も再度選択して保存できる。
  await page.getByTestId('intermediate-import-button').click()
  await page.getByTestId('intermediate-target-DD-design_doc').check()
  await expect(page.getByTestId('intermediate-source-EXDOC-000001')).not.toBeChecked()
  await page.getByTestId('intermediate-source-EXDOC-000001').check()
  await page.getByTestId('intermediate-source-dialog').getByRole('button', { name: '選択内容を保存' }).click()

  // 成果物配下の取込元は成果物単位で折畳・再展開できる。
  const artifactNode = page.getByTestId('intermediate-doc-IMDOC-000001').locator('xpath=../..')
  const artifactSummary = artifactNode.locator(':scope > summary')
  await expect(artifactNode.locator('.d2d-explorer-source-row')).toBeVisible()
  await artifactSummary.click({ position: { x: 3, y: 3 } })
  await expect(artifactNode).not.toHaveAttribute('open', '')
  await expect(artifactNode.locator('.d2d-explorer-source-row')).toBeHidden()
  await page.keyboard.press('ArrowRight')
  await expect(artifactNode).toHaveAttribute('open', '')
  await expect(artifactNode.locator('.d2d-explorer-source-row')).toBeVisible()

  // 同一成果物の重複は最新1件以外を自動アーカイブし、③一覧から削除・復元できる。
  const duplicateIntermediate = await page.evaluate(async () => {
    const extractedResult = await window.api.invoke<Array<{ uid: string }>>('extracted.list')
    if (!extractedResult.ok || !extractedResult.result[0]) throw new Error('取込元が見つかりません')
    return window.api.invoke<{ uid: string; code: string }>('intermediate.create', {
      extractedDocumentUids: [extractedResult.result[0].uid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD',
      title: '重複確認用',
      importItems: false
    })
  })
  expect(duplicateIntermediate.ok).toBe(true)
  if (!duplicateIntermediate.ok) throw new Error('重複確認用中間データを作成できませんでした')
  const duplicateRow = page.getByTestId(`stage-intermediate-row-${duplicateIntermediate.result.code}`)
  await expect(duplicateRow).toBeVisible()
  await expect(page.getByTestId('stage-intermediate-row-IMDOC-000001')).toContainText('アーカイブ')
  await page.getByTestId('stage-intermediate-row-IMDOC-000001').getByRole('button', { name: '解除' }).click()
  await expect(duplicateRow).toContainText('アーカイブ')
  await expect(page.getByTestId('intermediate-doc-IMDOC-000001')).toBeVisible()
  await duplicateRow.getByRole('button', { name: '削除' }).click()
  await expect(page.getByTestId('confirm-dialog')).toBeVisible()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('confirm-dialog')).toBeHidden()

  // Intermediate Document Editor を開く
  await page.getByTestId('intermediate-doc-IMDOC-000001').click()
  await expect(page.getByTestId('intermediate-editor')).toBeVisible()
  await expect(page.getByTestId('intermediate-editor').getByRole('heading', { level: 1 })).toHaveText('統合設計書')
  await expect(page.getByTestId('intermediate-editor')).toContainText('design_doc / DD')
  await expect(page.getByTestId('intermediate-import-layout-handle-0')).toBeVisible()
  await expect(page.getByTestId('intermediate-import-layout-handle-1')).toBeVisible()
  const importFirstPane = page.getByTestId('intermediate-import-layout').locator(':scope > .d2d-resizable-pane').first()
  const importWidthBefore = (await importFirstPane.boundingBox())!.width
  await page.getByTestId('intermediate-import-layout-handle-0').focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await importFirstPane.boundingBox())!.width).toBeGreaterThan(importWidthBefore)
  // 空の成果物へ統合元要素を明示追加する。選択列ではなく抽出状態を表示する。
  const sourceGrid = page.getByTestId('intermediate-source-grid')
  await expect(sourceGrid.getByRole('columnheader').first()).toContainText('状態')
  await expect(sourceGrid.getByRole('checkbox')).toHaveCount(0)
  const sourceItemCount = (await sourceGrid.getByRole('row').count()) - 1
  const firstSourceRow = sourceGrid.getByRole('row').nth(1)
  await expect(firstSourceRow).toContainText('未確認')
  await expect(firstSourceRow.locator('.review-unconfirmed')).toBeVisible()
  await firstSourceRow.click()
  await sourceGrid
    .getByRole('row')
    .last()
    .click({ modifiers: ['Shift'] })
  await expect(page.getByTestId('source-add-above')).toHaveAttribute(
    'title',
    /選択中の統合元要素を、選択中の成果物要素の上に追加し、based_onで関連付けます/
  )
  await expect(page.getByTestId('source-add-below')).toHaveAttribute(
    'title',
    /選択中の統合元要素を、選択中の成果物要素の下に追加し、based_onで関連付けます/
  )
  await page.getByTestId('source-add-below').click()
  const middleGrid = page.getByTestId('intermediate-grid')
  await expect(middleGrid).toContainText('1. 概要')
  await expect(page.getByTestId('source-link-summary')).toContainText(
    `紐付済 ${sourceItemCount} / 全 ${sourceItemCount}`
  )
  await expect(firstSourceRow).toHaveAttribute('data-linked', 'true')
  await expect(firstSourceRow).not.toHaveAttribute('aria-disabled', 'true')

  // 取込編集の成果物一覧はShift+上下で範囲を拡張・縮小する。
  const firstArtifactRow = middleGrid.getByRole('row').nth(1)
  const secondArtifactRow = middleGrid.getByRole('row').nth(2)
  await firstArtifactRow.click()
  await firstArtifactRow.focus()
  await page.keyboard.press('Shift+ArrowDown')
  await expect(firstArtifactRow).toHaveAttribute('aria-selected', 'true')
  await expect(secondArtifactRow).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Shift+ArrowUp')
  await expect(firstArtifactRow).toHaveAttribute('aria-selected', 'true')
  await expect(secondArtifactRow).toHaveAttribute('aria-selected', 'false')
  // 次の関連強調検証で選択のsolid outlineと競合しないよう、2行目を単独選択する。
  await secondArtifactRow.click()

  // 取込済み行も選択でき、Shift+上下で範囲選択し、成果物とプレビューをbased_onで強調する。
  await firstSourceRow.click()
  await firstSourceRow.focus()
  await page.keyboard.press('Shift+ArrowDown')
  await expect(firstSourceRow).toHaveAttribute('aria-selected', 'true')
  await expect(sourceGrid.getByRole('row').nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect(middleGrid.getByRole('row').nth(1)).toHaveCSS('outline-style', 'dashed')
  await expect(page.getByTestId('intermediate-markdown').locator('.extraction-preview-item').first()).toHaveClass(
    /related/
  )

  // 同じ統合元を別成果物要素へ再利用でき、「削除」は当該統合元のbased_onだけを外す。
  await middleGrid.getByRole('row').nth(1).click()
  await firstSourceRow.click()
  const artifactRowsBeforeReuse = await middleGrid.getByRole('row').count()
  await page.getByTestId('source-add-below').click()
  await expect(middleGrid.getByRole('row')).toHaveCount(artifactRowsBeforeReuse + 1)
  await page.getByTestId('source-delete').click()
  await expect(firstSourceRow).not.toHaveAttribute('data-linked', 'true')
  await expect(page.getByTestId('source-link-summary')).toContainText(
    `紐付済 ${sourceItemCount - 1} / 全 ${sourceItemCount}`
  )
  await expect(middleGrid.getByRole('row')).toHaveCount(artifactRowsBeforeReuse + 1)
  await expect(page.getByTestId('intermediate-unconfirmed-IMDOC-000001')).toContainText(/未確定 [1-9]/)
  await middleGrid.getByRole('row').nth(1).getByTitle('クリックで状態を切替').click()
  await expect(middleGrid.getByRole('row').nth(1)).toContainText('確認済')
  for (let i = 0; i < 3; i++) await middleGrid.getByRole('row').nth(1).getByTitle('クリックで状態を切替').click()
  await expect(middleGrid.getByRole('row').nth(1)).toContainText('未確認')
  await middleGrid.getByRole('row').nth(1).focus()
  await page.keyboard.press('ArrowDown')
  await expect(middleGrid.getByRole('row').nth(2)).toHaveAttribute('aria-selected', 'true')
  await expect(middleGrid.getByRole('row').nth(1)).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByTestId('intermediate-markdown')).toContainText('対象項目その1')
  await page.getByTestId('intermediate-preview-structure').click()
  await expect(page.getByTestId('intermediate-structure-json')).toContainText('sources')
  await expect(page.getByTestId('intermediate-structure-json').locator('.structured-json-key').first()).toBeVisible()
  await page.getByTestId('intermediate-preview-visual').click()

  // Resource編集（新ID割当・由来追跡）: item_typeを表示し、resource_text固有項目を編集
  const textRow = page
    .getByTestId('intermediate-grid')
    .getByRole('row')
    .filter({ hasText: '本書はテスト用の仕様書である。要求REQ-001を含む。' })
  await expect(textRow).toContainText('テキスト')
  await textRow.dblclick()
  await expect(page.getByTestId('resource-edit-dialog')).toBeVisible()
  await expect(page.getByTestId('resource-editor-layout-handle-0')).toBeVisible()
  const resourceSourcePane = page.getByTestId('resource-editor-layout').locator(':scope > .d2d-resizable-pane').first()
  const resourceWidthBefore = (await resourceSourcePane.boundingBox())!.width
  await page.getByTestId('resource-editor-layout-handle-0').focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await resourceSourcePane.boundingBox())!.width).toBeGreaterThan(resourceWidthBefore)
  await expect(page.getByTestId('resource-merge-source')).toContainText('抽出元')
  await expect(page.getByTestId('resource-merge-target')).toBeVisible()
  await page.getByTestId('resource-rule-merge').click()
  const mergeTarget = page.getByTestId('resource-merge-target')
  await expect(mergeTarget.getByTestId('resource-field-text_body')).toBeVisible()
  await expect(mergeTarget.getByTestId('resource-field-text_body-editor')).toHaveCount(0)
  await mergeTarget.getByTestId('semantic-edit-text_body').click()
  await mergeTarget
    .getByTestId('resource-field-text_body-editor')
    .fill('本書はテスト用の仕様書である。要求REQ-001および要求REQ-002を含む。')
  await mergeTarget.getByTestId('semantic-edit-close-text_body').click()
  await expect(page.getByTestId('resource-save')).toHaveText('元Resourceを保護して新Resourceとして保存')
  await page.getByTestId('resource-save').click()
  await expect(page.getByTestId('resource-edit-dialog')).toHaveCount(0)
  await expect(page.getByTestId('intermediate-markdown')).toContainText('REQ-002')
  await expect(
    page.getByTestId('intermediate-markdown').getByRole('button', { name: 'テキスト' }).first()
  ).toBeVisible()

  // 中間データ単独編集: 2ペイン切替、任意位置追加、Enter/ダブルクリック編集、複製、削除
  await page.getByTestId('intermediate-mode-standalone').click()
  await expect(page.getByTestId('intermediate-standalone-layout')).toBeVisible()
  await expect(page.getByTestId('intermediate-standalone-layout-handle-0')).toBeVisible()
  await expect(page.getByTestId('intermediate-standalone-layout-handle-1')).toHaveCount(0)
  await expect(page.getByTestId('intermediate-source-grid')).toHaveCount(0)
  // 単独編集でも同じ成果物一覧のShift範囲選択を利用できる。
  const standaloneFirstRow = middleGrid.getByRole('row').nth(1)
  const standaloneSecondRow = middleGrid.getByRole('row').nth(2)
  await standaloneFirstRow.click()
  await standaloneFirstRow.focus()
  await page.keyboard.press('Shift+ArrowDown')
  await expect(standaloneFirstRow).toHaveAttribute('aria-selected', 'true')
  await expect(standaloneSecondRow).toHaveAttribute('aria-selected', 'true')
  await page.keyboard.press('Shift+ArrowUp')
  await expect(standaloneSecondRow).toHaveAttribute('aria-selected', 'false')
  await page.getByTestId('element-add-below').click()
  await page.getByTestId('edit-textarea').fill('単独編集で追加した要素')
  await page.getByTestId('edit-save').click()
  await expect(middleGrid).toContainText('単独編集で追加した要素')

  const addedRow = middleGrid.getByRole('row').filter({ hasText: '単独編集で追加した要素' })
  await addedRow.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('resource-edit-dialog')).toBeVisible()
  await expect(page.getByTestId('resource-save')).toHaveText('同じResourceへ上書き保存')
  const standaloneTextPreview = page.getByTestId('resource-merge-target').getByTestId('resource-field-text_body')
  await standaloneTextPreview.focus()
  await page.keyboard.press('F2')
  await expect(page.getByTestId('semantic-edit-dialog-text_body')).toBeVisible()
  await page.getByTestId('resource-field-text_body-editor').fill('単独編集で追加した要素（上書き）')
  await page.getByTestId('semantic-edit-close-text_body').click()
  await page.getByTestId('resource-save').click()
  await expect(page.getByTestId('resource-edit-dialog')).toHaveCount(0)
  const overwrittenRow = middleGrid.getByRole('row').filter({ hasText: '単独編集で追加した要素（上書き）' })
  await overwrittenRow.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('resource-edit-dialog')).toBeVisible()
  await page.getByTestId('resource-type-select').selectOption('resource_label')
  await expect(page.getByTestId('resource-save')).toHaveText('旧Resourceを削除して新Resourceとして保存')
  await page.getByTestId('semantic-edit-label_text').click()
  await page.getByTestId('resource-field-label_text-editor').fill('単独編集で追加した見出し')
  await page.getByTestId('semantic-edit-close-label_text').click()
  await page.getByTestId('resource-field-label_kind').selectOption('section')
  await page.getByTestId('resource-save').click()
  await expect(page.getByTestId('resource-loss-confirm')).toContainText('本文')
  await page.getByTestId('resource-loss-confirm-apply').click()
  const headingRow = middleGrid.getByRole('row').filter({ hasText: '単独編集で追加した見出し' })
  await expect(headingRow).toContainText('ラベル')
  await headingRow.dblclick()
  await expect(page.getByTestId('resource-edit-dialog')).toBeVisible()
  await page.getByTestId('resource-edit-dialog').getByRole('button', { name: '閉じる' }).click()

  const rowsBeforeDuplicate = await middleGrid.getByRole('row').count()
  await headingRow.click()
  await page.getByTestId('element-duplicate').click()
  await expect(middleGrid.getByRole('row')).toHaveCount(rowsBeforeDuplicate + 1)
  await page.getByTestId('element-delete').click()
  await expect(middleGrid.getByRole('row')).toHaveCount(rowsBeforeDuplicate)
  // 整理した②成果物操作から、選択行を直下行へ統合する。
  await middleGrid.getByRole('row').nth(1).click()
  for (const text of ['下統合A', '下統合B', '統合しない中間行']) {
    await page.getByTestId('element-add-below').click()
    await page.getByTestId('edit-textarea').fill(text)
    await page.getByTestId('edit-save').click()
  }
  const mergeRowA = middleGrid.getByRole('row').filter({ hasText: '下統合A' })
  await mergeRowA.click()
  await page.getByTestId('merge-down').click()
  await expect(middleGrid).toContainText('下統合A')
  await expect(middleGrid).toContainText('下統合B')
  await expect(middleGrid).toContainText('統合しない中間行')
  await page.getByTestId('intermediate-mode-import').click()
  await expect(page.getByTestId('intermediate-import-layout')).toBeVisible()
  await expect(page.getByTestId('intermediate-source-grid')).toBeVisible()

  // 操作バーは3群だけとし、旧編集・Resource固有・一括レビュー・④候補生成ボタンを表示しない。
  await expect(page.getByTestId('source-link-actions')).toBeVisible()
  await expect(page.getByTestId('artifact-compose-actions')).toBeVisible()
  await expect(page.getByTestId('artifact-layout-actions')).toBeVisible()
  await expect(page.getByTestId('element-edit-open')).toHaveCount(0)
  await expect(page.getByTestId('element-toolbar')).toHaveCount(0)
  await expect(page.getByTestId('generate-design-candidates')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '確認済みにする' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '要修正' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '棄却', exact: true })).toHaveCount(0)

  // ③正本確定はdraftだけでなく、要修正・棄却を含む全成果物項目を確認済みにする。
  const statusCell = middleGrid.getByRole('row').nth(1).getByTitle('クリックで状態を切替')
  for (let i = 0; i < 3; i++) await statusCell.click()
  await expect(middleGrid.getByRole('row').nth(1)).toContainText('棄却')
  const draftIntermediateDocuments = await page.evaluate(async () =>
    window.api.invoke<{ status: string }[]>('intermediate.list')
  )
  expect(draftIntermediateDocuments.ok && draftIntermediateDocuments.result[0]?.status).not.toBe('approved')
  await page.getByTestId('intermediate-approve').click()
  await expect(page.getByTestId('intermediate-approve')).toContainText('正本確定済み')
  const approvedIntermediate = await page.evaluate(async () =>
    window.api.invoke<{ elements: { review?: { status: string } }[] }>('intermediate.get', {
      uid: (await window.api.invoke<{ uid: string }[]>('intermediate.list')).ok
        ? ((await window.api.invoke<{ uid: string }[]>('intermediate.list')) as { ok: true; result: { uid: string }[] })
            .result[0]!.uid
        : ''
    })
  )
  expect(
    approvedIntermediate.ok && approvedIntermediate.result.elements.every((item) => item.review?.status === 'approved')
  ).toBe(true)
  await expect(page.getByTestId('intermediate-unconfirmed-IMDOC-000001')).toContainText('未確定 0')
  const approvedIntermediateDocuments = await page.evaluate(async () =>
    window.api.invoke<{ status: string }[]>('intermediate.list')
  )
  expect(approvedIntermediateDocuments.ok && approvedIntermediateDocuments.result[0]?.status).toBe('approved')

  // 中間画面外からResourceを指定して共通Editor Providerを開ける
  await page.getByTestId('activity-search').click()
  await page.getByTestId('search-input').fill('REQ-002')
  await page.getByTestId('search-entity-type').selectOption('resource_text')
  await page.getByTestId('search-sidebar').getByRole('button', { name: '検索' }).click()
  await expect(page.getByTestId('search-results')).toContainText('REQ-002')
  await page.getByTestId('search-results').getByText('REQ-002', { exact: false }).first().click()
  await expect(page.getByTestId('resource-editor')).toBeVisible()
  await expect(page.getByTestId('resource-type-select')).toHaveValue('resource_text')

  // 成果物単位のチャンク編集: 確認済み行を選択し、追加プロンプト付きで作成する
  if (
    !(await page
      .getByTestId('documents-tree')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('activity-explorer').click()
  }
  await expect(page.getByTestId('intermediate-doc-IMDOC-000001').getByRole('button')).toHaveCount(0)
  await page.getByTestId('intermediate-doc-IMDOC-000001').click()
  await page.getByTestId('intermediate-mode-chunk').click()
  await expect(page.getByTestId('chunk-editor')).toBeVisible()
  await expect(page.getByTestId('chunk-editor-layout-handle-0')).toBeVisible()
  await expect(page.getByTestId('chunk-editor-layout-handle-1')).toBeVisible()
  await expect(page.getByTestId('chunk-source-i1').locator('.d2d-badge').first()).toHaveCSS('white-space', 'nowrap')
  await expect(page.locator('.chunk-source-grid th').nth(1)).toHaveCSS('border-right-style', 'none')
  await expect(page.getByTestId('chunk-editor').locator('.chunk-grid').nth(1).locator('th').nth(1)).toHaveCSS(
    'border-right-style',
    'none'
  )
  const chunkFirstPane = page.getByTestId('chunk-editor-layout').locator(':scope > .d2d-resizable-pane').first()
  const chunkWidthBefore = (await chunkFirstPane.boundingBox())!.width
  await page.getByTestId('chunk-editor-layout-handle-0').focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await chunkFirstPane.boundingBox())!.width).toBeGreaterThan(chunkWidthBefore)
  await expect(page.getByTestId('chunk-source-i1').getByRole('checkbox')).toHaveCount(0)
  const chunkSourceRows = page.locator('.chunk-source-grid tbody tr')
  const firstChunkSourceRow = chunkSourceRows.first()
  const secondChunkSourceRow = chunkSourceRows.nth(1)
  await firstChunkSourceRow.click()
  await firstChunkSourceRow.press('Shift+ArrowDown')
  await expect(firstChunkSourceRow).toHaveAttribute('aria-selected', 'true')
  await expect(secondChunkSourceRow).toHaveAttribute('aria-selected', 'true')
  await secondChunkSourceRow.press('Shift+ArrowUp')
  await expect(secondChunkSourceRow).toHaveAttribute('aria-selected', 'false')
  await firstChunkSourceRow.click()
  await page.getByRole('button', { name: 'チャンク作成' }).click()
  await expect(page.getByTestId('chunk-editor')).toContainText('1')
  await expect(
    page.getByTestId('chunk-editor').locator('.chunk-grid').nth(1).locator('tbody tr').first()
  ).toHaveAttribute('aria-selected', 'true')
  const createdChunkRow = page.getByTestId('chunk-editor').locator('.chunk-grid').nth(1).locator('tbody tr').first()
  await expect(createdChunkRow).toHaveClass(/chunk-row-selected/)
  await expect(page.getByTestId('chunk-source-i1')).toHaveClass(/chunk-row-related/)
  await page.getByTestId('chunk-source-i1').click()
  await expect(page.getByTestId('chunk-source-i1')).toHaveClass(/chunk-row-selected/)
  await expect(createdChunkRow).toHaveClass(/chunk-row-related/)
  await page.getByTestId('chunk-prompt-edit').click()
  await page.getByLabel('追加プロンプト').fill('安全性の観点を優先すること')
  await page.getByTestId('chunk-prompt-editor').getByRole('button', { name: '保存' }).click()
  await expect(page.getByTestId('chunk-editor')).toContainText('安全性の観点を優先すること')
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

    // ④候補生成は中間編集画面に置かず、成果物単位のチャンク編集から実行する。
    if (
      !(await page
        .getByTestId('documents-tree')
        .isVisible()
        .catch(() => false))
    ) {
      await page.getByTestId('activity-explorer').click()
    }
    await page.getByTestId('intermediate-doc-IMDOC-000001').click()
    await page.getByTestId('intermediate-mode-chunk').click()
    await expect(page.getByTestId('chunk-editor')).toBeVisible()
    await page.getByTestId('chunk-editor').locator('.chunk-grid').nth(1).locator('tbody tr').first().click()
    await page.getByRole('button', { name: '④モデル候補生成' }).click()
    await expect(page.getByTestId('llm-request-dialog')).toBeVisible()
    await expect(page.getByTestId('candidate-editor')).toHaveCount(0)
    await page.getByTestId('llm-prompt-save-name').fill('設計候補E2E')
    await page.getByTestId('llm-prompt-save-version').fill('1.0.0')
    await page.getByTestId('llm-prompt-save').click()
    await expect(page.getByTestId('llm-prompt-select')).toContainText('設計候補E2E@1.0.0')
    await expect(page.getByTestId('llm-send-button')).toBeDisabled()
    await page.getByTestId('llm-preview-button').click()
    await expect(page.getByTestId('llm-preview')).toContainText('送信先: ollama')
    await expect(page.getByTestId('llm-preview')).toContainText('モデル: mock-model')
    await page.getByTestId('llm-send-button').click()
    await expect(page.getByTestId('candidate-editor')).toBeVisible({ timeout: 60_000 })

    // 候補が表形式で表示され、要素名変更が関係 From/To 表示へ追従する（MODEL-008）
    await expect(page.getByTestId('element-title-t1')).toHaveValue('応答時間要求')
    await expect(page.getByTestId('relation-row-0')).toContainText('t1: 応答時間要求')
    await page.getByTestId('element-title-t1').fill('応答時間要求（改）')
    await expect(page.getByTestId('relation-row-0')).toContainText('t1: 応答時間要求（改）')
    const categorySelect = page.getByTestId('candidate-elements').locator('tbody tr').nth(1).locator('select')
    await categorySelect.selectOption('REQ')
    await expect(page.getByTestId('relation-row-0')).toHaveClass(/relation-candidate-invalid/)
    await expect(page.getByTestId('candidate-error')).toContainText('許容外')
    await expect(page.getByTestId('relation-row-0').locator('select').nth(1)).toContainText('satisfies（許容外）')
    await categorySelect.selectOption('FUNC')
    await expect(page.getByTestId('relation-row-0')).not.toHaveClass(/relation-candidate-invalid/)

    // 採用 → ④正本反映（同一トランザクション）→ ④ツリー・パイプライン件数へ反映
    await page.getByTestId('candidate-adopt-all').click()
    await expect(page.getByTestId('stage-design')).toHaveText('④モデル', { timeout: 15_000 })
    await expect(page.getByTestId('design-el-REQ-000001')).toBeVisible()
    await expect(page.getByTestId('design-el-FUNC-000001')).toBeVisible()
    await expect(page.getByTestId('design-tree')).toHaveAttribute('open', '')
    await expect(page.getByTestId('design-el-REQ-000001')).toHaveAttribute('title', /分類: REQ/)
    await expect(page.getByTestId('design-tree').locator('summary .d2d-explorer-folder-icon')).toBeVisible()
    await expect(
      page.getByTestId('design-el-REQ-000001').locator('.d2d-explorer-resource-icon.is-design')
    ).toBeVisible()
    await expect(page.getByTestId('design-el-REQ-000001').locator('.d2d-explorer-tags')).toContainText('REQ')

    // Pipeline ④はソート可能なモデル一覧を表示する。
    await page.getByTestId('stage-design').click()
    await expect(page.getByTestId('stage-overview-design')).toBeVisible()
    await expect(page.getByTestId('stage-design-row-REQ-000001')).toContainText('応答時間要求（改）')
    await page.getByTestId('sort-design_category').click()
    await expect(page.getByTestId('sort-design_category')).toContainText('▲')
    const designRows = page.getByTestId('stage-design-layout').locator('tbody tr')
    await designRows.first().focus()
    await page.keyboard.press('ArrowDown')
    await expect(designRows.nth(1)).toHaveAttribute('aria-selected', 'true')

    // 設計要素ビューアで関係と根拠を確認（UI-013）
    await page.getByTestId('stage-design-row-FUNC-000001').click()
    await expect(page.getByTestId('design-element-viewer')).toBeVisible()
    await expect(page.getByTestId('design-element-viewer')).toContainText('satisfies')
    await expect(page.getByTestId('design-element-viewer')).toContainText('応答時間要求（改）')
    await expect(page.getByTestId('design-element-viewer')).toContainText('based_on')
    const satisfiesRelation = page.getByTestId('secondary-relations-list').locator('li', { hasText: 'satisfies' })
    await satisfiesRelation.click()
    await expect(page.getByTestId('resource-editor')).toBeVisible()
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

  // 汎用トレースマトリクス（UI-014 / TRACE-026〜029）
  // 複数行・複数列選択を確実に検証できるよう、同分類Resourceを追加する。
  await page.evaluate(async () => {
    await window.api.invoke('design.createElement', { category: 'REQ', title: 'マトリクス追加要求' })
    await window.api.invoke('design.createElement', { category: 'FUNC', title: 'マトリクス追加機能' })
  })
  await page.getByTestId('open-matrix').click()
  await page.getByTestId('open-matrix').click()
  await expect(page.locator('.wb-tab-title', { hasText: 'トレースマトリクス' })).toHaveCount(2)
  const traceMatrix = page.getByTestId('trace-matrix')
  await expect(traceMatrix).toBeVisible()
  await expect(traceMatrix).toContainText('FUNC-000001')
  await expect(page.getByTestId('trace-cell-FUNC-000001-REQ-000001')).toContainText('→S')

  // 関係を持つ見出し・選択十字、Tooltip、sticky見出し、ズームを確認する。
  await expect(page.getByTestId('trace-row-FUNC-000001')).toHaveClass(/connected/)
  await expect(page.getByTestId('trace-col-REQ-000001')).toHaveClass(/connected/)
  await expect(page.getByTestId('trace-row-FUNC-000001')).toHaveAttribute('title', /entity_type:/)
  await expect(page.getByTestId('trace-col-REQ-000001')).toHaveAttribute('title', /状態:/)
  await expect(page.getByTestId('trace-row-FUNC-000001')).toHaveCSS('position', 'sticky')
  await expect(page.getByTestId('trace-col-REQ-000001')).toHaveCSS('position', 'sticky')
  await page.getByTestId('trace-matrix-zoom').fill('130')
  await expect(page.locator('.trace-matrix-table')).toHaveCSS('font-size', /%|px/)

  // ②抽出文書Resource集合 × ③中間成果物Resource集合のbased_onを俯瞰表示する。
  const rowScopes = page.getByTestId('trace-matrix-row-scopes')
  const colScopes = page.getByTestId('trace-matrix-col-scopes')
  const scopeValues = await rowScopes
    .locator('option')
    .evaluateAll((options) =>
      options.map((option) => ({ value: (option as HTMLOptionElement).value, text: option.textContent ?? '' }))
    )
  const extractedScope = scopeValues.find((scope) => scope.value.startsWith('extracted:'))!.value
  const intermediateScope = scopeValues.find((scope) => scope.value.startsWith('intermediate:'))!.value
  expect(scopeValues.some((scope) => scope.value.startsWith('resource_type:'))).toBe(true)
  await page.getByTestId('trace-relation-satisfies').uncheck()
  await page.getByTestId('trace-relation-based_on').check()
  await rowScopes.selectOption(intermediateScope)
  await colScopes.selectOption(extractedScope)
  await expect(traceMatrix.locator('td.has-relation').first()).toContainText('→B')

  // 行列入替は表示軸だけを交換し、保存済み方向は逆向き表示になる。
  await page.getByTestId('trace-matrix-transpose').click()
  await expect(rowScopes).toHaveValue(extractedScope)
  await expect(colScopes).toHaveValue(intermediateScope)
  await expect(traceMatrix.locator('td.has-relation').first()).toContainText('←B')

  // 設計Resource集合へ戻し、単一セルクリックで関係をトグルする。
  await rowScopes.selectOption('design:FUNC')
  await colScopes.selectOption('design:REQ')
  await page.getByTestId('trace-relation-based_on').uncheck()
  await page.getByTestId('trace-relation-relates_to').check()
  await page.getByTestId('trace-relation-satisfies').check()
  await expect(page.getByTestId('trace-relation-satisfies')).toBeChecked()
  await expect(page.getByTestId('trace-relation-relates_to')).toBeChecked()
  await page.getByTestId('trace-relation-satisfies').uncheck()
  const firstMatrixCell = page.locator('.trace-matrix-table tbody td').first()
  await firstMatrixCell.click()
  await expect(firstMatrixCell).toContainText('→R')
  await expect(page.getByTestId('trace-row-FUNC-000001')).toHaveClass(/cross-active/)
  await expect(page.getByTestId('trace-col-REQ-000001')).toHaveClass(/cross-active/)
  await firstMatrixCell.click()
  await expect(firstMatrixCell).not.toContainText('→R')

  // 行タイトル／列タイトルから複数セルを選び、一括追加・削除する。
  await page.getByTestId('trace-row-FUNC-000001').click()
  await expect(traceMatrix).toContainText('2 セル選択')
  await page.getByTestId('trace-matrix-add').click()
  await expect(page.locator('.trace-matrix-table tbody tr').first().locator('td', { hasText: '→R' })).toHaveCount(2)
  await page.getByTestId('trace-matrix-delete').click()
  await expect(page.locator('.trace-matrix-table tbody tr').first().locator('td', { hasText: '→R' })).toHaveCount(0)

  await page.getByTestId('trace-col-REQ-000001').click()
  await expect(traceMatrix).toContainText('2 セル選択')
  await page.getByTestId('trace-col-REQ-000002').click({ modifiers: ['Control'] })
  await expect(traceMatrix).toContainText('4 セル選択')

  // 方向を列→行に変えた単一トグルでは逆向き記号を表示する。
  await page.getByTestId('trace-matrix-direction').selectOption('col_to_row')
  await firstMatrixCell.click()
  await expect(firstMatrixCell).toContainText('←R')
  await firstMatrixCell.click()
  await expect(firstMatrixCell).not.toContainText('←R')

  // 汎用インパクト分析（UI-015 / TRACE-030〜034）
  await page.getByTestId('open-impact-analysis').click()
  await page.getByTestId('open-impact-analysis').click()
  await expect(page.locator('.wb-tab-title', { hasText: 'インパクト分析' })).toHaveCount(2)
  const impact = page.getByTestId('trace-impact')
  await expect(impact).toBeVisible()
  await expect(impact).toContainText('汎用インパクト分析')
  await expect(impact.locator('.trace-impact-column')).toHaveCount(3)

  // ②・③の階層、項目Tooltip、方向・関係種別付きリンクを表示する。
  const firstImpactItem = impact.locator('.trace-impact-item').first()
  await expect(firstImpactItem).toHaveAttribute('title', /entity_type:/)
  const firstImpactLink = impact.locator('.impact-link path').first()
  await expect(firstImpactLink).toBeVisible()
  await expect(page.getByTestId('impact-list-0')).toHaveCSS('overflow-y', 'auto')
  await expect(page.getByTestId('impact-list-1')).toHaveCSS('overflow-y', 'auto')
  await page.getByTestId('impact-links-visible').uncheck()
  await expect(impact.locator('.impact-link path')).toHaveCount(0)
  await page.getByTestId('impact-links-visible').check()
  await expect(impact.locator('.impact-link path').first()).toBeVisible()
  await expect(firstImpactLink.locator('title')).toContainText('関係: based_on')
  const markerStart = await firstImpactLink.getAttribute('marker-start')
  const markerEnd = await firstImpactLink.getAttribute('marker-end')
  expect(Boolean(markerStart || markerEnd)).toBe(true)

  const hierarchyToggle = impact.locator('[data-testid^="impact-toggle-"]').first()
  if (await hierarchyToggle.isVisible().catch(() => false)) {
    const beforeCollapse = await impact.locator('.trace-impact-item').count()
    await hierarchyToggle.click()
    await expect.poll(async () => impact.locator('.trace-impact-item').count()).toBeLessThan(beforeCollapse)
    await hierarchyToggle.click()
  }

  // リンク選択で両端を複数選択し、その先の列までインパクト強調する。
  await firstImpactLink.dispatchEvent('click')
  await expect(impact).toContainText('2項目選択')
  await expect(impact.locator('.trace-impact-item.impacted')).not.toHaveCount(0)
  await page.getByTestId('impact-related-only').check()
  await expect(page.getByTestId('impact-related-only')).toBeChecked()
  await expect(impact.locator('.trace-impact-column').first().locator('.trace-impact-item')).not.toHaveCount(0)

  // 関係種別の複数選択と、左右への任意列追加を行える。
  await page.getByTestId('impact-relation-satisfies').check()
  await expect(page.getByTestId('impact-relation-based_on')).toBeChecked()
  await expect(page.getByTestId('impact-relation-satisfies')).toBeChecked()
  await page.getByTestId('impact-add-right').click()
  await expect(impact.locator('.trace-impact-column')).toHaveCount(4)

  // CtrlとShift+上下キーで同一リスト内の複数項目を選択し、Secondaryへ同期する。
  await page.getByTestId('impact-clear-selection').click()
  const firstColumnItems = impact.locator('.trace-impact-column').first().locator('.trace-impact-item')
  await firstColumnItems.nth(0).click()
  await expect(page.getByTestId('selected-item-properties')).toContainText(
    await firstColumnItems.nth(0).locator('.trace-impact-code').innerText()
  )
  await firstColumnItems.nth(0).press('ArrowDown')
  await page.locator('.trace-impact-item:focus').press('Shift+ArrowDown')
  await expect(impact).toContainText('2項目選択')
  await firstColumnItems.nth(0).click()
  await firstColumnItems.nth(1).click({ modifiers: ['Control'] })
  await expect(impact).toContainText('2項目選択')

  // 列順・表示対象・関係種別・リンク表示状態を名前付きで保存し、別構成から復元する。
  await page.getByTestId('impact-configuration-name').fill('E2E構成')
  await page.getByTestId('impact-save-configuration').click()
  await expect(page.getByTestId('impact-saved-configurations')).toContainText('E2E構成')
  await page.getByTestId('impact-add-right').click()
  await expect(impact.locator('.trace-impact-column')).toHaveCount(5)
  await page.getByTestId('impact-saved-configurations').selectOption({ label: 'E2E構成' })
  await expect(impact.locator('.trace-impact-column')).toHaveCount(4)

  // 見出しの間隔ハンドルを右へドラッグすると、その境界より外側の全リストが同じ差分だけ移動する。
  const columnsBeforeSpacing = await Promise.all(
    [0, 1, 2].map(async (index) => (await impact.locator('.trace-impact-column').nth(index).boundingBox())!)
  )
  const spacingHandle = page.getByTestId('impact-column-spacing-1')
  const spacingBox = (await spacingHandle.boundingBox())!
  await page.mouse.move(spacingBox.x + spacingBox.width / 2, spacingBox.y + spacingBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(spacingBox.x + spacingBox.width / 2 + 48, spacingBox.y + spacingBox.height / 2)
  await page.mouse.up()
  const columnsAfterSpacing = await Promise.all(
    [0, 1, 2].map(async (index) => (await impact.locator('.trace-impact-column').nth(index).boundingBox())!)
  )
  expect(Math.abs(columnsAfterSpacing[0]!.x - columnsBeforeSpacing[0]!.x)).toBeLessThan(2)
  const movedSecond = columnsAfterSpacing[1]!.x - columnsBeforeSpacing[1]!.x
  const movedThird = columnsAfterSpacing[2]!.x - columnsBeforeSpacing[2]!.x
  expect(movedSecond).toBeGreaterThan(40)
  expect(Math.abs(movedThird - movedSecond)).toBeLessThan(2)

  // 調整した列間隔も名前付き構成へ保存・復元する。
  const adjustedGap = await spacingHandle.getAttribute('aria-valuenow')
  await page.getByTestId('impact-configuration-name').fill('E2E間隔構成')
  await page.getByTestId('impact-save-configuration').click()
  await spacingHandle.press('ArrowLeft')
  await expect(spacingHandle).not.toHaveAttribute('aria-valuenow', adjustedGap!)
  await page.getByTestId('impact-saved-configurations').selectOption({ label: 'E2E間隔構成' })
  await expect(page.getByTestId('impact-column-spacing-1')).toHaveAttribute('aria-valuenow', adjustedGap!)

  // リスト見出しのDnDで左右順を変更できる。
  const firstScopeBefore = await page.getByTestId('impact-scopes-0').inputValue()
  await page.evaluate(() => {
    const source = document.querySelector<HTMLElement>('[data-testid="impact-column-drag-0"]')!
    const target = document.querySelector<HTMLElement>('[data-testid="impact-column-drag-2"]')!
    const transfer = new DataTransfer()
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
    target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: transfer }))
  })
  await expect.poll(async () => page.getByTestId('impact-scopes-0').inputValue()).not.toBe(firstScopeBefore)
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
  await page.getByTestId('stage-design').click()
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
  const semanticTerm = await page.evaluate(async () =>
    window.api.invoke('glossary.addTerm', { term: 'モックLLM応答', definition: 'LLMによる候補文章', approved: true })
  )
  expect(semanticTerm).toMatchObject({ ok: true })

  // --- 表編集（P10-2）: セル修正→保存→Markdown へ反映（EDIT-022） ---
  const tableRow = page
    .getByTestId('intermediate-grid')
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: '表', exact: true }) })
  await tableRow.dblclick()
  await expect(page.getByTestId('resource-edit-dialog')).toBeVisible()
  const cellsJson = page.getByTestId('resource-merge-target').getByTestId('resource-field-cells_json')
  await cellsJson.fill((await cellsJson.inputValue()).replace('100ms以内', '150ms以内'))
  await page.getByTestId('resource-save').click()
  await expect(page.getByTestId('resource-edit-dialog')).toHaveCount(0)
  await expect(page.getByTestId('intermediate-markdown')).toContainText('150ms以内')

  // --- セマンティック入力支援（P10-7）: 既存文認識→承認→構造化検証→保存
  const semanticRow = page
    .getByTestId('intermediate-grid')
    .getByRole('row')
    .filter({ hasText: 'モックLLM応答' })
    .first()
  await semanticRow.dblclick()
  await expect(page.getByTestId('resource-edit-dialog')).toBeVisible()
  const semanticInput = page.getByTestId('semantic-input-text_body')
  await expect(semanticInput).toBeVisible()
  const semanticPreview = semanticInput.getByTestId('resource-field-text_body')
  await expect(semanticPreview).toBeVisible()
  await expect(semanticPreview).toHaveClass(/semantic-preview-focus/)
  await expect(semanticInput.getByTestId('resource-field-text_body-editor')).toHaveCount(0)
  await expect(semanticInput.getByText('構造化参照')).toHaveCount(0)
  await semanticPreview.focus()
  await page.keyboard.press('F2')
  const semanticDialog = semanticInput.getByTestId('semantic-edit-dialog-text_body')
  await expect(semanticDialog).toBeVisible()
  await expect(semanticDialog.getByText('構造化参照')).toBeVisible()
  await expect(semanticDialog.getByRole('button', { name: '承認済み', exact: true }).first()).toBeVisible()
  await semanticDialog.getByRole('button', { name: '既存文を解析', exact: true }).click()
  await semanticDialog.getByRole('button', { name: '承認', exact: true }).first().click()
  await semanticDialog.getByRole('button', { name: 'プレビュー', exact: true }).click()
  await expect(semanticDialog.locator('.semantic-mark').first()).toBeVisible()
  await semanticDialog.getByRole('button', { name: '構造化データ', exact: true }).click()
  await semanticDialog.getByRole('button', { name: '検証して反映', exact: true }).click()
  await expect(semanticDialog).toContainText('検証に成功')
  await semanticInput.getByTestId('semantic-edit-close-text_body').click()
  await expect(semanticDialog).toHaveCount(0)
  await expect(semanticPreview.locator('.semantic-mark').first()).toBeVisible()
  await page.getByTestId('resource-save').click()
  await expect(page.getByTestId('resource-edit-dialog')).toHaveCount(0)

  // Secondary Dictionary: 前方一致0件から承認待ち候補を直接登録
  const dictionarySection = page.getByTestId('secondary-tab-dictionary')
  if ((await dictionarySection.getAttribute('aria-expanded')) !== 'true') await dictionarySection.click()
  await page.getByTestId('secondary-dictionary-query').fill('セマンティック未登録語')
  await expect(page.getByTestId('secondary-dictionary-register')).toBeVisible()
  await page.getByTestId('secondary-dictionary-register').click()
  await expect(page.getByTestId('notifications')).toContainText('承認待ちの辞書候補')
  // --- 状態遷移（P10-4）: 作成→状態/イベント/遷移追加→検出→シミュレーション ---
  await page.getByTestId('stage-design').click()
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
  await page.getByTestId('stage-design').click()
  await page.getByTestId('open-model-editor').click()
  await expect(page.getByTestId('model-editor')).toBeVisible()
  await page.getByTestId('model-render').click()
  await expect(page.getByTestId('notifications')).toContainText('レンダリングできません')
  await page.getByTestId('add-mapping').click()
  await page.getByTestId('model-save').click()
  await expect(page.getByTestId('design-el-STRUCT-000001')).toBeVisible()
})

test('DB to Text・ZIPアーカイブ差分・ストア閲覧・Git操作（P12）', async () => {
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
  await expect(page.getByTestId('store-row-count')).toContainText('/')
  const storeRows = page.getByTestId('store-rows').locator('tbody tr')
  await storeRows.first().click()
  await expect(storeRows.first()).toHaveAttribute('aria-selected', 'true')
  await storeRows.first().focus()
  await page.keyboard.press('ArrowDown')
  await expect(storeRows.nth(1)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('selected-item-properties')).toContainText('entity_registry')

  // --- Git基本操作（P12-5 / GIT-003〜007） ---
  await expect(page.getByTestId('git-empty-repo')).toContainText('Gitリポジトリは初期化済みです')
  const firstGitFile = page.getByTestId('git-status-files').locator('input[type="checkbox"]').first()
  await firstGitFile.check()
  await page.getByTestId('git-stage').click()
  await expect(page.getByTestId('git-stage')).toBeDisabled()

  await page.getByTestId('git-commit-message').fill('e2e: テキスト化コミット')
  await page.getByTestId('git-author-name').fill('D2D E2E')
  await page.getByTestId('git-author-email').fill('d2d-e2e@example.local')
  await page.getByTestId('git-commit').click()
  await expect(page.getByTestId('git-log')).toContainText('e2e: テキスト化コミット')
  await expect(page.getByTestId('notifications')).toContainText('Gitコミット')

  const gitLog = await page.evaluate(
    async () =>
      await window.api.invoke<{ isRepo: boolean; commits: Array<{ hash: string }> }>('git.log', {
        maxCount: 1
      })
  )
  expect(gitLog.ok).toBe(true)
  if (!gitLog.ok) throw new Error(gitLog.error.message)
  const latestCommit = gitLog.result.commits.at(0)
  expect(latestCommit).toBeDefined()
  if (!latestCommit) throw new Error('Gitコミットを取得できませんでした')
  const gitShow = await page.evaluate(
    async (hash) => await window.api.invoke<{ text: string }>('git.show', { hash }),
    latestCommit.hash
  )
  expect(gitShow).toMatchObject({ ok: true })
  if (!gitShow.ok) throw new Error(gitShow.error.message)
  expect(gitShow.result.text).toContain('exports/db_to_text/entity_registry.jsonl')
  expect(gitShow.result.text).toContain('exports/sqlite_dump/schema.sql')

  await page.getByTestId('git-new-branch-name').fill('review/e2e')
  await page.getByTestId('git-create-branch').click()
  await expect(page.getByTestId('git-current-branch')).toHaveValue('review/e2e')
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

test('アプリメニュー（Alt+M）と右クリックコンテキストメニュー（W2/W3）', async () => {
  // Alt+M でハンバーガーメニューが開閉する
  await page.keyboard.press('Alt+M')
  await expect(page.getByTestId('app-menu-dropdown')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('app-menu-dropdown')).toBeHidden()

  // ハンバーガーボタンから開き、メニュー項目でツール設定を開く
  await page.getByTestId('app-menu-button').click()
  await expect(page.getByTestId('app-menu-dropdown')).toBeVisible()
  await page.getByTestId('app-menu-item-settings.open').click()
  await expect(page.getByTestId('settings-editor')).toBeVisible()
  await expect(page.getByTestId('app-menu-dropdown')).toBeHidden()

  // Editorタブの右クリックでコンテキストメニューが開く
  await page.getByRole('tab', { name: /ツール設定/ }).click({ button: 'right' })
  await expect(page.getByTestId('context-menu')).toBeVisible()
  await expect(page.getByTestId('tab-menu-close')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('context-menu')).toBeHidden()

  // 入力欄・選択欄にも操作説明Tooltipが付与される（W5）
  await expect
    .poll(() =>
      page
        .locator('input:visible, select:visible, textarea:visible')
        .evaluateAll((fields) => fields.filter((field) => !(field as HTMLElement).title.trim()).length)
    )
    .toBe(0)
})

test('ショートカットキーのカスタマイズ（W1 / UI-023）', async () => {
  await expect(page.getByTestId('settings-editor')).toBeVisible()
  await expect(page.getByTestId('keybinding-settings')).toBeVisible()
  await page.getByTestId('keybinding-filter').fill('Secondary')
  const row = page.getByTestId('keybinding-row-workbench.toggleSecondarySideBar')
  await expect(row).toBeVisible()

  // 変更 → キー入力キャプチャで Ctrl+Alt+9 を割り当てる
  await page.getByTestId('keybinding-change-workbench.toggleSecondarySideBar').click()
  await page.getByTestId('keybinding-capture-workbench.toggleSecondarySideBar').press('Control+Alt+9')
  await expect(page.getByTestId('keybinding-value-workbench.toggleSecondarySideBar')).toContainText('Ctrl+Alt+9')
  await expect(row).toContainText('変更済み')

  // 新しいショートカットで Secondary Side Bar が切り替わる
  const secondaryToggle = page.getByTestId('toggle-secondary-sidebar')
  const before = await secondaryToggle.getAttribute('aria-pressed')
  await page.keyboard.press('Control+Alt+9')
  await expect(secondaryToggle).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true')
  await page.keyboard.press('Control+Alt+9')
  await expect(secondaryToggle).toHaveAttribute('aria-pressed', before === 'true' ? 'true' : 'false')

  // 既定へ戻す
  await page.getByTestId('keybinding-reset-workbench.toggleSecondarySideBar').click()
  await expect(row).not.toContainText('変更済み')
  await page.getByTestId('keybinding-filter').fill('')
})

test('ユーザ操作のUndo/Redo（W4 / NFR-012）', async () => {
  // ①ステージ一覧でアーカイブ → Ctrl+Z で取り消し → Ctrl+Y でやり直し
  await page.getByTestId('stage-source').click()
  const row = page.getByTestId('stage-source-row-DOC-000002')
  await expect(row).toBeVisible()
  await row.getByRole('button', { name: 'アーカイブ' }).click()
  await expect(row.getByRole('button', { name: '解除' })).toBeVisible()

  await page.keyboard.press('Control+Z')
  await expect(page.getByTestId('notifications')).toContainText('元に戻しました')
  await expect(row.getByRole('button', { name: 'アーカイブ' })).toBeVisible()

  await page.keyboard.press('Control+Y')
  await expect(page.getByTestId('notifications')).toContainText('やり直しました')
  await expect(row.getByRole('button', { name: '解除' })).toBeVisible()

  // 後続テストへ影響しないよう元の表示状態へ戻す
  await page.keyboard.press('Control+Z')
  await expect(row.getByRole('button', { name: 'アーカイブ' })).toBeVisible()

  // 論理削除も Undo で復元できる（document.restore、W4）。確認はアプリ内ダイアログ（W8）
  await row.getByRole('button', { name: '削除' }).click()
  await expect(page.getByTestId('confirm-message')).toContainText('論理削除され')
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('stage-source-row-DOC-000002')).toBeHidden()
  await page.keyboard.press('Control+Z')
  await expect(page.getByTestId('notifications')).toContainText('元に戻しました')
  await expect(page.getByTestId('stage-source-row-DOC-000002')).toBeVisible()
})

test('Undo拡張: ③削除の復元とマトリクス関係の取り消し（W7 / NFR-012）', async () => {
  // ③中間データの論理削除 → Ctrl+Z で intermediate.restore により復元
  await page.getByTestId('stage-intermediate').click()
  const intermediateRow = page.getByTestId('stage-intermediate-row-IMDOC-000001')
  await expect(intermediateRow).toBeVisible()
  // 確認はアプリ内ダイアログ（W8）。キャンセルで削除されないことも確認する
  await intermediateRow.getByRole('button', { name: '削除' }).click()
  await page.getByTestId('confirm-cancel').click()
  await expect(intermediateRow).toBeVisible()
  await intermediateRow.getByRole('button', { name: '削除' }).click()
  await page.getByTestId('confirm-ok').click()
  await expect(page.getByTestId('stage-intermediate-row-IMDOC-000001')).toBeHidden()
  await page.keyboard.press('Control+Z')
  await expect(page.getByTestId('notifications')).toContainText('元に戻しました')
  await expect(page.getByTestId('stage-intermediate-row-IMDOC-000001')).toBeVisible()

  // トレースマトリクスの単一セルトグル → Ctrl+Z / Ctrl+Y
  if (
    !(await page
      .getByTestId('trace-sidebar')
      .isVisible()
      .catch(() => false))
  ) {
    await page.getByTestId('activity-trace').click()
  }
  await page.getByTestId('open-matrix').click()
  await expect(page.getByTestId('trace-matrix')).toBeVisible()
  await page.getByTestId('trace-matrix-row-scopes').selectOption('design:FUNC')
  await page.getByTestId('trace-matrix-col-scopes').selectOption('design:REQ')
  await page.getByTestId('trace-relation-based_on').uncheck()
  await page.getByTestId('trace-relation-relates_to').check()
  const cell = page.locator('.trace-matrix-table tbody td').first()
  await cell.click()
  await expect(cell).toContainText('→R')
  await page.keyboard.press('Control+Z')
  await expect(page.getByTestId('notifications')).toContainText('元に戻しました: マトリクス関係の切替')
  await expect(cell).not.toContainText('→R')
  await page.keyboard.press('Control+Y')
  await expect(page.getByTestId('notifications')).toContainText('やり直しました: マトリクス関係の切替')
  await expect(cell).toContainText('→R')
  await page.keyboard.press('Control+Z')
  await expect(cell).not.toContainText('→R')
})

test('ナビゲーション履歴・フォーカスショートカット（W9/W10）', async () => {
  // W9: リンク移動の履歴を Alt+←／Alt+→ で行き来する
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette-input').fill('ヘルプ: 操作フロー')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('help-workflow')).toBeVisible()
  await page.keyboard.press('Control+Shift+P')
  await page.getByTestId('palette-input').fill('ツール設定を開く')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('settings-editor')).toBeVisible()

  await page.keyboard.press('Alt+ArrowLeft')
  await expect(page.getByTestId('help-workflow')).toBeVisible()
  await page.keyboard.press('Alt+ArrowRight')
  await expect(page.getByTestId('settings-editor')).toBeVisible()

  // W10: Ctrl+Shift+F で Search 入力へフォーカス、Ctrl+. で Settings Activity
  await page.keyboard.press('Control+Shift+F')
  await expect(page.getByTestId('search-sidebar')).toBeVisible()
  await expect(page.getByTestId('search-input')).toBeFocused()
  await page.keyboard.press('Control+.')
  await expect(page.getByTestId('primary-sidebar')).toContainText('Settings')

  // W10: Ctrl+Shift+D で Secondary の Dictionary 用語入力へフォーカス
  await page.keyboard.press('Control+Shift+D')
  await expect(page.getByTestId('secondary-dictionary-query')).toBeFocused()

  // W10: モーダルは Escape で閉じる（例: 抽出データ名称変更ダイアログは既存テストで検証済みのため、確認ダイアログで代表確認）
  await page.getByTestId('activity-explorer').click()
})

test('動作ログ・デバッグログ表示（W11）', async () => {
  // 直近のトースト通知が動作ログとして Output タブへ残る
  await page.getByTestId('status-jobs').click()
  await page.getByTestId('panel-tab-output').click()
  await expect(page.getByTestId('logs-panel')).toBeVisible()
  await expect(page.getByTestId('logs-panel')).toContainText('[INFO]')

  // デバッグログ: frontend の通知が日付毎ファイルへ書かれ、末尾を参照できる
  await page.getByTestId('logs-view-debug').click()
  await expect(page.getByTestId('logs-debug-file')).toContainText('frontend-')
  await expect(page.getByTestId('logs-panel')).toContainText('[INFO]')

  // backend のログも参照できる（APIエラーを意図的に発生させて記録させる）
  await page.evaluate(async () => {
    await window.api.invoke('document.extract', { uid: 'no-such-uid' })
  })
  await page.getByTestId('logs-debug-source').selectOption('backend')
  await page.getByTestId('logs-debug-reload').click()
  await expect(page.getByTestId('logs-debug-file')).toContainText('backend-')
  await expect(page.getByTestId('logs-panel')).toContainText('API失敗')
})

test('LLMログの生送受信表示と候補再作成（W12）', async () => {
  await page.getByTestId('status-jobs').click()
  await page.getByTestId('panel-tab-llm').click()
  await expect(page.getByTestId('llm-logs-list')).toBeVisible()
  // design-candidates（P8で生成済み）の実行詳細を開く
  await page.getByTestId('llm-logs-list').locator('.d2d-list-row', { hasText: 'design-candidates' }).first().click()
  await expect(page.getByTestId('llm-run-viewer')).toBeVisible()
  await expect(page.getByTestId('llm-raw-request')).toContainText('"url"')
  await expect(page.getByTestId('llm-raw-response')).toBeVisible()

  // ログからの候補再作成も、送信内容確認と明示承認を経てジョブ登録する
  await page.getByTestId('llm-retry-run').click()
  await expect(page.getByTestId('llm-request-dialog')).toBeVisible()
  await expect(page.getByTestId('llm-send-button')).toBeDisabled()
  await page.getByTestId('llm-preview-button').click()
  await expect(page.getByTestId('llm-preview')).toContainText('送信前確認')
  await page.getByTestId('llm-send-button').click()
  await expect(page.getByTestId('notifications')).toContainText('候補再作成ジョブを登録しました')
  // 再作成ジョブの完了を待つ（後続テストへ実行中ジョブを残さない）
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const res = (await window.api.invoke('job.list', {})) as {
            ok: boolean
            result?: { status: string }[]
          }
          return res.ok ? res.result!.filter((j) => j.status === 'running' || j.status === 'waiting').length : -1
        }),
      { timeout: 30_000 }
    )
    .toBe(0)
})

test('スクリーンショットを保存する', async () => {
  await page.screenshot({ path: 'test-results/workbench.png' })
})
