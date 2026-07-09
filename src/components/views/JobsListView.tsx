/**
 * ジョブ一覧（P3-5、UI-009）。Side Bar / Panel の両方から使う。
 */
import { executeCommand } from '../../services/command-registry'
import { useJobsStore, type JobRecord } from '../../stores/jobs-store'

export function JobStatusBadge({ status }: { status: JobRecord['status'] }): React.JSX.Element {
  const label: Record<JobRecord['status'], string> = {
    waiting: '待機中',
    running: '実行中',
    success: '成功',
    failed: '失敗',
    partial: '部分完了',
    aborted: '中断'
  }
  return <span className={`d2d-badge status-${status}`}>{label[status]}</span>
}

export function JobsListView(): React.JSX.Element {
  const jobs = useJobsStore((s) => s.jobs)

  if (jobs.length === 0) {
    return <div className="d2d-empty">ジョブはまだ実行されていません</div>
  }

  return (
    <div data-testid="jobs-list">
      {jobs.map((job) => (
        <div key={job.jobId} style={{ borderBottom: '1px solid var(--d2d-border)', padding: '4px 2px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <JobStatusBadge status={job.status} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.type}</span>
            {(job.status === 'failed' || job.status === 'partial' || job.status === 'aborted') && (
              <button
                type="button"
                className="d2d-btn small"
                title="条件付き再実行（CORE-024）"
                onClick={() => void executeCommand('job.retry', { jobId: job.jobId })}
              >
                再実行
              </button>
            )}
            {(job.status === 'running' || job.status === 'waiting') && (
              <button
                type="button"
                className="d2d-btn small"
                onClick={() => void executeCommand('job.cancel', { jobId: job.jobId })}
              >
                中断
              </button>
            )}
            <button
              type="button"
              className="d2d-btn small"
              onClick={() => void executeCommand('job.openLog', { jobId: job.jobId })}
            >
              ログ
            </button>
          </div>
          {job.status === 'running' && (
            <div className="d2d-progress" style={{ marginTop: 3 }}>
              <div style={{ width: `${job.progress}%` }} />
            </div>
          )}
          {job.message && <div style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{job.message}</div>}
          {job.error && <div style={{ color: 'var(--d2d-error)', fontSize: 11 }}>{job.error.message}</div>}
        </div>
      ))}
    </div>
  )
}
