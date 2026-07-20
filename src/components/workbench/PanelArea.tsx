/** 下段Panel（sdd_ui_design §12）。全文検索結果はSearch Activity内に表示する。 */
import { PANEL_TAB_ORDER, useWorkbenchStore, type PanelTab } from '../../stores/workbench-store'
import { JobsListView } from '../views/JobsListView'
import { LlmLogsPanel } from '../views/LlmViews'
import { ProblemsView } from '../views/TraceViews'
import { LogsPanel } from '../views/LogsPanel'
import { McpLogPanel } from '../views/McpLogPanel'

// 表示名は他UIと同じ日本語へ統一する（UI点検対応。testid は英語IDのまま維持）
const LABELS: Record<PanelTab, string> = {
  problems: '問題',
  output: '出力',
  jobs: 'ジョブ',
  validation: '検証',
  llm: 'LLMログ',
  mcp: 'MCPログ'
}

export function PanelArea(): React.JSX.Element {
  const tab = useWorkbenchStore((state) => state.panelTab)
  const setTab = useWorkbenchStore((state) => state.setPanelTab)
  const togglePanel = useWorkbenchStore((state) => state.togglePanel)
  return (
    <section
      className="wb-panel"
      data-testid="panel"
      data-workbench-tab-region="panel"
      tabIndex={-1}
      onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
    >
      <div className="wb-tabstrip">
        {PANEL_TAB_ORDER.map((id) => (
          <button
            key={id}
            type="button"
            className={tab === id ? 'active' : ''}
            onClick={() => setTab(id)}
            data-testid={`panel-tab-${id}`}
          >
            {LABELS[id]}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <button type="button" title="Panel を閉じる" onClick={togglePanel}>
          ×
        </button>
      </div>
      <div className="wb-panel-body">
        {tab === 'jobs' ? (
          <JobsListView />
        ) : tab === 'llm' ? (
          <LlmLogsPanel />
        ) : tab === 'problems' ? (
          <ProblemsView />
        ) : tab === 'output' ? (
          <LogsPanel />
        ) : tab === 'mcp' ? (
          <McpLogPanel />
        ) : (
          <div className="d2d-empty">Validation は対応機能の実装時に接続します。</div>
        )}
      </div>
    </section>
  )
}
