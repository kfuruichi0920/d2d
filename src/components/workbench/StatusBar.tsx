/**
 * Status Bar（P3-5、UI-009）。プロジェクト／ジョブと実行環境の軽量な常時状態表示。
 * Git同期はネットワーク通信せず、ローカルupstream参照に対するahead/behindを表示する。
 */
import { SerendieSymbol } from '@serendie/symbols'
import { useCallback, useEffect, useState, type ComponentProps } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
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

interface McpStatus {
  enabled: boolean
  port: number
  running: boolean
  url: string | null
}

interface WorkbenchStatus {
  git: GitStatusSummary | null
  runtime: RuntimeCapabilityStatus | null
  llm: LlmStatus | null
  mcp: McpStatus | null
  debugLevel: string
}

type StatusIconName = ComponentProps<typeof SerendieSymbol>['name']

function StatusItem({
  icon,
  children,
  testId,
  title,
  onClick,
  className = ''
}: {
  icon: StatusIconName
  children: React.ReactNode
  testId?: string
  title?: string
  onClick?: () => void
  className?: string
}): React.JSX.Element {
  const content = (
    <>
      <SerendieSymbol name={icon} size={13} aria-hidden="true" />
      <span>{children}</span>
    </>
  )
  if (onClick) {
    return (
      <button
        type="button"
        className={`item clickable ${className}`}
        data-testid={testId}
        title={title}
        onClick={onClick}
      >
        {content}
      </button>
    )
  }
  return (
    <span className={`item ${className}`} data-testid={testId} title={title}>
      {content}
    </span>
  )
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

function llmProviderLabel(llm: LlmStatus | null): string {
  if (!llm) return 'LLM Provider: 取得不可'
  const configured = !llm.external || llm.hasApiKey
  return `LLM Provider: ${llm.provider} ${configured ? '設定済' : '未設定'}`
}

function mcpLabel(mcp: McpStatus | null): string {
  if (!mcp) return 'MCP: 取得不可'
  if (mcp.running) return `MCP: 起動中 :${mcp.port}`
  return mcp.enabled ? 'MCP: 停止（起動失敗）' : 'MCP: 停止'
}

function llmExternalLabel(llm: LlmStatus | null): string {
  if (!llm) return '外部LLM: 取得不可'
  if (!llm.external) return '外部LLM: 対象外'
  return `外部LLM: ${llm.externalSendAllowed ? '有効' : '無効'}`
}

export function StatusBar(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const openResource = useEditorStore((s) => s.openResource)
  const openPanel = useWorkbenchStore((s) => s.openPanel)
  const jobs = useJobsStore((s) => s.jobs)
  const runningCount = useJobsStore((s) => s.runningCount)
  const [status, setStatus] = useState<WorkbenchStatus | null>(null)

  const failedCount = jobs.filter((j) => j.status === 'failed').length
  const openToolSettings = (): void => openResource('settings://tool', 'ツール設定')
  const openProjectSettings = (): void => openResource('project-settings://current', 'プロジェクト設定')

  const refreshStatus = useCallback(async (): Promise<void> => {
    if (!project) {
      setStatus(null)
      return
    }
    const [git, runtime, llm, mcp, projectSettings] = await Promise.all([
      invoke<GitStatusSummary>('git.status'),
      invoke<RuntimeCapabilityStatus>('runtime.capabilities'),
      invoke<LlmStatus>('llm.getSettings'),
      invoke<McpStatus>('mcp.status'),
      invoke<Record<string, unknown>>('settings.getProjectSettings')
    ])
    const level = projectSettings.ok ? projectSettings.result['logging.debugLevel'] : null
    setStatus({
      git: git.ok ? git.result : null,
      runtime: runtime.ok ? runtime.result : null,
      llm: llm.ok ? llm.result : null,
      mcp: mcp.ok ? mcp.result : null,
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
      if (event === 'git.committed' || event === 'project.opened' || event === 'mcp.statusChanged') void refreshStatus()
    })
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshOnFocus)
      offEvents()
    }
  }, [project, refreshStatus])

  return (
    <footer className="wb-statusbar" data-testid="status-bar">
      <StatusItem icon="folder" testId="status-project">
        {project ? project.name : 'プロジェクト未選択'}
      </StatusItem>
      {project && (
        <>
          <StatusItem
            icon="shuffle"
            testId="status-git"
            title="ローカルupstream参照に対する同期状態（fetchは実行しません）"
          >
            {gitStatusLabel(status?.git ?? null)}
          </StatusItem>
          <StatusItem
            icon="tool"
            testId="status-plantuml"
            title={`ツール設定を開く（解決元: ${status?.runtime?.plantUml.source ?? 'unavailable'}）`}
            onClick={openToolSettings}
          >
            {capabilityLabel('PlantUML', status?.runtime?.plantUml)}
          </StatusItem>
          <StatusItem
            icon="type"
            testId="status-mecab"
            title={`ツール設定を開く（解決元: ${status?.runtime?.mecab.source ?? 'unavailable'}）`}
            onClick={openToolSettings}
          >
            {capabilityLabel('MeCab', status?.runtime?.mecab)}
          </StatusItem>
          <span className="status-llm-group" data-testid="status-llm">
            <StatusItem
              icon="cpu"
              testId="status-llm-provider"
              title="LLM Providerのツール設定を開く"
              onClick={openToolSettings}
            >
              {llmProviderLabel(status?.llm ?? null)}
            </StatusItem>
            <StatusItem
              icon="cloud"
              testId="status-llm-external"
              title="外部LLM送信のプロジェクト設定を開く"
              onClick={openProjectSettings}
            >
              {llmExternalLabel(status?.llm ?? null)}
            </StatusItem>
          </span>
          <StatusItem
            icon="server"
            testId="status-mcp"
            title={`MCPサーバ設定を開く（${status?.mcp?.url ?? '未起動'}）`}
            onClick={openToolSettings}
          >
            {mcpLabel(status?.mcp ?? null)}
          </StatusItem>
          <StatusItem
            icon="bug"
            testId="status-debug-level"
            title="デバッグログレベルのプロジェクト設定を開く"
            onClick={openProjectSettings}
          >
            Debug: {status?.debugLevel ?? 'info'}
          </StatusItem>
        </>
      )}

      <span className="spacer" />
      <StatusItem
        icon={runningCount > 0 ? 'loader' : 'check-circle'}
        testId="status-jobs"
        title="クリックでジョブパネルを開く"
        onClick={() => openPanel('jobs')}
      >
        {runningCount > 0 ? `ジョブ ${runningCount} 実行中` : 'ジョブ待機'}
      </StatusItem>
      {failedCount > 0 && (
        <StatusItem
          icon="alert-triangle"
          className="status-failed"
          onClick={() => openPanel('jobs')}
          title="失敗したジョブを表示"
        >
          失敗 {failedCount}
        </StatusItem>
      )}
    </footer>
  )
}
