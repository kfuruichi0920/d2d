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
        {activity === 'settings' && <SettingsShortcutView />}
        {['search', 'trace', 'reports', 'history'].includes(activity) && (
          <div className="d2d-empty">
            {TITLES[activity]} は
            {activity === 'search'
              ? ' P11（検索）'
              : activity === 'trace'
                ? ' P9（トレーサビリティ）'
                : activity === 'reports'
                  ? ' P13（レポート）'
                  : ' P12（履歴・差分）'}
            で実装予定
          </div>
        )}
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
      <div style={{ paddingLeft: 12, color: 'var(--d2d-fg-muted)' }}>
        <div className="d2d-list-row">①原本（P4 で実装）</div>
        <div className="d2d-list-row">②抽出データ（P5 で実装）</div>
        <div className="d2d-list-row">③中間データ（P7 で実装）</div>
        <div className="d2d-list-row">④設計モデル（P8 で実装）</div>
      </div>
    </div>
  )
}

function SettingsShortcutView(): React.JSX.Element {
  return (
    <div style={{ padding: 8 }}>
      <button
        type="button"
        className="d2d-btn"
        onClick={() => void executeCommand('settings.open', undefined, getCommandContext())}
      >
        設定エディタを開く
      </button>
    </div>
  )
}
