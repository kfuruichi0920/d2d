/**
 * 組み込み Command 登録（P3-2、sdd_ui_design §4.2/§15）。
 */
import { registerCommand, type CommandContext } from './command-registry'
import { useWorkbenchStore, WORK_MODES, type WorkMode, type PanelTab } from '../stores/workbench-store'
import { useEditorStore } from '../stores/editor-store'
import { useProjectStore } from '../stores/project-store'
import { useJobsStore } from '../stores/jobs-store'
import { invoke } from './backend'
import { COLOR_THEMES, DISPLAY_MODES } from '../theme/theme'
import { performRedo, performUndo } from './undo-service'
import { navigateBack, navigateForward } from './navigation-history'
import { OPEN_SCREEN_TEXT_SEARCH } from '../components/workbench/ScreenTextSearch'
import { DEFAULT_ACTIVITY_ORDER, type Activity } from '../stores/workbench-store'

/** サイドバー等の遅延マウントを待ってフォーカスする（W10） */
function focusWhenVisible(selector: string): void {
  let attempts = 0
  const tryFocus = (): void => {
    const element = document.querySelector<HTMLElement>(selector)
    if (element) {
      element.focus()
      if (element instanceof HTMLInputElement) element.select()
      return
    }
    if (attempts++ < 20) requestAnimationFrame(tryFocus)
  }
  requestAnimationFrame(tryFocus)
}

export function getCommandContext(): CommandContext {
  const wb = useWorkbenchStore.getState()
  const editor = useEditorStore.getState()
  const project = useProjectStore.getState()
  const jobs = useJobsStore.getState()
  return {
    workMode: wb.workMode,
    hasProject: project.project !== null,
    activeResourceUri: editor.activeUri,
    isJobRunning: jobs.runningCount > 0,
    hasDirtyEditor: editor.groups.some((g) => g.tabs.some((t) => t.dirty))
  }
}

