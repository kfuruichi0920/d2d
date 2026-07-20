/**
 * Command 基盤（P3-2、UI-003/004/023/024、sdd_ui_design §4.2/§14/§15）。
 * 主要操作は Command として登録し、メニュー・パレット・ショートカットから一貫して実行する。
 * 有効/無効は Context Key で制御する。
 */

export interface CommandContext {
  workMode: string
  hasProject: boolean
  activeResourceUri: string | null
  isJobRunning: boolean
  hasDirtyEditor: boolean
}

export interface CommandDefinition {
  id: string
  title: string
  category?: string
  /** 例: 'Ctrl+Shift+P'、'Ctrl+1' */
  keybinding?: string
  /** 未指定なら常に有効 */
  isEnabled?: (ctx: CommandContext) => boolean
  /** パレットに表示しない内部コマンド */
  hidden?: boolean
  /** 入力欄・テキストエリア内ではショートカットを無効化する（Ctrl+Z 等、編集系との衝突回避） */
  skipInEditable?: boolean
  run: (arg?: unknown) => void | Promise<void>
}

const commands = new Map<string, CommandDefinition>()

/** キーバインド解決関数。keybindings.ts がユーザー上書きを考慮した resolver を注入する */
let keybindingResolver: (def: Pick<CommandDefinition, 'id' | 'keybinding'>) => string | undefined = (def) =>
  def.keybinding

export function setKeybindingResolver(
  resolver: (def: Pick<CommandDefinition, 'id' | 'keybinding'>) => string | undefined
): void {
  keybindingResolver = resolver
}

/** ユーザー上書きを考慮した実効キーバインドを返す */
export function resolveKeybinding(def: Pick<CommandDefinition, 'id' | 'keybinding'>): string | undefined {
  return keybindingResolver(def)
}

export function registerCommand(def: CommandDefinition): () => void {
  if (commands.has(def.id)) {
    throw new Error(`Command already registered: ${def.id}`)
  }
  commands.set(def.id, def)
  return () => commands.delete(def.id)
}

export function listCommands(): CommandDefinition[] {
  return [...commands.values()]
}

export function getCommand(id: string): CommandDefinition | undefined {
  return commands.get(id)
}

export async function executeCommand(id: string, arg?: unknown, ctx?: CommandContext): Promise<void> {
  const def = commands.get(id)
  if (!def) {
    console.warn(`[command] 未登録の Command: ${id}`)
    return
  }
  if (ctx && def.isEnabled && !def.isEnabled(ctx)) {
    return
  }
  await def.run(arg)
}

/** 'Ctrl+Shift+P' 形式のキーバインドを KeyboardEvent と照合する */
export function matchKeybinding(binding: string, e: KeyboardEvent): boolean {
  const parts = binding.split('+').map((p) => p.trim().toLowerCase())
  const key = parts[parts.length - 1]!
  const needCtrl = parts.includes('ctrl')
  const needShift = parts.includes('shift')
  const needAlt = parts.includes('alt')
  if (e.ctrlKey !== needCtrl || e.shiftKey !== needShift || e.altKey !== needAlt) return false
  const eventKey = e.key.toLowerCase()
  if (key === '\\') return eventKey === '\\'
  if (key === '=') return eventKey === '=' || eventKey === '+'
  return eventKey === key
}

/** グローバルショートカットハンドラを設置する。解除関数を返す */
export function installKeybindings(getContext: () => CommandContext): () => void {
  const handler = (e: KeyboardEvent): void => {
    // 入力欄内では単キー系を無効化（Ctrl / Alt 系のみ許可）
    const inEditable =
      e.target instanceof HTMLElement &&
      (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable)
    for (const def of commands.values()) {
      const binding = keybindingResolver(def)
      if (!binding) continue
      if (inEditable && def.skipInEditable) continue
      const lower = binding.toLowerCase()
      const isFunctionKey = /^f(?:[1-9]|1[0-2])$/i.test(binding)
      if (inEditable && !lower.includes('ctrl') && !lower.includes('alt') && !isFunctionKey) continue
      if (matchKeybinding(binding, e)) {
        e.preventDefault()
        void executeCommand(def.id, undefined, getContext())
        return
      }
    }
  }
  window.addEventListener('keydown', handler)
  return () => window.removeEventListener('keydown', handler)
}
