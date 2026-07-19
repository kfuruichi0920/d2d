import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canRedo,
  canUndo,
  clearUndoHistory,
  peekRedoLabel,
  peekUndoLabel,
  performRedo,
  performUndo,
  pushUndo
} from './undo-service'

describe('undo-service（W4、NFR-012）', () => {
  beforeEach(() => clearUndoHistory())

  it('push → undo → redo の順で逆操作・再操作が実行される', async () => {
    const undo = vi.fn()
    const redo = vi.fn()
    pushUndo({ label: '名称変更', undo, redo })
    expect(canUndo()).toBe(true)
    expect(peekUndoLabel()).toBe('名称変更')

    expect(await performUndo()).toBe('名称変更')
    expect(undo).toHaveBeenCalledTimes(1)
    expect(canUndo()).toBe(false)
    expect(canRedo()).toBe(true)
    expect(peekRedoLabel()).toBe('名称変更')

    expect(await performRedo()).toBe('名称変更')
    expect(redo).toHaveBeenCalledTimes(1)
    expect(canUndo()).toBe(true)
    expect(canRedo()).toBe(false)
  })

  it('スタックが空なら null を返す', async () => {
    expect(await performUndo()).toBeNull()
    expect(await performRedo()).toBeNull()
  })

  it('新しい操作の push で redo スタックはクリアされる', async () => {
    pushUndo({ label: 'A', undo: () => {}, redo: () => {} })
    await performUndo()
    expect(canRedo()).toBe(true)
    pushUndo({ label: 'B', undo: () => {}, redo: () => {} })
    expect(canRedo()).toBe(false)
    expect(peekUndoLabel()).toBe('B')
  })

  it('undo 失敗時は例外を伝播し、エントリは破棄される（二重取消防止）', async () => {
    pushUndo({
      label: '失敗する操作',
      undo: () => {
        throw new Error('backend error')
      },
      redo: () => {}
    })
    await expect(performUndo()).rejects.toThrow('backend error')
    expect(canUndo()).toBe(false)
    expect(canRedo()).toBe(false)
  })

  it('clearUndoHistory で両スタックを破棄する', async () => {
    pushUndo({ label: 'A', undo: () => {}, redo: () => {} })
    await performUndo()
    pushUndo({ label: 'B', undo: () => {}, redo: () => {} })
    clearUndoHistory()
    expect(canUndo()).toBe(false)
    expect(canRedo()).toBe(false)
  })
})
