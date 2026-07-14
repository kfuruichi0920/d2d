/**
 * Secondary Side Bar（P3-9、UI-026、sdd_ui_design §11）。
 * 現在の選択対象（Selection）に依存する補助情報の表示に限定する。
 */
import { useEditorStore } from '../../stores/editor-store'
import { useWorkbenchStore, type SecondaryTab } from '../../stores/workbench-store'
import { useSelectionStore } from '../../stores/selection-store'

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
  const extractedItems = useSelectionStore((s) => s.extractedItems)
  const workbenchItems = useSelectionStore((s) => s.workbenchItems)

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
          activeUri?.startsWith('intermediate://') && workbenchItems.length > 0 ? (
            <dl className="d2d-kv" data-testid="intermediate-item-properties">
              <dt>選択ペイン</dt>
              <dd>{workbenchItems[0]!.pane === 'extracted' ? '統合元 extracted_item' : '成果物 intermediate_item'}</dd>
              <dt>選択数</dt>
              <dd>{workbenchItems.length}</dd>
              {workbenchItems.length === 1 && (
                <>
                  <dt>要素ID</dt>
                  <dd>{workbenchItems[0]!.id}</dd>
                  <dt>Resource UID</dt>
                  <dd>{workbenchItems[0]!.resourceUid ?? '—'}</dd>
                  <dt>種別</dt>
                  <dd>{workbenchItems[0]!.type}</dd>
                  <dt>状態</dt>
                  <dd>{workbenchItems[0]!.status}</dd>
                  <dt>本文／画像</dt>
                  <dd>{workbenchItems[0]!.text ?? '—'}</dd>
                </>
              )}
            </dl>
          ) : activeUri?.startsWith('extracted://') && extractedItems.length > 0 ? (
            <dl className="d2d-kv" data-testid="extracted-item-properties">
              <dt>選択数</dt>
              <dd>{extractedItems.length}</dd>
              {extractedItems.length === 1 && (
                <>
                  <dt>要素ID</dt>
                  <dd>{extractedItems[0]!.id}</dd>
                  <dt>Resource UID</dt>
                  <dd>{extractedItems[0]!.resourceUid ?? '—'}</dd>
                  <dt>種別</dt>
                  <dd>{extractedItems[0]!.type}</dd>
                  <dt>状態</dt>
                  <dd>{extractedItems[0]!.status}</dd>
                  <dt>章節</dt>
                  <dd>{extractedItems[0]!.sectionPath ?? '—'}</dd>
                  <dt>本文／画像</dt>
                  <dd>{extractedItems[0]!.text ?? extractedItems[0]!.image ?? '—'}</dd>
                  {extractedItems[0]!.level !== null && (
                    <>
                      <dt>レベル</dt>
                      <dd>{extractedItems[0]!.level}</dd>
                    </>
                  )}
                  {extractedItems[0]!.rowCount !== null && (
                    <>
                      <dt>表サイズ</dt>
                      <dd>
                        {extractedItems[0]!.rowCount} × {extractedItems[0]!.columnCount}
                      </dd>
                    </>
                  )}
                </>
              )}
            </dl>
          ) : activeUri ? (
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
