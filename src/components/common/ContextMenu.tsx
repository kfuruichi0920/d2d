/**
 * 右クリックコンテキストメニュー共通基盤（W3、UI-003）。
 * 各画面は showContextMenu(event, items) を呼ぶだけでよい。
 * 表示・位置調整・キーボード操作・クローズは Workbench 直下の ContextMenuHost が一元管理する。
 */
import { useEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  /** separator=true の場合は不要 */
  label?: string
  /** 実行時のショートカット等の補足表示 */
  detail?: string
  disabled?: boolean
  separator?: boolean
  testId?: string
  run?: () => void | Promise<void>
}

interface ContextMenuRequest {
  x: number
  y: number
  items: ContextMenuItem[]
}

const SHOW_CONTEXT_MENU = 'd2d:show-context-menu'

/** 右クリックハンドラから呼ぶ。preventDefault も行う */
export function showContextMenu(
  event: Pick<React.MouseEvent, 'clientX' | 'clientY' | 'preventDefault' | 'stopPropagation'>,
  items: ContextMenuItem[]
): void {
  event.preventDefault()
  event.stopPropagation()
  if (items.length === 0) return
  window.dispatchEvent(
    new CustomEvent<ContextMenuRequest>(SHOW_CONTEXT_MENU, {
      detail: { x: event.clientX, y: event.clientY, items }
    })
  )
}

export function ContextMenuHost(): React.JSX.Element | null {
  const [request, setRequest] = useState<ContextMenuRequest | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onShow = (e: Event): void => setRequest((e as CustomEvent<ContextMenuRequest>).detail)
    window.addEventListener(SHOW_CONTEXT_MENU, onShow)
    return () => window.removeEventListener(SHOW_CONTEXT_MENU, onShow)
  }, [])

  useEffect(() => {
    if (!request) return
    const close = (): void => setRequest(null)
    const onPointerDown = (e: MouseEvent): void => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('blur', close)
    window.addEventListener('resize', close)
    setTimeout(() => menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(), 0)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('blur', close)
      window.removeEventListener('resize', close)
    }
  }, [request])

  // 画面端では表示位置を内側へずらす。
  useEffect(() => {
    const menu = menuRef.current
    if (!request || !menu) return
    const rect = menu.getBoundingClientRect()
    const overflowX = Math.max(0, rect.right - window.innerWidth + 4)
    const overflowY = Math.max(0, rect.bottom - window.innerHeight + 4)
    if (overflowX > 0 || overflowY > 0) {
      menu.style.left = `${Math.max(4, request.x - overflowX)}px`
      menu.style.top = `${Math.max(4, request.y - overflowY)}px`
    }
  }, [request])

  if (!request) return null

  const moveFocus = (delta: number): void => {
    const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    items[(index + delta + items.length) % items.length]?.focus()
  }

  return (
    <div
      ref={menuRef}
      className="wb-context-menu"
      role="menu"
      data-testid="context-menu"
      style={{ left: request.x, top: request.y }}
      onContextMenu={(e) => e.preventDefault()}
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
      {request.items.map((item, index) =>
        item.separator ? (
          <div key={index} className="wb-context-menu-separator" role="separator" />
        ) : (
          <button
            key={index}
            type="button"
            role="menuitem"
            className="wb-context-menu-item"
            disabled={item.disabled}
            data-testid={item.testId}
            onClick={() => {
              setRequest(null)
              void item.run?.()
            }}
          >
            <span>{item.label}</span>
            {item.detail && <span className="kbd">{item.detail}</span>}
          </button>
        )
      )}
    </div>
  )
}
