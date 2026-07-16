/** Workbench共通の画面内文字検索（P3-10、UI-049）。 */
import { useEffect, useRef, useState } from 'react'

export const OPEN_SCREEN_TEXT_SEARCH = 'd2d:open-screen-text-search'

export function ScreenTextSearch(): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const openSearch = (): void => {
      setOpen(true)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
    const onKey = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        openSearch()
      } else if (event.key === 'Escape' && open) {
        event.preventDefault()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener(OPEN_SCREEN_TEXT_SEARCH, openSearch)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener(OPEN_SCREEN_TEXT_SEARCH, openSearch)
    }
  }, [open])
  if (!open) return null
  const find = (backwards = false): void => {
    if (!query) return
    ;(
      window as unknown as Window & {
        find(text: string, caseSensitive?: boolean, backwards?: boolean, wrap?: boolean): boolean
      }
    ).find(query, false, backwards, true)
  }
  return (
    <div className="screen-text-search" data-testid="screen-text-search">
      <input
        ref={inputRef}
        value={query}
        placeholder="画面内を検索"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') find(e.shiftKey)
        }}
        data-testid="screen-text-search-input"
      />
      <button className="d2d-btn small" onClick={() => find(true)} title="前の一致">
        ↑
      </button>
      <button className="d2d-btn small" onClick={() => find(false)} title="次の一致">
        ↓
      </button>
      <button className="d2d-btn small" onClick={() => setOpen(false)} title="閉じる">
        ×
      </button>
    </div>
  )
}
