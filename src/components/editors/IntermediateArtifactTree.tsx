/** 中間成果物の階層Tree表示（P7-7、MID-003、UI-012）。 */
import { useEffect, useRef } from 'react'
import { resourceTypeLabel } from '../../types/resource'
import type { HierarchyRow, HierarchyItem } from '../../utils/intermediate-hierarchy'

export interface IntermediateTreeItem extends HierarchyItem {
  type: string
  item_type?: string
  text?: string
  section_path?: string
  image?: string
}

export function IntermediateArtifactTree<T extends IntermediateTreeItem>({
  rows,
  selectedIds,
  activeId,
  collapsedIds,
  onToggle,
  onSelect,
  onOpen,
  onMove,
  onRowContextMenu
}: {
  rows: HierarchyRow<T>[]
  selectedIds: ReadonlySet<string>
  activeId: string | null
  collapsedIds: ReadonlySet<string>
  onToggle(id: string): void
  onSelect(item: T, event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): void
  onOpen(item: T): void
  onMove(item: T, direction: -1 | 1, extend: boolean): void
  /** 行の右クリック。コンテキストメニュー表示に使う（MID-004 UI改善） */
  onRowContextMenu?(item: T, event: React.MouseEvent<HTMLElement>): void
}): React.JSX.Element {
  const refs = useRef(new Map<string, HTMLElement>())
  useEffect(() => {
    if (activeId) refs.current.get(activeId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [activeId, rows])

  return (
    <div className="intermediate-artifact-tree" data-testid="intermediate-artifact-tree" role="tree">
      {rows.map(({ item, depth, hasChildren }) => (
        <div
          key={item.id}
          ref={(node) => {
            if (node) refs.current.set(item.id, node)
            else refs.current.delete(item.id)
          }}
          role="treeitem"
          tabIndex={0}
          aria-level={depth + 1}
          aria-expanded={hasChildren ? !collapsedIds.has(item.id) : undefined}
          aria-selected={selectedIds.has(item.id)}
          className={`intermediate-artifact-tree-row${selectedIds.has(item.id) ? ' selected' : ''}`}
          style={{ paddingInlineStart: 4 + depth * 16 }}
          data-testid={`intermediate-tree-${item.id}`}
          onClick={(event) => onSelect(item, event)}
          onDoubleClick={() => onOpen(item)}
          onContextMenu={onRowContextMenu ? (event) => onRowContextMenu(item, event) : undefined}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft' && hasChildren && !collapsedIds.has(item.id)) {
              event.preventDefault()
              onToggle(item.id)
            } else if (event.key === 'ArrowRight' && hasChildren && collapsedIds.has(item.id)) {
              event.preventDefault()
              onToggle(item.id)
            } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
              event.preventDefault()
              onMove(item, event.key === 'ArrowUp' ? -1 : 1, event.shiftKey)
            } else if (event.key === ' ' || event.key === 'Enter') {
              event.preventDefault()
              onOpen(item)
            }
          }}
        >
          <button
            type="button"
            className="intermediate-tree-toggle"
            aria-label={collapsedIds.has(item.id) ? '子要素を展開' : '子要素を折り畳む'}
            disabled={!hasChildren}
            onClick={(event) => {
              event.stopPropagation()
              if (hasChildren) onToggle(item.id)
            }}
          >
            {hasChildren ? (collapsedIds.has(item.id) ? '▸' : '▾') : '·'}
          </button>
          <span className="intermediate-outline-kind">{resourceTypeLabel(item.item_type ?? item.type)}</span>
          <code>{item.id}</code>
          <span>{item.text ?? item.section_path ?? item.image ?? '（内容なし）'}</span>
        </div>
      ))}
      {rows.length === 0 && <div className="d2d-empty">構成要素がありません</div>}
    </div>
  )
}
