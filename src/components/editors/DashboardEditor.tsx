/**
 * Project Dashboard Editor（V-00、sdd_ui_design §10.2）。
 * パイプライン進捗、実行中ジョブ、プロジェクト情報を表示する。
 */
import { useEffect } from 'react'
import { useProjectStore } from '../../stores/project-store'
import { useJobsStore } from '../../stores/jobs-store'
import { JobStatusBadge } from '../views/JobsListView'

export function DashboardEditor(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const stats = useProjectStore((s) => s.stats)
  const refreshStats = useProjectStore((s) => s.refreshStats)
  const jobs = useJobsStore((s) => s.jobs)

  useEffect(() => {
    if (project) void refreshStats()
  }, [project, refreshStats])

  if (!project) {
    return <div className="d2d-empty">プロジェクトが開かれていません</div>
  }

  const cards: { label: string; value: number | string }[] = [
    { label: '①原本', value: stats?.sources ?? '-' },
    { label: '②抽出文書', value: stats?.extracted ?? '-' },
    { label: '③中間文書', value: stats?.intermediate ?? '-' },
    { label: '④設計要素', value: stats?.designElements ?? '-' },
    { label: 'トレースリンク', value: stats?.traceLinks ?? '-' },
    { label: 'LLM候補(未処理)', value: stats?.candidates ?? '-' }
  ]

  return (
    <div style={{ padding: 20 }} data-testid="dashboard-editor">
      <h1 style={{ fontSize: 18, marginTop: 0 }}>{project.name}</h1>
      <dl className="d2d-kv" style={{ padding: 0, marginBottom: 16 }}>
        <dt>表示コード</dt>
        <dd>{project.code}</dd>
        <dt>プロジェクトルート</dt>
        <dd>{project.rootPath}</dd>
        <dt>schema_version</dt>
        <dd>{project.schemaVersion}</dd>
      </dl>

      <h2 style={{ fontSize: 14 }}>パイプライン進捗</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 8 }}>
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              border: '1px solid var(--d2d-border)',
              borderRadius: 'var(--d2d-radius)',
              padding: '10px 12px',
              background: 'var(--d2d-surface-raised)'
            }}
          >
            <div style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{c.value}</div>
          </div>
        ))}
      </div>

      <h2 style={{ fontSize: 14, marginTop: 20 }}>最近のジョブ</h2>
      {jobs.length === 0 ? (
        <div className="d2d-empty">ジョブはまだ実行されていません</div>
      ) : (
        <div>
          {jobs.slice(0, 5).map((j) => (
            <div key={j.jobId} className="d2d-list-row">
              <JobStatusBadge status={j.status} />
              <span>{j.type}</span>
              <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{j.jobId.slice(0, 8)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
