/**
 * コマンドパレット（P3-2、UI-004、sdd_ui_design §14）。
 * 全 Command を検索・実行できる。Context により無効な Command は淡色表示する。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { executeCommand, listCommands, type CommandDefinition } from '../../services/command-registry'
import { getCommandContext } from '../../services/builtin-commands'
import { useWorkbenchStore } from '../../stores/workbench-store'

export function CommandPalette(): React.JSX.Element | null {
  const open = useWorkbenchStore((s) => s.paletteOpen)
  const setOpen = useWorkbenchStore((s) => s.setPaletteOpen)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const ctx = getCommandContext()

  const items = useMemo(() => {
    const q = query.trim().toLowerCase()
    return listCommands()
      .filter((c) => !c.hidden)
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title, 'ja'))
  }, [query])

  useEffect(() => {
    if (open) {
      setQuery('')
      setSelected(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  if (!open) return null

  const isEnabled = (c: CommandDefinition): boolean => !c.isEnabled || c.isEnabled(ctx)

  const run = (c: CommandDefinition): void => {
    if (!isEnabled(c)) return
    setOpen(false)
    void executeCommand(c.id, undefined, ctx)
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected((s) => Math.min(s + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      const item = items[selected]
      if (item) run(item)
    }
  }

  return (
    <div className="wb-palette-overlay" onClick={() => setOpen(false)} data-testid="command-palette">
      <div className="wb-palette" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setSelected(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="コマンド名を入力…"
          data-testid="palette-input"
        />
        <div className="wb-palette-list" role="listbox">
          {items.length === 0 && <div className="d2d-empty">一致するコマンドがありません</div>}
          {items.map((c, i) => (
            <div
              key={c.id}
              role="option"
              aria-selected={i === selected}
              className={`wb-palette-item ${i === selected ? 'selected' : ''} ${isEnabled(c) ? '' : 'disabled'}`}
              onMouseEnter={() => setSelected(i)}
              onClick={() => run(c)}
            >
              <span>
                {c.category && <span className="category">{c.category}: </span>}
                {c.title}
              </span>
              {c.keybinding && <span className="kbd">{c.keybinding}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
