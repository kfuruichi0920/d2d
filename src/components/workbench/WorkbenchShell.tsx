/**
 * Workbench Shell（P3-1、sdd_ui_design §3）。
 * Title Bar / Pipeline Navigator / Activity Bar / Side Bars / Editor Area / Panel / Status Bar を構成し、
 * Backend イベントを UI ストアへ橋渡しする。
 */
import { useEffect } from 'react'
import { installKeybindings } from '../../services/command-registry'
import { getCommandContext, registerBuiltinCommands } from '../../services/builtin-commands'
import { onBackendEvent } from '../../services/backend'
import { useJobsStore, type JobRecord } from '../../stores/jobs-store'
import { useProjectStore, type ProjectInfo } from '../../stores/project-store'
import { useWorkbenchStore } from '../../stores/workbench-store'
import { watchSystemTheme } from '../../theme/theme'
import { TitleBar } from './TitleBar'
import { PipelineNavigator } from './PipelineNavigator'
import { ActivityBar } from './ActivityBar'
import { PrimarySideBar } from './PrimarySideBar'
import { EditorArea } from './EditorArea'
import { SecondarySideBar } from './SecondarySideBar'
import { PanelArea } from './PanelArea'
import { StatusBar } from './StatusBar'
import { CommandPalette } from './CommandPalette'
import { Notifications } from './Notifications'

let commandsRegistered = false

export function WorkbenchShell(): React.JSX.Element {
  const sideBarVisible = useWorkbenchStore((s) => s.sideBarVisible)
  const secondaryVisible = useWorkbenchStore((s) => s.secondaryVisible)
  const panelVisible = useWorkbenchStore((s) => s.panelVisible)
  const loadPersisted = useWorkbenchStore((s) => s.loadPersisted)

  useEffect(() => {
    if (!commandsRegistered) {
      registerBuiltinCommands()
      commandsRegistered = true
    }
    loadPersisted('global')

    const uninstallKeys = installKeybindings(getCommandContext)
    const unwatchTheme = watchSystemTheme(() => useWorkbenchStore.getState().theme)

    // Backend イベント → UI ストア（sdd_ui_design §4.3 の変換の入口）
    const offEvents = onBackendEvent((event, payload) => {
      if (event === 'job.updated') {
        useJobsStore.getState().applyUpdate(payload as JobRecord)
      } else if (event === 'project.opened') {
        const info = payload as ProjectInfo
        useProjectStore.getState().setProject(info)
        // レイアウト永続化キーをプロジェクト単位へ切替（UI-025）
        useWorkbenchStore.getState().loadPersisted(info.projectUid)
      } else if (event === 'project.closed') {
        useProjectStore.getState().setProject(null)
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

    // 起動時に既存状態を取得（Backend 再起動後の再表示にも対応）
    void useProjectStore.getState().refresh()
    void useJobsStore.getState().refresh()

    return () => {
      uninstallKeys()
      unwatchTheme()
      offEvents()
    }
  }, [loadPersisted])

  return (
    <div className="wb-root" data-testid="workbench">
      <TitleBar />
      <PipelineNavigator />
      <div className="wb-main">
        <ActivityBar />
        {sideBarVisible && <PrimarySideBar />}
        <div className="wb-center">
          <EditorArea />
          {panelVisible && <PanelArea />}
        </div>
        {secondaryVisible && <SecondarySideBar />}
      </div>
      <StatusBar />
      <CommandPalette />
      <Notifications />
    </div>
  )
}
