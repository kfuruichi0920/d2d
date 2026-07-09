/**
 * Status Bar（UI-009、sdd_ui_design §3）。軽量な常時状態表示。
 * ジョブ状態クリックで Jobs Panel を開く（§12）。
 */
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkbenchStore, WORK_MODES } from '../../stores/workbench-store'

export function StatusBar(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const workMode = useWorkbenchStore((s) => s.workMode)
  const openPanel = useWorkbenchStore((s) => s.openPanel)
  const activeUri = useEditorStore((s) => s.activeUri)
  const jobs = useJobsStore((s) => s.jobs)
  const runningCount = useJobsStore((s) => s.runningCount)
  const theme = useWorkbenchStore((s) => s.theme)

  const failedCount = jobs.filter((j) => j.status === 'failed').length
  const modeLabel = WORK_MODES.find((m) => m.mode === workMode)?.label ?? workMode

  return (
    <footer className="wb-statusbar" data-testid="status-bar">
      <span className="item" data-testid="status-project">
        {project ? project.name : 'プロジェクト未選択'}
      </span>
      <span className="item" data-testid="status-mode">
        {workMode}: {modeLabel}
      </span>
      {activeUri && <span className="item">{activeUri}</span>}
      <span className="spacer" />
      <span
        className="item clickable"
        data-testid="status-jobs"
        onClick={() => openPanel('jobs')}
        title="クリックで Jobs Panel を開く"
      >
        {runningCount > 0 ? `⟳ ジョブ ${runningCount} 実行中` : 'ジョブ待機'}
      </span>
      {failedCount > 0 && (
        <span className="item clickable" style={{ color: '#ffd2d2' }} onClick={() => openPanel('jobs')}>
          ⚠ 失敗 {failedCount}
        </span>
      )}
      <span className="item" data-testid="status-theme">
        {theme.colorTheme}/{theme.displayMode}
      </span>
    </footer>
  )
}
