/**
 * Workbench Shell（P3-1、UI-025/037〜040、sdd_ui_design §3）。
 * 外周パネルのリサイズ、Editor再帰分割、設定・Backendイベントを各UIストアへ接続する。
 */
import { useEffect } from 'react'
import { installKeybindings } from '../../services/command-registry'
import { getCommandContext, registerBuiltinCommands } from '../../services/builtin-commands'
import { loadKeybindingOverrides } from '../../services/keybindings'
import { clearUndoHistory } from '../../services/undo-service'
import {
  clearNavigationHistory,
  initNavigationHistory,
  navigateBack,
  navigateForward
} from '../../services/navigation-history'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useFavoritesStore } from '../../stores/favorites-store'
import { useJobsStore, type JobRecord } from '../../stores/jobs-store'
import { useProjectStore, type ProjectInfo } from '../../stores/project-store'
import { useWorkbenchStore } from '../../stores/workbench-store'
import { COLOR_THEMES, DISPLAY_MODES, watchSystemTheme, type ThemeState } from '../../theme/theme'
import { ActivityBar } from './ActivityBar'
import { CommandPalette } from './CommandPalette'
import { EditorArea } from './EditorArea'
import { Notifications } from './Notifications'
import { PanelArea } from './PanelArea'
import { PipelineNavigator } from './PipelineNavigator'
import { PrimarySideBar } from './PrimarySideBar'
import { ResizeHandle } from './ResizeHandle'
import { SecondarySideBar } from './SecondarySideBar'
import { ScreenTextSearch } from './ScreenTextSearch'
import { GlobalButtonTooltips } from './GlobalButtonTooltips'
import { ContextMenuHost } from '../common/ContextMenu'
import { ConfirmDialogHost } from '../common/ConfirmDialog'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'

let commandsRegistered = false

