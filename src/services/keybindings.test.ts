import { beforeEach, describe, expect, it } from 'vitest'
import { registerCommand, resolveKeybinding } from './command-registry'
import {
  KEYBINDING_STORAGE_KEY,
  canShareKeybinding,
  effectiveKeybinding,
  findKeybindingConflict,
  getKeybindingOverrides,
  loadKeybindingOverrides,
  normalizeKeybindingEvent,
  resetAllKeybindingOverrides,
  resetKeybindingOverride,
  setKeybindingOverride,
  setKeybindingStorage
} from './keybindings'

/** localStorage の無い node 環境向けメモリストレージ */
function memoryStorage(): { data: Map<string, string> } & Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const data = new Map<string, string>()
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key)
  }
}

describe('keybindings（W1、UI-003/023）', () => {
  let storage: ReturnType<typeof memoryStorage>

  beforeEach(() => {
    storage = memoryStorage()
    setKeybindingStorage(storage)
    loadKeybindingOverrides()
  })

  it('上書き・解除・既定復元が実効キーバインドへ反映される', () => {
    const def = { id: 'test.kb.a', keybinding: 'Ctrl+9' }
    expect(effectiveKeybinding(def)).toBe('Ctrl+9')
    setKeybindingOverride(def.id, 'Ctrl+Alt+9')
    expect(effectiveKeybinding(def)).toBe('Ctrl+Alt+9')
    setKeybindingOverride(def.id, null)
    expect(effectiveKeybinding(def)).toBeUndefined()
    resetKeybindingOverride(def.id)
    expect(effectiveKeybinding(def)).toBe('Ctrl+9')
  })

  it('上書きは localStorage 相当へ永続化され、再読込で復元される', () => {
    setKeybindingOverride('test.kb.persist', 'Ctrl+Alt+P')
    expect(storage.data.get(KEYBINDING_STORAGE_KEY)).toContain('test.kb.persist')
    loadKeybindingOverrides()
    expect(getKeybindingOverrides()['test.kb.persist']).toBe('Ctrl+Alt+P')
    resetAllKeybindingOverrides()
    loadKeybindingOverrides()
    expect(getKeybindingOverrides()).toEqual({})
  })

  it('command-registry の resolveKeybinding が上書きを反映する', () => {
    const off = registerCommand({ id: 'test.kb.registry', title: 'KB', keybinding: 'Ctrl+8', run: () => {} })
    expect(resolveKeybinding({ id: 'test.kb.registry', keybinding: 'Ctrl+8' })).toBe('Ctrl+8')
    setKeybindingOverride('test.kb.registry', 'Ctrl+Shift+8')
    expect(resolveKeybinding({ id: 'test.kb.registry', keybinding: 'Ctrl+8' })).toBe('Ctrl+Shift+8')
    resetKeybindingOverride('test.kb.registry')
    off()
  })

  it('衝突検出は他 Command の実効キーバインドと大文字小文字を無視して照合する', () => {
    const off = registerCommand({ id: 'test.kb.conflict', title: 'C', keybinding: 'Ctrl+Alt+X', run: () => {} })
    expect(findKeybindingConflict('ctrl+alt+x', 'other.command')?.id).toBe('test.kb.conflict')
    expect(findKeybindingConflict('Ctrl+Alt+X', 'test.kb.conflict')).toBeNull()
    expect(findKeybindingConflict('Ctrl+Alt+Y', 'other.command')).toBeNull()
    off()
  })

  it('Editorと下Panelの同方向タブ移動は同じショートカットを共有できる', () => {
    expect(canShareKeybinding('editor.tab.previous', 'panel.tab.previous')).toBe(true)
    expect(canShareKeybinding('editor.tab.next', 'panel.tab.next')).toBe(true)
    expect(canShareKeybinding('editor.tab.previous', 'panel.tab.next')).toBe(false)
  })

  it('normalizeKeybindingEvent はイベントをバインド文字列へ正規化する', () => {
    expect(normalizeKeybindingEvent({ key: 'k', ctrlKey: true, shiftKey: false, altKey: true })).toBe('Ctrl+Alt+K')
    expect(normalizeKeybindingEvent({ key: 'F2', ctrlKey: false, shiftKey: false, altKey: false })).toBe('F2')
    // 修飾キー単独・修飾なし1文字は拒否する
    expect(normalizeKeybindingEvent({ key: 'Control', ctrlKey: true, shiftKey: false, altKey: false })).toBeNull()
    expect(normalizeKeybindingEvent({ key: 'a', ctrlKey: false, shiftKey: false, altKey: false })).toBeNull()
  })
})
