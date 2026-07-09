/**
 * Job Log Viewer（V-16、CORE-022、NFR-011）。
 * ジョブレコードと logs/jobs/<job_uid>.jsonl の内容を表示する。
 */
import { useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import type { JobRecord } from '../../stores/jobs-store'
import { JobStatusBadge } from '../views/JobsListView'

interface LogLine {
  ts: string
  level: string
  message: string
  data?: unknown
}

export function JobLogEditor({ jobId }: { jobId: string }): React.JSX.Element {
  const [job, setJob] = useState<JobRecord | null>(null)
  const [lines, setLines] = useState<LogLine[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const [jobRes, logRes] = await Promise.all([
        invoke<JobRecord>('job.get', { jobId }),
        invoke<LogLine[]>('job.getLog', { jobId })
      ])
      if (cancelled) return
      if (jobRes.ok) setJob(jobRes.result)
      if (logRes.ok) setLines(logRes.result)
      else setError(logRes.error.message)
    }
    void load()
    const timer = setInterval(() => void load(), 2000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [jobId])

  return (
    <div style={{ padding: 16 }} data-testid="job-log-editor">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <h1 style={{ fontSize: 15, margin: 0 }}>ジョブ {jobId.slice(0, 8)}</h1>
        {job && <JobStatusBadge status={job.status} />}
        {job && <span style={{ color: 'var(--d2d-fg-muted)' }}>{job.type}</span>}
      </div>
      {job?.error && (
        <div style={{ color: 'var(--d2d-error)', marginBottom: 8 }}>
          {job.error.error_code}: {job.error.message}
          {job.error.retryable && '（再実行可能）'}
        </div>
      )}
      {error && <div style={{ color: 'var(--d2d-fg-muted)' }}>{error}</div>}
      <pre
        style={{
          background: 'var(--d2d-bg)',
          border: '1px solid var(--d2d-border)',
          borderRadius: 'var(--d2d-radius)',
          padding: 10,
          fontSize: 11.5,
          overflow: 'auto',
          maxHeight: '70vh'
        }}
      >
        {lines
          .map(
            (l) =>
              `${l.ts}  [${l.level.toUpperCase().padEnd(5)}] ${l.message}${l.data !== undefined ? ` ${JSON.stringify(l.data)}` : ''}`
          )
          .join('\n') || '（ログはまだありません）'}
      </pre>
    </div>
  )
}
