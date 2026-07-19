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
    void Promise.all([
      invoke<unknown>('settings.get', { key: 'theme.displayMode' }),
      invoke<unknown>('settings.get', { key: 'theme.colorTheme' }),
      invoke<unknown>('settings.get', { key: 'theme.fontSize' }),
      invoke<unknown>('settings.get', { key: 'theme.customColors' })
    ]).then(([displayModeResult, colorThemeResult, fontSizeResult, customColorsResult]) => {
      const theme: Partial<ThemeState> = {}
      if (displayModeResult.ok && DISPLAY_MODES.includes(displayModeResult.result as (typeof DISPLAY_MODES)[number])) {
        theme.displayMode = displayModeResult.result as ThemeState['displayMode']
      }
      if (colorThemeResult.ok && COLOR_THEMES.includes(colorThemeResult.result as (typeof COLOR_THEMES)[number])) {
        theme.colorTheme = colorThemeResult.result as ThemeState['colorTheme']
      }
      if (
        fontSizeResult.ok &&
        typeof fontSizeResult.result === 'number' &&
        fontSizeResult.result >= 10 &&
        fontSizeResult.result <= 20
      ) {
        theme.fontSize = fontSizeResult.result
      }
      if (
        customColorsResult.ok &&
        typeof customColorsResult.result === 'object' &&
        customColorsResult.result !== null
      ) {
        theme.customColors = Object.fromEntries(
          Object.entries(customColorsResult.result).filter(
            ([, value]) => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
          )
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
        void useProjectStore.getState().refreshStats()
      }
    })

    void useProjectStore.getState().refresh()
    void useJobsStore.getState().refresh()

    return () => {
      uninstallKeys()
      uninstallNav()
      window.removeEventListener('pointerdown', handleMouseNavigation)
      unwatchTheme()
      offEvents()
    }
  }, [loadEditorPersisted, loadPersisted])

  return (
    <div className="wb-root" data-testid="workbench">
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
