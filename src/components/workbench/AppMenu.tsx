/**
 * アプリケーションメニュー（W2、UI-003/004）。
 * Title Bar 右上のハンバーガーボタン（Alt+M）から、主要 Command を
 * カテゴリ別ドロップダウンで実行する。項目は Command 定義から解決し、
 * 有効/無効・ショートカット表示をコマンドパレットと一致させる。
 */
import { useEffect, useRef, useState } from 'react'
import { executeCommand, getCommand, resolveKeybinding } from '../../services/command-registry'
import { getCommandContext } from '../../services/builtin-commands'
import { canRedo, canUndo, peekRedoLabel, peekUndoLabel, subscribeUndo } from '../../services/undo-service'
import { useWorkbenchStore } from '../../stores/workbench-store'

/** グループとコマンドIDの静的構成。表示名・キーは Command 定義が正 */
const MENU_GROUPS: { label: string; items: string[] }[] = [
  { label: 'プロジェクト', items: ['project.open', 'project.createInFolder', 'dashboard.open'] },
  { label: '編集', items: ['edit.undo', 'edit.redo'] },
  {
    label: '表示',
    items: [
      'workbench.togglePrimarySideBar',
      'workbench.toggleSecondarySideBar',
      'workbench.togglePanel',
      'mode.resetLayout',
      'theme.fontSize.increase',
      'theme.fontSize.decrease',
      'theme.fontSize.reset'
    ]
  },
  {
    label: '移動・検索',
    items: [
      'nav.back',
      'nav.forward',
      'commandPalette.open',
      'search.screenText',
      'search.focusSidebar',
      'job.openPanel'
    ]
  },
  { label: '設定', items: ['settings.open', 'projectSettings.open'] },
  { label: 'ヘルプ', items: ['help.workflow', 'help.schema', 'help.designModel'] }
]

export function AppMenu(): React.JSX.Element {
  const open = useWorkbenchStore((s) => s.menuOpen)
  const setOpen = useWorkbenchStore((s) => s.setMenuOpen)
  const rootRef = useRef<HTMLDivElement>(null)
  const [, setRevision] = useState(0)

  // Undo/Redo の可否表示をスタック変化へ追従させる。
  useEffect(() => subscribeUndo(() => setRevision((r) => r + 1)), [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    // 開いたら先頭項目へフォーカスし、矢印キー操作を可能にする。
    setTimeout(() => rootRef.current?.querySelector<HTMLButtonElement>('.wb-menu-item:not(:disabled)')?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, setOpen])

  const ctx = getCommandContext()

  const moveFocus = (delta: number): void => {
    const items = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('.wb-menu-item:not(:disabled)') ?? [])]
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = items[(index + delta + items.length) % items.length]
    next?.focus()
  }

  const itemLabel = (id: string, fallbackTitle: string): string => {
    // Undo/Redo は対象操作名まで表示する。
    if (id === 'edit.undo') {
      const label = peekUndoLabel()
      return label ? `元に戻す: ${label}` : '元に戻す'
    }
    if (id === 'edit.redo') {
      const label = peekRedoLabel()
      return label ? `やり直す: ${label}` : 'やり直す'
    }
    return fallbackTitle
  }

  return (
    <div className="wb-app-menu" ref={rootRef}>
      <button
        type="button"
        className={`wb-menu-button ${open ? 'active' : ''}`}
        aria-label="アプリケーションメニュー"
        aria-expanded={open}
        title="アプリケーションメニューを開きます（Alt+M）。主要な操作をカテゴリ別に選択できます"
        data-testid="app-menu-button"
        onClick={() => setOpen(!open)}
      >
        ☰
      </button>
      {open && (
        <div
          className="wb-menu-dropdown"
          role="menu"
          data-testid="app-menu-dropdown"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              moveFocus(1)
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              moveFocus(-1)
            }
          }}
        >
          {MENU_GROUPS.map((group) => {
            const items = group.items
              .map((id) => getCommand(id))
              .filter((def): def is NonNullable<typeof def> => def !== undefined)
            if (items.length === 0) return null
            return (
              <div key={group.label} className="wb-menu-group" role="group" aria-label={group.label}>
                <div className="wb-menu-group-label">{group.label}</div>
                {items.map((def) => {
                  const enabled =
                    (!def.isEnabled || def.isEnabled(ctx)) &&
                    (def.id !== 'edit.undo' || canUndo()) &&
                    (def.id !== 'edit.redo' || canRedo())
                  const keybinding = resolveKeybinding(def)
                  return (
                    <button
                      key={def.id}
                      type="button"
                      role="menuitem"
                      className="wb-menu-item"
                      disabled={!enabled}
                      data-testid={`app-menu-item-${def.id}`}
                      onClick={() => {
                        setOpen(false)
                        void executeCommand(def.id, undefined, ctx)
                      }}
                    >
                      <span>{itemLabel(def.id, def.title)}</span>
                      {keybinding && <span className="kbd">{keybinding}</span>}
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
