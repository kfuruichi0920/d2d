/**
 * Status Bar（UI-009、sdd_ui_design §3）。軽量な常時状態表示。
 * ジョブ状態クリックで Jobs Panel を開く（§12）。
 */
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkbenchStore } from '../../stores/workbench-store'

export function StatusBar(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const openPanel = useWorkbenchStore((s) => s.openPanel)
  const jobs = useJobsStore((s) => s.jobs)
  const runningCount = useJobsStore((s) => s.runningCount)

  const failedCount = jobs.filter((j) => j.status === 'failed').length

  return (
    <footer className="wb-statusbar" data-testid="status-bar">
      <span className="item" data-testid="status-project">
        {project ? project.name : 'プロジェクト未選択'}
      </span>

      <span className="spacer" />
      <span
        className="item clickable"
        data-testid="status-jobs"
        onClick={() => openPanel('jobs')}
        title="クリックでジョブパネルを開く"
      >
        {runningCount > 0 ? `⟳ ジョブ ${runningCount} 実行中` : 'ジョブ待機'}
      </span>
      {failedCount > 0 && (
        <span className="item clickable status-failed" onClick={() => openPanel('jobs')}>
          ⚠ 失敗 {failedCount}
        </span>
      )}
    </footer>
  )
}
