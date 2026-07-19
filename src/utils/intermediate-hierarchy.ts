/** 中間文書の表示順とlevelから、親子・折畳表示を導出する（P7-7、MID-003、UI-012）。 */
export interface HierarchyItem {
  id: string
  level?: number
}

export interface HierarchyRow<T extends HierarchyItem> {
  item: T
  depth: number
  parentId: string | null
  hasChildren: boolean
}

export function buildHierarchyRows<T extends HierarchyItem>(items: T[]): HierarchyRow<T>[] {
  const stack: { id: string; level: number }[] = []
  const rows = items.map((item) => {
    const level = Math.max(0, item.level ?? 0)
    while (stack.length > 0 && stack.at(-1)!.level >= level) stack.pop()
    const parentId = stack.at(-1)?.id ?? null
    stack.push({ id: item.id, level })
    return { item, depth: stack.length - 1, parentId, hasChildren: false }
  })
  const byId = new Map(rows.map((row) => [row.item.id, row]))
  rows.forEach((row) => {
    if (row.parentId) {
      const parent = byId.get(row.parentId)
      if (parent) parent.hasChildren = true
    }
  })
  return rows
}

export function visibleHierarchyRows<T extends HierarchyItem>(
  items: T[],
  collapsedIds: ReadonlySet<string>
): HierarchyRow<T>[] {
  const rows = buildHierarchyRows(items)
  const hidden = new Set<string>()
  for (const row of rows) {
    if (row.parentId && (hidden.has(row.parentId) || collapsedIds.has(row.parentId))) hidden.add(row.item.id)
  }
  return rows.filter((row) => !hidden.has(row.item.id))
}
