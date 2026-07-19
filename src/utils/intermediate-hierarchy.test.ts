import { describe, expect, it } from 'vitest'
import { buildHierarchyRows, visibleHierarchyRows } from './intermediate-hierarchy'

describe('中間成果物の階層表示（P7-7、MID-003、UI-012）', () => {
  const items = [
    { id: 'root', level: 0 },
    { id: 'child', level: 1 },
    { id: 'grandchild', level: 2 },
    { id: 'sibling', level: 1 },
    { id: 'next-root', level: 0 }
  ]

  it('表示順の直前にある上位levelを親として導出する', () => {
    expect(
      buildHierarchyRows(items).map(({ item, parentId, depth, hasChildren }) => ({
        id: item.id,
        parentId,
        depth,
        hasChildren
      }))
    ).toEqual([
      { id: 'root', parentId: null, depth: 0, hasChildren: true },
      { id: 'child', parentId: 'root', depth: 1, hasChildren: true },
      { id: 'grandchild', parentId: 'child', depth: 2, hasChildren: false },
      { id: 'sibling', parentId: 'root', depth: 1, hasChildren: false },
      { id: 'next-root', parentId: null, depth: 0, hasChildren: false }
    ])
  })

  it('親を折り畳むと全子孫を非表示にする', () => {
    expect(visibleHierarchyRows(items, new Set(['root'])).map((row) => row.item.id)).toEqual(['root', 'next-root'])
  })
})
