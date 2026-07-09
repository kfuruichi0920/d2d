/**
 * Secondary Side Bar（P3-9、UI-026、sdd_ui_design §11）。
 * 現在の選択対象（Selection）に依存する補助情報の表示に限定する。
 */
import { useEditorStore } from '../../stores/editor-store'
import { useWorkbenchStore, type SecondaryTab } from '../../stores/workbench-store'

const TABS: { id: SecondaryTab; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'relations', label: 'Relations' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'review', label: 'Review' }
]

export function SecondarySideBar(): React.JSX.Element {
  const tab = useWorkbenchStore((s) => s.secondaryTab)
  const setTab = useWorkbenchStore((s) => s.setSecondaryTab)
  const activeUri = useEditorStore((s) => s.activeUri)

  return (
    <aside className="wb-secondary" data-testid="secondary-sidebar">
      <div className="wb-tabstrip">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? 'active' : ''}
            onClick={() => setTab(t.id)}
            data-testid={`secondary-tab-${t.id}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="wb-sidebar-body">
        {tab === 'properties' ? (
          activeUri ? (
            <dl className="d2d-kv">
              <dt>Resource</dt>
              <dd>{activeUri}</dd>
              <dt>種別</dt>
              <dd>{activeUri.split('://')[0]}</dd>
            </dl>
          ) : (
            <div className="d2d-empty">Resource が選択されていません</div>
          )
        ) : (
          <div className="d2d-empty">
            {TABS.find((t) => t.id === tab)?.label} は対象データ実装後に接続します（Evidence/Relations:
            P5〜P9、Candidates/Review: P5/P8）
          </div>
        )}
      </div>
    </aside>
  )
}
