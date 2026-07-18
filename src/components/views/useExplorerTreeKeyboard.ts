/** Explorer Treeの共通キーボード操作（P3-7、UI-045）。 */
import { useEffect, useRef } from 'react'

function isVisible(item: HTMLElement): boolean {
  return item.getClientRects().length > 0
}

function itemsOf(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('[data-explorer-treeitem]')].filter(isVisible)
}

function selectItem(root: HTMLElement, item: HTMLElement, focus = true): void {
  root.querySelectorAll<HTMLElement>('[data-explorer-treeitem]').forEach((candidate) => {
    candidate.setAttribute('aria-selected', String(candidate === item))
  })
  if (focus) item.focus()
}

export function useExplorerTreeKeyboard(): {
  treeRef: React.RefObject<HTMLDivElement | null>
  expandAll: () => void
  collapseAll: () => void
} {
  const treeRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const root = treeRef.current
    if (!root) return
    const initial = root.querySelector<HTMLElement>('[data-explorer-treeitem]')
    if (initial) selectItem(root, initial, false)

    const onClick = (event: MouseEvent): void => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('[data-explorer-treeitem]')
      if (item && root.contains(item)) selectItem(root, item, false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter', ' '].includes(event.key)) return
      const items = itemsOf(root)
      if (items.length === 0) return
      const current = root.querySelector<HTMLElement>('[data-explorer-treeitem][aria-selected="true"]') ?? items[0]!
      const index = Math.max(0, items.indexOf(current))
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const nextIndex = Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)))
        selectItem(root, items[nextIndex]!)
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const action = current.querySelector<HTMLElement>('[data-tree-action]')
        if (action) action.click()
        else current.click()
        return
      }
      const ownDetails = current.tagName === 'SUMMARY' ? (current.parentElement as HTMLDetailsElement | null) : null
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (!ownDetails) return
        if (!ownDetails.open) {
          ownDetails.open = true
          return
        }
        const child = [...ownDetails.querySelectorAll<HTMLElement>('[data-explorer-treeitem]')].find(
          (candidate) => candidate !== current && isVisible(candidate)
        )
        if (child) selectItem(root, child)
        return
      }
      event.preventDefault()
      if (ownDetails?.open) {
        ownDetails.open = false
        return
      }
      const parentDetails = ownDetails
        ? ownDetails.parentElement?.closest<HTMLDetailsElement>('details')
        : current.closest<HTMLDetailsElement>('details')
      const parent = parentDetails?.querySelector<HTMLElement>(':scope > summary[data-explorer-treeitem]')
      if (parent) selectItem(root, parent)
    }

    root.addEventListener('click', onClick, true)
    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('click', onClick, true)
      root.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  return {
    treeRef,
    expandAll: () => treeRef.current?.querySelectorAll('details').forEach((details) => (details.open = true)),
    collapseAll: () => {
      const all = treeRef.current?.querySelectorAll('details')
      all?.forEach((details, index) => (details.open = index === 0))
    }
  }
}
