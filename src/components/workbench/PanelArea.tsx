/**
 * Panel（sdd_ui_design §12）。結果・問題・ログの表示に限定する。
 */
import { useWorkbenchStore, type PanelTab } from '../../stores/workbench-store'
import { JobsListView } from '../views/JobsListView'
import { LlmLogsPanel } from '../views/LlmViews'

const TABS: { id: PanelTab; label: string }[] = [
  { id: 'problems', label: 'Problems' },
  { id: 'output', label: 'Output' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'search', label: 'Search Results' },
  { id: 'validation', label: 'Validation' },
  { id: 'llm', label: 'LLM Logs' }
]

export function PanelArea(): React.JSX.Element {
  const tab = useWorkbenchStore((s) => s.panelTab)
  const setTab = useWorkbenchStore((s) => s.setPanelTab)
  const togglePanel = useWorkbenchStore((s) => s.togglePanel)

  return (
    <section className="wb-panel" data-testid="panel">
      <div className="wb-tabstrip">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
            data-testid={`panel-tab-${t.id}`}
          >
            {t.label}
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
        ) : (
          <div className="d2d-empty">
            {TABS.find((t) => t.id === tab)?.label} は対応機能の実装時に接続します（Problems/Validation: P8〜P9、Search:
            P11）
          </div>
        )}
      </div>
    </section>
  )
}
