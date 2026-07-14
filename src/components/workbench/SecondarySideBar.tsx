/**
 * Secondary Side Bar（P3-9、UI-026/040、sdd_ui_design §11）。
 * 補助情報を縦アコーディオンで並べ、複数セクションを同時参照可能にする。
 */
import { useEditorStore } from '../../stores/editor-store'
import { useWorkbenchStore, type SecondaryTab } from '../../stores/workbench-store'
import { useSelectionStore } from '../../stores/selection-store'

const SECTIONS: { id: SecondaryTab; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'evidence', label: 'Evidence' },
  { id: 'relations', label: 'Relations' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'review', label: 'Review' }
]

export function SecondarySideBar(): React.JSX.Element {
  const activeSection = useWorkbenchStore((state) => state.secondaryTab)
  const expanded = useWorkbenchStore((state) => state.secondaryExpanded)
  const toggleSection = useWorkbenchStore((state) => state.toggleSecondarySection)

  return (
    <aside className="wb-secondary" data-testid="secondary-sidebar">
      <div className="wb-secondary-accordions">
        {SECTIONS.map((section) => {
          const open = expanded.includes(section.id)
          return (
            <section
              key={section.id}
              className={'wb-secondary-accordion ' + (activeSection === section.id ? 'active' : '')}
              data-testid={'secondary-accordion-' + section.id}
            >
              <button
                type="button"
                className="wb-secondary-accordion-header"
                aria-expanded={open}
                onClick={() => toggleSection(section.id)}
                data-testid={'secondary-tab-' + section.id}
              >
                <span>{open ? '▾' : '▸'}</span>
                {section.label}
              </button>
              {open && (
                <div className="wb-secondary-accordion-body">
                  {section.id === 'properties' ? (
                    <PropertiesContent />
                  ) : (
                    <div className="d2d-empty">
                      {section.label} は対象データ実装後に接続します（Evidence/Relations: P5〜P9、 Candidates/Review:
                      P5/P8）
                    </div>
                  )}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </aside>
  )
}

function PropertiesContent(): React.JSX.Element {
  const activeUri = useEditorStore((state) => state.activeUri)
  const extractedItems = useSelectionStore((state) => state.extractedItems)
  const workbenchItems = useSelectionStore((state) => state.workbenchItems)

  if (activeUri?.startsWith('intermediate://') && workbenchItems.length > 0) {
    return (
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
    )
  }

  if (activeUri?.startsWith('extracted://') && extractedItems.length > 0) {
    return (
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
    )
  }

  if (activeUri) {
    return (
      <dl className="d2d-kv">
        <dt>Resource</dt>
        <dd>{activeUri}</dd>
        <dt>種別</dt>
        <dd>{activeUri.split('://')[0]}</dd>
      </dl>
    )
  }
  return <div className="d2d-empty">Resource が選択されていません</div>
}
