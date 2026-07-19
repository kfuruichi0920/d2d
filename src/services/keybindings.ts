/**
 * キーバインド上書き管理（W1、UI-003/023/024 拡張、NFR-012 関連 UI 基盤）。
 * Command 既定の keybinding をユーザー設定で上書き・解除し、localStorage に永続化する。
 * command-registry とは resolver 注入で連携し、循環 import を避ける。
 */
import { listCommands, setKeybindingResolver, type CommandDefinition } from './command-registry'

export const KEYBINDING_STORAGE_KEY = 'd2d.keybindings.overrides'

/** commandId → 'Ctrl+Alt+K' 形式。null は「既定バインドの解除」を表す */
export type KeybindingOverrides = Record<string, string | null>

type KeybindingStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

let overrides: KeybindingOverrides = {}
let storage: KeybindingStorage | null = typeof localStorage !== 'undefined' ? localStorage : null
const listeners = new Set<() => void>()

/** テスト用にストレージを差し替える（null でメモリのみ） */
export function setKeybindingStorage(next: KeybindingStorage | null): void {
  storage = next
}

function notifyListeners(): void {
  listeners.forEach((fn) => fn())
}

/** 上書きの変更を購読する（Settings 画面の再描画用）。解除関数を返す */
export function subscribeKeybindings(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 永続化済みの上書きを読み込む（起動時に一度呼ぶ） */
export function loadKeybindingOverrides(): void {
  overrides = {}
  try {
    const raw = storage?.getItem(KEYBINDING_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object') {
        for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (value === null || typeof value === 'string') overrides[id] = value
        }
      }
    }
  } catch {
    overrides = {}
  }
  notifyListeners()
}

function persist(): void {
  try {
    storage?.setItem(KEYBINDING_STORAGE_KEY, JSON.stringify(overrides))
  } catch {
    // 永続化失敗は操作を妨げない。
  }
}

export function getKeybindingOverrides(): KeybindingOverrides {
  return { ...overrides }
}

/** 上書きを考慮した実効キーバインドを返す */
export function effectiveKeybinding(def: Pick<CommandDefinition, 'id' | 'keybinding'>): string | undefined {
  if (def.id in overrides) return overrides[def.id] ?? undefined
  return def.keybinding
}

/** 上書きを設定する（null は既定バインドの解除） */
export function setKeybindingOverride(commandId: string, binding: string | null): void {
  overrides[commandId] = binding
  persist()
  notifyListeners()
}

/** 上書きを削除して既定へ戻す */
export function resetKeybindingOverride(commandId: string): void {
  delete overrides[commandId]
  persist()
  notifyListeners()
}

export function resetAllKeybindingOverrides(): void {
  overrides = {}
  persist()
  notifyListeners()
}

const SHARED_TAB_BINDING_GROUPS = [
  new Set(['editor.tab.previous', 'panel.tab.previous']),
  new Set(['editor.tab.next', 'panel.tab.next'])
]

/** Editor/下Panelの同方向タブ移動だけは、フォーカス領域で振り分けるため同じキーを許可する。 */
export function canShareKeybinding(firstCommandId: string, secondCommandId: string): boolean {
  return SHARED_TAB_BINDING_GROUPS.some((group) => group.has(firstCommandId) && group.has(secondCommandId))
}

/** 同じ実効キーバインドを持つ別 Command を返す（衝突検出） */
export function findKeybindingConflict(binding: string, excludeCommandId: string): CommandDefinition | null {
  const normalized = binding.toLowerCase()
  for (const def of listCommands()) {
    if (def.id === excludeCommandId) continue
    if (canShareKeybinding(def.id, excludeCommandId)) continue
    const effective = effectiveKeybinding(def)
    if (effective && effective.toLowerCase() === normalized) return def
  }
  return null
}

const MODIFIER_KEYS = new Set(['control', 'shift', 'alt', 'meta'])

/**
 * KeyboardEvent を 'Ctrl+Shift+K' 形式へ正規化する。
 * 修飾キー単独・修飾なしの1文字キー（誤爆しやすい）は null を返す。
 * F1〜F12 と Escape/Delete 等の特殊キーは修飾なしでも許可する。
 */
export function normalizeKeybindingEvent(
  e: Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'shiftKey' | 'altKey'>
): string | null {
  const key = e.key
  if (!key || MODIFIER_KEYS.has(key.toLowerCase())) return null
  const hasModifier = e.ctrlKey || e.altKey
  const isSpecial = key.length > 1
  if (!hasModifier && !isSpecial) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.shiftKey) parts.push('Shift')
  if (e.altKey) parts.push('Alt')
  parts.push(key.length === 1 ? key.toUpperCase() : key)
  return parts.join('+')
}

// command-registry のショートカット照合が実効キーバインドを使うようにする（モジュール読込時に一度だけ）。
setKeybindingResolver(effectiveKeybinding)