/** アプリ起動時に一度だけ呼ぶ */
export function registerBuiltinCommands(): void {
  const wb = (): ReturnType<typeof useWorkbenchStore.getState> => useWorkbenchStore.getState()
  const editor = (): ReturnType<typeof useEditorStore.getState> => useEditorStore.getState()
  const activateAdjacentWorkbenchTab = (offset: -1 | 1): void => {
    const active = document.activeElement
    if (active instanceof HTMLElement && active.closest('[data-workbench-tab-region="panel"]')) {
      wb().activateAdjacentPanelTab(offset)
    } else {
      editor().activateAdjacentTab(offset)
    }
  }

  registerCommand({
    id: 'commandPalette.open',
    title: 'コマンドパレットを開く',
    keybinding: 'Ctrl+Shift+P',
    run: () => wb().setPaletteOpen(true)
  })

  registerCommand({
    id: 'menu.toggle',
    title: 'アプリケーションメニューを開閉する',
    keybinding: 'Alt+M',
    run: () => wb().setMenuOpen(!wb().menuOpen)
  })

  // Undo/Redo（W4、NFR-012）。編集欄フォーカス中はテキスト自体の Undo を優先する。
  registerCommand({
    id: 'edit.undo',
    title: '元に戻す（直前の操作）',
    category: '編集',
    keybinding: 'Ctrl+Z',
    skipInEditable: true,
    run: async () => {
      const notify = useJobsStore.getState().notify
      try {
        const label = await performUndo()
        notify('info', label ? `元に戻しました: ${label}` : '取り消せる操作はありません')
      } catch (error) {
        notify('error', '元に戻す操作に失敗しました', error instanceof Error ? error.message : String(error))
      }
    }
  })
  registerCommand({
    id: 'edit.redo',
    title: 'やり直す（取り消した操作）',
    category: '編集',
    keybinding: 'Ctrl+Y',
    skipInEditable: true,
    run: async () => {
      const notify = useJobsStore.getState().notify
      try {
        const label = await performRedo()
        notify('info', label ? `やり直しました: ${label}` : 'やり直せる操作はありません')
      } catch (error) {
        notify('error', 'やり直しに失敗しました', error instanceof Error ? error.message : String(error))
      }
    }
  })

  // リンク移動の戻る／進む（W9）
  registerCommand({
    id: 'nav.back',
    title: '戻る（直前の表示Resourceへ）',
    category: '移動',
    keybinding: 'Alt+ArrowLeft',
    run: () => {
      navigateBack()
    }
  })
  registerCommand({
    id: 'nav.forward',
    title: '進む（戻る前の表示Resourceへ）',
    category: '移動',
    keybinding: 'Alt+ArrowRight',
    run: () => {
      navigateForward()
    }
  })
  registerCommand({
    id: 'nav.refresh',
    title: '現在のEditorを更新',
    category: '移動',
    run: () => editor().refreshActiveResource()
  })
  registerCommand({
    id: 'nav.home',
    title: 'ホーム（ダッシュボード）',
    category: '移動',
    run: () => {
      wb().switchMode('M0')
      editor().openResource('project://current', 'ダッシュボード')
    }
  })
  registerCommand({
    id: 'editor.tab.previous',
    title: 'Editorタブ: 前へ',
    category: '表示',
    run: () => activateAdjacentWorkbenchTab(-1)
  })
  registerCommand({
    id: 'editor.tab.next',
    title: 'Editorタブ: 後へ',
    category: '表示',
    run: () => activateAdjacentWorkbenchTab(1)
  })
  registerCommand({
    id: 'panel.tab.previous',
    title: '下Panelタブ: 前へ',
    category: '表示',
    run: () => activateAdjacentWorkbenchTab(-1)
  })
  registerCommand({
    id: 'panel.tab.next',
    title: '下Panelタブ: 後へ',
    category: '表示',
    run: () => activateAdjacentWorkbenchTab(1)
  })

  // Activity Bar の各アクティビティを開く（W10、ショートカット割り当て可能）
  const ACTIVITY_LABELS: Record<Activity, string> = {
    explorer: 'Explorer',
    search: 'Search',
    trace: 'Trace',
    reports: 'Reports',
    history: 'History',
    settings: 'Settings'
  }
  for (const activity of DEFAULT_ACTIVITY_ORDER) {
    registerCommand({
      id: `activity.${activity}`,
      title: `Activityを開く: ${ACTIVITY_LABELS[activity]}`,
      category: '表示',
      keybinding: activity === 'settings' ? 'Ctrl+.' : undefined,
      run: () => {
        const state = wb()
        // Command からは常に「開く」（同一Activity再実行でも閉じない）
        if (state.activity !== activity || !state.sideBarVisible) state.setActivity(activity)
      }
    })
  }

  registerCommand({
    id: 'search.focusSidebar',
    title: 'Searchの検索入力へ移動',
    category: '検索',
    keybinding: 'Ctrl+Shift+F',
    run: () => {
      const state = wb()
      if (state.activity !== 'search' || !state.sideBarVisible) state.setActivity('search')
      focusWhenVisible('[data-testid="search-input"]')
    }
  })

  registerCommand({
    id: 'dictionary.focusQuery',
    title: '辞書の用語入力へ移動（Secondary）',
    category: '検索',
    keybinding: 'Ctrl+Shift+D',
    run: () => {
      wb().setSecondaryTab('dictionary')
      focusWhenVisible('#secondary-dictionary-query')
    }
  })

  registerCommand({
    id: 'search.screenText',
    title: '画面内の文字列を検索する',
    category: '検索',
    run: () => {
      window.dispatchEvent(new Event(OPEN_SCREEN_TEXT_SEARCH))
    }
  })

  // ヘルプ（読取専用 Resource、P3-10）
  registerCommand({
    id: 'help.workflow',
    title: 'ヘルプ: 操作フロー',
    category: 'ヘルプ',
    run: () => editor().openResource('help://workflow', '操作フロー')
  })
  registerCommand({
    id: 'help.schema',
    title: 'ヘルプ: データスキーマ',
    category: 'ヘルプ',
    run: () => editor().openResource('help://schema', 'データスキーマ')
  })
  registerCommand({
    id: 'help.designModel',
    title: 'ヘルプ: 設計モデル',
    category: 'ヘルプ',
    run: () => editor().openResource('help://design-model', '設計モデル')
  })

  // 作業モード切替（Ctrl+1〜6、§15）
  for (const [i, { mode, label }] of WORK_MODES.entries()) {
    registerCommand({
      id: `mode.switch.${mode}`,
      title: `作業モード: ${mode} ${label}`,
      category: 'モード',
      keybinding: `Ctrl+${i + 1}`,
      run: () => wb().switchMode(mode as WorkMode)
    })
  }

  registerCommand({
    id: 'mode.resetLayout',
    title: '現在モードのレイアウトを既定に戻す',
    category: 'モード',
    run: () => wb().resetLayout()
  })

  registerCommand({
    id: 'workbench.togglePrimarySideBar',
    title: 'Primary Side Bar の表示切替',
    keybinding: 'Ctrl+B',
    run: () => wb().toggleSideBar()
  })

  registerCommand({
    id: 'workbench.toggleSecondarySideBar',
    title: 'Secondary Side Bar の表示切替',
    run: () => wb().toggleSecondary()
  })

  registerCommand({
    id: 'workbench.togglePanel',
    title: 'Panel の表示切替',
    keybinding: 'Ctrl+@',
    run: () => wb().togglePanel()
  })

  registerCommand({
    id: 'resource.open',
    title: 'Resource を開く',
    hidden: true,
    run: (arg) => {
      const { uri, title, preview } = arg as { uri: string; title: string; preview?: boolean }
      editor().openResource(uri, title, { preview })
    }
  })

  registerCommand({
    id: 'editor.close',
    title: 'アクティブなタブを閉じる',
    keybinding: 'Ctrl+W',
    run: () => {
      const st = editor()
      if (st.activeUri) st.closeTab(st.activeUri)
    }
  })

  registerCommand({
    id: 'editor.split',
    title: 'Editor を左右に分割する',
    keybinding: 'Ctrl+\\',
    run: () => editor().splitActiveGroup('horizontal')
  })
  registerCommand({
    id: 'editor.splitVertical',
    title: 'Editor を上下に分割する',
    run: () => editor().splitActiveGroup('vertical')
  })
  registerCommand({
    id: 'editor.moveTabToNextGroup',
    title: 'アクティブタブを次のEditor Groupへ移動',
    run: () => editor().moveActiveTab(1)
  })
  registerCommand({
    id: 'editor.moveTabToPreviousGroup',
    title: 'アクティブタブを前のEditor Groupへ移動',
    run: () => editor().moveActiveTab(-1)
  })

  // プロジェクト操作
  registerCommand({
    id: 'project.open',
    title: 'プロジェクトを開く…（project.d2d）',
    category: 'プロジェクト',
    run: async () => {
      const path = await window.api.showOpenDialog({
        title: 'project.d2d を選択',
        mode: 'file',
        filters: [{ name: 'D2D プロジェクト', extensions: ['d2d'] }]
      })
      if (!path) return
      const res = await invoke('project.open', { path })
      if (res.ok) {
        await useProjectStore.getState().refresh()
        editor().openResource('project://current', 'ダッシュボード')
      } else {
        useJobsStore.getState().notify('error', 'プロジェクトを開けませんでした', res.error.message)
      }
    }
  })

  registerCommand({
    id: 'project.createInFolder',
    title: '新規プロジェクトを作成…（フォルダ選択）',
    category: 'プロジェクト',
    run: async () => {
      const dir = await window.api.showOpenDialog({ title: 'プロジェクトフォルダを選択', mode: 'directory' })
      if (!dir) return
      const name = dir.replaceAll('\\', '/').split('/').filter(Boolean).pop() ?? 'project'
      const res = await invoke('project.create', { rootPath: dir, name })
      if (res.ok) {
        await useProjectStore.getState().refresh()
        editor().openResource('project://current', 'ダッシュボード')
      } else {
        useJobsStore.getState().notify('error', 'プロジェクトを作成できませんでした', res.error.message)
      }
    }
  })

  registerCommand({
    id: 'settings.open',
    title: 'ツール設定を開く',
    category: '設定',
    run: () => editor().openResource('settings://tool', 'ツール設定')
  })

  registerCommand({
    id: 'projectSettings.open',
    title: 'プロジェクト設定を開く',
    category: '設定',
    isEnabled: (ctx) => ctx.hasProject,
    run: () => editor().openResource('project-settings://current', 'プロジェクト設定')
  })

  registerCommand({
    id: 'dashboard.open',
    title: 'プロジェクトダッシュボードを開く',
    isEnabled: (ctx) => ctx.hasProject,
    run: () => editor().openResource('project://current', 'ダッシュボード')
  })

  // テーマ（UI-001/027）
  for (const mode of DISPLAY_MODES) {
    registerCommand({
      id: `theme.displayMode.${mode}`,
      title: `表示モード: ${mode}`,
      category: 'テーマ',
      run: () => wb().setTheme({ displayMode: mode })
    })
  }
  for (const color of COLOR_THEMES) {
    registerCommand({
      id: `theme.color.${color}`,
      title: `カラーテーマ: ${color}`,
      category: 'テーマ',
      run: () => wb().setTheme({ colorTheme: color })
    })
  }

  registerCommand({
    id: 'theme.fontSize.increase',
    title: '文字サイズを大きくする',
    category: 'テーマ',
    run: () => wb().setTheme({ fontSize: Math.min(20, wb().theme.fontSize + 1) })
  })
  registerCommand({
    id: 'theme.fontSize.decrease',
    title: '文字サイズを小さくする',
    category: 'テーマ',
    run: () => wb().setTheme({ fontSize: Math.max(10, wb().theme.fontSize - 1) })
  })
  registerCommand({
    id: 'theme.fontSize.reset',
    title: '文字サイズを標準に戻す',
    category: 'テーマ',
    run: () => wb().setTheme({ fontSize: 13 })
  })

  // Workbench全体のブラウザ相当ズーム（UI-054）。Ctrl+wheelも同じsetZoomへ接続する。
  registerCommand({
    id: 'view.zoomIn',
    title: '画面表示を拡大',
    category: '表示',
    keybinding: 'Ctrl+=',
    run: () => wb().setZoom(wb().zoom + 10)
  })
  registerCommand({
    id: 'view.zoomOut',
    title: '画面表示を縮小',
    category: '表示',
    keybinding: 'Ctrl+-',
    run: () => wb().setZoom(wb().zoom - 10)
  })
  registerCommand({
    id: 'view.zoomReset',
    title: '画面表示を100%へ戻す',
    category: '表示',
    keybinding: 'Ctrl+0',
    run: () => wb().setZoom(100)
  })

  // ジョブ（UI-009）
  registerCommand({
    id: 'job.openPanel',
    title: 'Jobs Panel を開く',
    category: 'ジョブ',
    run: () => wb().openPanel('jobs' as PanelTab)
  })

  registerCommand({
    id: 'job.retry',
    title: 'ジョブを再実行する',
    hidden: true,
    run: async (arg) => {
      const { jobId } = arg as { jobId: string }
      const res = await invoke('job.retry', { jobId })
      if (!res.ok) useJobsStore.getState().notify('error', '再実行できません', res.error.message)
    }
  })

  registerCommand({
    id: 'job.cancel',
    title: 'ジョブを中断する',
    hidden: true,
    run: async (arg) => {
      const { jobId } = arg as { jobId: string }
      const res = await invoke('job.cancel', { jobId })
      if (!res.ok) useJobsStore.getState().notify('error', '中断できません', res.error.message)
    }
  })

  registerCommand({
    id: 'job.openLog',
    title: 'ジョブログを開く',
    hidden: true,
    run: (arg) => {
      const { jobId } = arg as { jobId: string }
      editor().openResource(`log://job/${jobId}`, `Job ${jobId.slice(0, 8)}`)
    }
  })
}
