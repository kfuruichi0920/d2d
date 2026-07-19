/**
 * 全操作ボタン・入力欄のTooltip保証（P3-10、UI-049、W5）。
 * 明示的な `title`（詳細説明＋例）を最優先し、未設定の場合だけアクセシブル名・placeholder
 * から操作説明を補う。ボタンに加えて input / select / textarea も対象とする。
 */
import { useEffect } from 'react'

export function resolveButtonTooltip(button: HTMLButtonElement): string {
  const explicit = button.dataset.tooltip?.trim()
  if (explicit) return explicit
  const label = button.getAttribute('aria-label')?.trim() || button.textContent?.replace(/\s+/g, ' ').trim()
  return label ? `「${label}」を実行します` : 'この操作を実行します'
}

/** 画面幅縮小時にも意味が残る、操作名ベースの共通アイコン。 */
export function resolveButtonIcon(label: string): string {
  const rules: [RegExp, string][] = [
    [/戻る|前へ|上へ|左/, '←'],
    [/進む|後へ|次へ|右/, '→'],
    [/更新|再読込|再実行/, '↻'],
    [/ホーム|ダッシュボード/, '⌂'],
    [/検索/, '⌕'],
    [/追加|新規|作成/, '＋'],
    [/削除|解除|棄却/, '−'],
    [/保存|確定|採用|承認/, '✓'],
    [/編集|変更|名称/, '✎'],
    [/閉じる|取消|キャンセル/, '×'],
    [/設定/, '⚙'],
    [/開く|表示|プレビュー/, '▣'],
    [/取込|インポート|出力/, '⇩'],
    [/展開/, '⊞'],
    [/折畳|折りたた/, '⊟'],
    [/分析|トレース|関係/, '⌁'],
    [/用語|辞書/, '≡'],
    [/移動|切替/, '⇄']
  ]
  return rules.find(([pattern]) => pattern.test(label))?.[1] ?? '◆'
}

/** 入力欄のアクセシブル名を label 要素 / aria-label / placeholder から解決する */
function resolveFieldLabel(field: HTMLElement): string | null {
  const ariaLabel = field.getAttribute('aria-label')?.trim()
  if (ariaLabel) return ariaLabel
  const id = field.id
  if (id) {
    const label = document
      .querySelector(`label[for="${CSS.escape(id)}"]`)
      ?.textContent?.replace(/\s+/g, ' ')
      .trim()
    if (label) return label
  }
  const wrapped = field.closest('label')?.textContent?.replace(/\s+/g, ' ').trim()
  if (wrapped) return wrapped
  return null
}

export function resolveFieldTooltip(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const label = resolveFieldLabel(field)
  const placeholder = 'placeholder' in field ? field.placeholder.trim() : ''
  if (field instanceof HTMLSelectElement) {
    return label ? `「${label}」を選択します` : '値を選択します'
  }
  if (field instanceof HTMLInputElement && (field.type === 'checkbox' || field.type === 'radio')) {
    return label ? `「${label}」を切り替えます` : 'オン/オフを切り替えます'
  }
  const base = label ? `「${label}」を入力します` : placeholder ? `${placeholder}を入力します` : '値を入力します'
  return placeholder && label ? `${base}（例: ${placeholder}）` : base
}

function ensureTooltip(root: ParentNode): void {
  root.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    if (!button.title.trim()) button.title = resolveButtonTooltip(button)
    const text = button.textContent?.replace(/\s+/g, ' ').trim() || ''
    const label = button.getAttribute('aria-label')?.trim() || text
    if (button.querySelector('svg')) return
    if (label && (!text || /^[\p{L}\p{N}]/u.test(text))) button.dataset.responsiveIcon = resolveButtonIcon(label)
    else if (text.length > 1) button.dataset.responsiveNativeIcon = Array.from(text)[0]
  })
  root
    .querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea')
    .forEach((field) => {
      if (!field.title.trim()) field.title = resolveFieldTooltip(field)
    })
}

export function GlobalButtonTooltips(): null {
  useEffect(() => {
    ensureTooltip(document)
    const observer = new MutationObserver((records) => {
      records.forEach((record) => {
        record.addedNodes.forEach((node) => {
          if (!(node instanceof Element)) return
          if (node instanceof HTMLButtonElement) {
            if (!node.title.trim()) node.title = resolveButtonTooltip(node)
            const text = node.textContent?.replace(/\s+/g, ' ').trim() || ''
            const label = node.getAttribute('aria-label')?.trim() || text
            if (!node.querySelector('svg')) {
              if (label && (!text || /^[\p{L}\p{N}]/u.test(text)))
                node.dataset.responsiveIcon = resolveButtonIcon(label)
              else if (text.length > 1) node.dataset.responsiveNativeIcon = Array.from(text)[0]
            }
          }
          ensureTooltip(node)
        })
      })
    })
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  return null
}