export function WorkbenchShell(): React.JSX.Element {
  const sideBarVisible = useWorkbenchStore((state) => state.sideBarVisible)
  const secondaryVisible = useWorkbenchStore((state) => state.secondaryVisible)
  const panelVisible = useWorkbenchStore((state) => state.panelVisible)
  const primarySize = useWorkbenchStore((state) => state.primarySize)
  const secondarySize = useWorkbenchStore((state) => state.secondarySize)
  const panelSize = useWorkbenchStore((state) => state.panelSize)
  const zoom = useWorkbenchStore((state) => state.zoom)
  const loadPersisted = useWorkbenchStore((state) => state.loadPersisted)
  const loadEditorPersisted = useEditorStore((state) => state.loadPersisted)

  useEffect(() => {
    if (!commandsRegistered) {
      registerBuiltinCommands()
      commandsRegistered = true
    }
    loadKeybindingOverrides()
    loadPersisted('global')
    loadEditorPersisted('global')
    useFavoritesStore.getState().loadPersisted('global')
    // テーマ関連キーは settings.getAll 1回で取得する（改善対応4: 操作単位APIへの集約）
    void invoke('settings.getAll').then((settingsResult) => {
      if (!settingsResult.ok) return
      const all = settingsResult.result
      const displayMode = all['theme.displayMode']
      const colorTheme = all['theme.colorTheme']
      const fontSize = all['theme.fontSize']
      const customColors = all['theme.customColors']
      const theme: Partial<ThemeState> = {}
      if (DISPLAY_MODES.includes(displayMode as (typeof DISPLAY_MODES)[number])) {
        theme.displayMode = displayMode as ThemeState['displayMode']
      }
      if (COLOR_THEMES.includes(colorTheme as (typeof COLOR_THEMES)[number])) {
        theme.colorTheme = colorTheme as ThemeState['colorTheme']
      }
      if (typeof fontSize === 'number' && fontSize >= 10 && fontSize <= 20) {
        theme.fontSize = fontSize
      }
      if (typeof customColors === 'object' && customColors !== null) {
        theme.customColors = Object.fromEntries(
          Object.entries(customColors).filter(([, value]) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value))
        )
      }
      if (Object.keys(theme).length > 0) useWorkbenchStore.getState().setTheme(theme)
    })

    const uninstallKeys = installKeybindings(getCommandContext)
    const uninstallNav = initNavigationHistory()
    const handleMouseNavigation = (event: PointerEvent): void => {
      if (event.button === 3) {
        event.preventDefault()
        navigateBack()
      } else if (event.button === 4) {
        event.preventDefault()
        navigateForward()
      }
    }
    window.addEventListener('pointerdown', handleMouseNavigation)
    const handleZoomWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const state = useWorkbenchStore.getState()
      state.setZoom(state.zoom + (event.deltaY < 0 ? 10 : -10))
    }
    window.addEventListener('wheel', handleZoomWheel, { passive: false })
    const unwatchTheme = watchSystemTheme(() => useWorkbenchStore.getState().theme)
    const offEvents = onBackendEvent((event, payload) => {
      if (event === 'job.updated') {
        useJobsStore.getState().applyUpdate(payload as JobRecord)
      } else if (event === 'project.opened') {
        const info = payload as ProjectInfo
        useProjectStore.getState().setProject(info)
        useWorkbenchStore.getState().loadPersisted(info.projectUid)
        useEditorStore.getState().loadPersisted(info.projectUid)
        useFavoritesStore.getState().loadPersisted(info.projectUid)
        // プロジェクトをまたぐ取り消しは二重適用の危険があるため履歴を破棄する。
        clearUndoHistory()
        clearNavigationHistory()
      } else if (event === 'project.closed') {
        useProjectStore.getState().setProject(null)
        useWorkbenchStore.getState().loadPersisted('global')
        useEditorStore.getState().loadPersisted('global')
        useFavoritesStore.getState().loadPersisted('global')
        clearUndoHistory()
        clearNavigationHistory()
      } else if (
        [
          'source.imported',
          'extraction.completed',
          'intermediate.updated',
          'design_model.updated',
          'artifact.updated',
          'relation.updated'
        ].includes(event)
      ) {
        // 取込ジョブ等でイベントが連続する場合に備え、集計取得を1回へ集約する（改善対応3）
        useProjectStore.getState().requestStatsRefresh()
      }
    })

    // 起動・再読込時は project.opened イベントが再発火しないため、
    // プロジェクト復元後にプロジェクト単位の保存レイアウトを明示的に読み込む（UI-041）
    void useProjectStore
      .getState()
      .refresh()
      .then(() => {
        const info = useProjectStore.getState().project
        if (info) {
          useWorkbenchStore.getState().loadPersisted(info.projectUid)
          useEditorStore.getState().loadPersisted(info.projectUid)
          useFavoritesStore.getState().loadPersisted(info.projectUid)
        }
      })
    void useJobsStore.getState().refresh()

    return () => {
      uninstallKeys()
      uninstallNav()
      window.removeEventListener('pointerdown', handleMouseNavigation)
      window.removeEventListener('wheel', handleZoomWheel)
      unwatchTheme()
      offEvents()
    }
  }, [loadEditorPersisted, loadPersisted])

  return (
    <div
      className="wb-root"
      data-testid="workbench"
      data-zoom={zoom}
      style={{ zoom: zoom / 100, width: `${10000 / zoom}vw`, height: `${10000 / zoom}vh` }}
    >
      <TitleBar />
      <GlobalButtonTooltips />
      <ScreenTextSearch />
      <PipelineNavigator />
      <div className="wb-main">
        <ActivityBar />
        {sideBarVisible && (
          <>
            <div className="wb-primary-slot" style={{ width: primarySize }}>
              <PrimarySideBar />
            </div>
            <ResizeHandle
              axis="x"
              label="Primary Side Barの幅変更"
              testId="primary-resize-handle"
              onDelta={(delta) => {
                const state = useWorkbenchStore.getState()
                state.setPrimarySize(state.primarySize + delta)
              }}
            />
          </>
        )}
        <div className="wb-center">
          <EditorArea />
          {panelVisible && (
            <>
              <ResizeHandle
                axis="y"
                reverse
                label="下段Panelの高さ変更"
                testId="panel-resize-handle"
                onDelta={(delta) => {
                  const state = useWorkbenchStore.getState()
                  state.setPanelSize(state.panelSize + delta)
                }}
              />
              <div className="wb-panel-slot" style={{ height: panelSize }}>
                <PanelArea />
              </div>
            </>
          )}
        </div>
        {secondaryVisible && (
          <>
            <ResizeHandle
              axis="x"
              reverse
              label="Secondary Side Barの幅変更"
              testId="secondary-resize-handle"
              onDelta={(delta) => {
                const state = useWorkbenchStore.getState()
                state.setSecondarySize(state.secondarySize + delta)
              }}
            />
            <div className="wb-secondary-slot" style={{ width: secondarySize }}>
              <SecondarySideBar />
            </div>
          </>
        )}
      </div>
      <StatusBar />
      <CommandPalette />
      <ContextMenuHost />
      <ConfirmDialogHost />
      <Notifications />
    </div>
  )
}
