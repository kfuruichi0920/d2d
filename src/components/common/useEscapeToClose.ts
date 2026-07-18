/**
 * モーダルダイアログの Escape クローズ共通フック（W10、UI-003）。
 * document キャプチャ段階で Escape を受け、最前面（最後に開いた）モーダルだけを閉じる。
 * フォーカスがダイアログ外へ移っていても効くよう、要素の onKeyDown ではなくこちらを使う。
 */
import { useEffect, useRef } from 'react'

/** 開いている順のモーダルスタック。末尾が最前面 */
const stack: symbol[] = []

export function useEscapeToClose(active: boolean, onClose: () => void): void {
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!active) return
    const token = Symbol('modal')
    stack.push(token)
    const handler = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      if (stack[stack.length - 1] !== token) return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current()
    }
    document.addEventListener('keydown', handler, true)
    return () => {
      document.removeEventListener('keydown', handler, true)
      const index = stack.indexOf(token)
      if (index >= 0) stack.splice(index, 1)
    }
  }, [active])
}
