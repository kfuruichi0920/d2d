/**
 * Status Bar（P3-5、UI-009）。プロジェクト／ジョブと実行環境の軽量な常時状態表示。
 * Git同期はネットワーク通信せず、ローカルupstream参照に対するahead/behindを表示する。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkbenchStore } from '../../stores/workbench-store'

interface GitStatusSummary {
  isRepo: boolean
  branch: string
  tracking: string | null
  ahead: number
  behind: number
}

interface RuntimeCapabilityStatus {
  plantUml: { enabled: boolean; source: 'configured' | 'bundled' | 'unavailable' }
  mecab: { enabled: boolean; source: 'configured' | 'bundled' | 'unavailable' }
}

interface LlmStatus {
  provider: string
  hasApiKey: boolean
  external: boolean
  externalSendAllowed: boolean
}

interface WorkbenchStatus {
  git: GitStatusSummary | null
  runtime: RuntimeCapabilityStatus | null
  llm: LlmStatus | null
  debugLevel: string
}

function gitStatusLabel(git: GitStatusSummary | null): string {
  if (!git) return 'Git: 取得不可'
  if (!git.isRepo) return 'Git: 未初期化'
  const branch = git.branch || 'ブランチ未確定'
  if (!git.tracking) return `Git: ${branch} · upstream未設定`
  if (git.ahead === 0 && git.behind === 0) return `Git: ${branch} · 同期済み`
  return `Git: ${branch} · ↑${git.ahead} ↓${git.behind}`
}

function capabilityLabel(name: string, capability: RuntimeCapabilityStatus['plantUml'] | undefined): string {
  return `${name}: ${capability?.enabled ? '有効' : '無効'}`
}

function llmStatusLabel(llm: LlmStatus | null): string {
  if (!llm) return 'LLM: 取得不可'
  const configured = !llm.external || llm.hasApiKey
  const external = llm.external ? (llm.externalSendAllowed ? '外部有効' : '外部無効') : '外部対象外'
  return `LLM: ${llm.provider} ${configured ? '設定済' : '未設定'} · ${external}`
}

export function StatusBar(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const openPanel = useWorkbenchStore((s) => s.openPanel)
  const jobs = useJobsStore((s) => s.jobs)
  const runningCount = useJobsStore((s) => s.runningCount)
  const [status, setStatus] = useState<WorkbenchStatus | null>(null)

  const failedCount = jobs.filter((j) => j.status === 'failed').length

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!project) {
      setStatus(null)
      return
    }
    const [git, runtime, llm, projectSettings] = await Promise.all([
      invoke<GitStatusSummary>('git.status'),
      invoke<RuntimeCapabilityStatus>('runtime.capabilities'),
      invoke<LlmStatus>('llm.getSettings'),
      invoke<Record<string, unknown>>('settings.getProjectSettings')
    ])
    const level = projectSettings.ok ? projectSettings.result['logging.debugLevel'] : null
    setStatus({
      git: git.ok ? git.result : null,
      runtime: runtime.ok ? runtime.result : null,
      llm: llm.ok ? llm.result : null,
      debugLevel: typeof level === 'string' ? level : 'info'
    })
  }, [project])

  useEffect(() => {
    void refreshStatus()
    if (!project) return
    const timer = window.setInterval(() => void refreshStatus(), 10_000)
    const refreshOnFocus = (): void => void refreshStatus()
    window.addEventListener('focus', refreshOnFocus)
    const offEvents = onBackendEvent((event) => {
      if (event === 'git.committed' || event === 'project.opened') void refreshStatus()
    })
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshOnFocus)
      offEvents()
    }
  }, [project, refreshStatus])

  return (
    <footer className="wb-statusbar" data-testid="status-bar">
      <span className="item" data-testid="status-project">
        {project ? project.name : 'プロジェクト未選択'}
      </span>
      {project && (
        <>
          <span
            className="item"
            data-testid="status-git"
            title="ローカルupstream参照に対する同期状態（fetchは実行しません）"
          >
            {gitStatusLabel(status?.git ?? null)}
          </span>
          <span
            className="item"
            data-testid="status-plantuml"
            title={`解決元: ${status?.runtime?.plantUml.source ?? 'unavailable'}`}
          >
            {capabilityLabel('PlantUML', status?.runtime?.plantUml)}
          </span>
          <span
            className="item"
            data-testid="status-mecab"
            title={`解決元: ${status?.runtime?.mecab.source ?? 'unavailable'}`}
          >
            {capabilityLabel('MeCab', status?.runtime?.mecab)}
          </span>
          <span className="item" data-testid="status-llm">
            {llmStatusLabel(status?.llm ?? null)}
          </span>
          <span className="item" data-testid="status-debug-level">
            Debug: {status?.debugLevel ?? 'info'}
          </span>
        </>
      )}

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
