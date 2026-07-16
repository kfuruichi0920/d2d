/** 全操作ボタンのTooltip保証（P3-10、UI-049）。 */
import { useEffect } from 'react'

export function resolveButtonTooltip(button: HTMLButtonElement): string {
  const explicit = button.dataset.tooltip?.trim()
  if (explicit) return explicit
  const label = button.getAttribute('aria-label')?.trim() || button.textContent?.replace(/\s+/g, ' ').trim()
  return label ? `「${label}」を実行します` : 'この操作を実行します'
}

function ensureTooltip(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    if (!button.title.trim()) button.title = resolveButtonTooltip(button)
  })
}

export function GlobalButtonTooltips(): null {
  useEffect(() => {
    ensureTooltip(document)
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return
          if (node instanceof HTMLButtonElement && !node.title.trim()) node.title = resolveButtonTooltip(node)
          ensureTooltip(node)
        })
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return null
}
