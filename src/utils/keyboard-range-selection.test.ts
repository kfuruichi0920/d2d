import { describe, expect, it } from 'vitest'
import { moveKeyboardRangeSelection } from './keyboard-range-selection'

const rows = [
  { id: 'a', enabled: true },
  { id: 'b', enabled: false },
  { id: 'c', enabled: true },
  { id: 'd', enabled: true }
]

describe('moveKeyboardRangeSelection', () => {
  it('Shift+下でアンカーから選択範囲を拡張する', () => {
    const result = moveKeyboardRangeSelection(rows, 'a', 'a', 1, true, (row) => row.id)
    expect(result?.activeId).toBe('b')
    expect([...result!.selectedIds]).toEqual(['a', 'b'])
  })

  it('Shift+上でアンカーへ戻ると選択範囲を縮小する', () => {
    const result = moveKeyboardRangeSelection(rows, 'c', 'a', -1, true, (row) => row.id)
    expect(result?.activeId).toBe('b')
    expect([...result!.selectedIds]).toEqual(['a', 'b'])
  })

  it('選択不可行を飛ばして範囲選択する', () => {
    const result = moveKeyboardRangeSelection(
      rows,
      'a',
      'a',
      1,
      true,
      (row) => row.id,
      (row) => row.enabled
    )
    expect(result?.activeId).toBe('c')
    expect([...result!.selectedIds]).toEqual(['a', 'c'])
  })

  it('Shiftなしでは次の1行だけを選びアンカーを更新する', () => {
    const result = moveKeyboardRangeSelection(rows, 'c', 'a', 1, false, (row) => row.id)
    expect(result).toEqual({
      activeId: 'd',
      anchorId: 'd',
      selectedIds: new Set(['d'])
    })
  })
})
