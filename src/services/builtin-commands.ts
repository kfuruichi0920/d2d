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

  registerCommand({
    id: 'commandPalette.open',
    title: 'コマンドパレットを開く',
    keybinding: 'Ctrl+Shift+P',
    run: () => wb().setPaletteOpen(true)
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
    title: 'Editor を分割する',
    keybinding: 'Ctrl+\\',
    run: () => editor().splitActiveGroup()
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
