/** Shift+上下矢印による連続範囲選択（UI-012）。 */
export interface KeyboardRangeSelection {
  activeId: string
  anchorId: string
  selectedIds: Set<string>
}

export function moveKeyboardRangeSelection<T>(
  items: readonly T[],
  activeId: string | null,
  anchorId: string | null,
  delta: -1 | 1,
  extend: boolean,
  getId: (item: T) => string | null | undefined,
  selectable: (item: T) => boolean = () => true
): KeyboardRangeSelection | null {
  const eligible = items
    .filter((item) => selectable(item))
    .map((item) => ({ item, id: getId(item) }))
    .filter((entry): entry is { item: T; id: string } => Boolean(entry.id))
  if (eligible.length === 0) return null

  let currentIndex = eligible.findIndex((entry) => entry.id === activeId)
  if (currentIndex < 0) currentIndex = delta > 0 ? -1 : eligible.length
  const nextIndex = Math.max(0, Math.min(eligible.length - 1, currentIndex + delta))
  const nextId = eligible[nextIndex]!.id

  if (!extend) {
    return { activeId: nextId, anchorId: nextId, selectedIds: new Set([nextId]) }
  }

  const currentId = activeId && eligible.some((entry) => entry.id === activeId) ? activeId : nextId
  const resolvedAnchor = anchorId && eligible.some((entry) => entry.id === anchorId) ? anchorId : currentId
  const anchorIndex = eligible.findIndex((entry) => entry.id === resolvedAnchor)
  const from = Math.min(anchorIndex, nextIndex)
  const to = Math.max(anchorIndex, nextIndex)
  return {
    activeId: nextId,
    anchorId: resolvedAnchor,
    selectedIds: new Set(eligible.slice(from, to + 1).map((entry) => entry.id))
  }
}
