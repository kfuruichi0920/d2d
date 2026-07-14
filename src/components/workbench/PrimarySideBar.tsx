/**
 * Primary Side Bar（sdd_ui_design §9）。探索・選択・絞り込みに限定する。
 * データ系ビュー（原本/抽出/中間/モデルのツリー）は P4/P5 以降で拡充する。
 */
import { executeCommand } from '../../services/command-registry'
import { getCommandContext } from '../../services/builtin-commands'
import { useProjectStore } from '../../stores/project-store'
import { useWorkbenchStore, type Activity } from '../../stores/workbench-store'
import { JobsListView } from '../views/JobsListView'
import { ReviewQueueView } from '../views/ReviewQueueView'
import { DocumentsTree } from '../views/DocumentsTree'
import { TraceSideBar } from '../views/TraceViews'
import { HistorySideBar } from '../views/HistoryViews'
import { SearchSideBar } from '../views/SearchViews'
import { ReportSideBar } from '../views/ReportViews'

const TITLES: Record<Activity, string> = {
  explorer: 'Explorer',
  review: 'Review',
  search: 'Search',
  trace: 'Trace',
  jobs: 'Jobs',
  reports: 'Reports',
  history: 'History',
  settings: 'Settings'
}

export function PrimarySideBar(): React.JSX.Element {
  const activity = useWorkbenchStore((s) => s.activity)

  return (
    <aside className="wb-sidebar" data-testid="primary-sidebar">
      <div className="wb-sidebar-header">{TITLES[activity]}</div>
      <div className="wb-sidebar-body">
        {activity === 'explorer' && <ExplorerView />}
        {activity === 'jobs' && <JobsListView />}
        {activity === 'review' && <ReviewQueueView />}
        {activity === 'trace' && <TraceSideBar />}
        {activity === 'settings' && <SettingsShortcutView />}
        {activity === 'history' && <HistorySideBar />}
        {activity === 'search' && <SearchSideBar />}
        {activity === 'reports' && <ReportSideBar />}
      </div>
    </aside>
  )
}

function ExplorerView(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)

  if (!project) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }}>
        <p style={{ color: 'var(--d2d-fg-muted)', margin: 0 }}>プロジェクトが開かれていません。</p>
        <button
          type="button"
          className="d2d-btn primary"
          data-testid="explorer-open-project"
          onClick={() => void executeCommand('project.open', undefined, getCommandContext())}
        >
          プロジェクトを開く…
        </button>
        <button
          type="button"
          className="d2d-btn"
          data-testid="explorer-create-project"
          onClick={() => void executeCommand('project.createInFolder', undefined, getCommandContext())}
        >
          新規プロジェクトを作成…
        </button>
      </div>
    )
  }

  return (
    <div>
      <div
        className="d2d-list-row"
        data-testid="explorer-project-row"
        onClick={() => void executeCommand('resource.open', { uri: 'project://current', title: 'ダッシュボード' })}
      >
        📁 {project.name}
      </div>
      <div style={{ paddingLeft: 8 }}>
        <DocumentsTree />
      </div>
    </div>
  )
}

function SettingsShortcutView(): React.JSX.Element {
  const hasProject = useProjectStore((s) => s.project !== null)
  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <button
        type="button"
        className="d2d-btn"
        onClick={() => void executeCommand('settings.open', undefined, getCommandContext())}
      >
        ツール設定を開く
      </button>
      <button
        type="button"
        className="d2d-btn"
        disabled={!hasProject}
        onClick={() => void executeCommand('projectSettings.open', undefined, getCommandContext())}
      >
        プロジェクト設定を開く
      </button>
    </div>
  )
}
