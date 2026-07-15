/** 文書形式非依存のプレビューメタ情報表示（P3-10、UI-049）。 */
import { useSyncExternalStore } from 'react'
export interface PreviewMetaOptions {
  parts: boolean
  sections: boolean
  elementIds: boolean
}
const KEY = 'd2d.preview.meta'
const fallback: PreviewMetaOptions = { parts: true, sections: true, elementIds: true }
let value: PreviewMetaOptions = (() => {
  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }
  } catch {
    return fallback
  }
})()
const listeners = new Set<() => void>()
function subscribe(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
export function useDocumentPreviewMeta(): [PreviewMetaOptions, (next: PreviewMetaOptions) => void] {
  const current = useSyncExternalStore(
    subscribe,
    () => value,
    () => fallback
  )
  return [
    current,
    (next) => {
      value = next
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {}
      listeners.forEach((fn) => fn())
    }
  ]
}
export function DocumentPreviewMetaControls({
  options,
  onChange
}: {
  options: PreviewMetaOptions
  onChange: (next: PreviewMetaOptions) => void
}): React.JSX.Element {
  return (
    <div className="document-preview-meta-controls" data-testid="document-preview-meta-controls">
      {(
        [
          ['parts', 'パーツ種別'],
          ['sections', 'セクション'],
          ['elementIds', '要素ID']
        ] as const
      ).map(([key, label]) => (
        <label key={key}>
          <input
            type="checkbox"
            checked={options[key]}
            onChange={(e) => onChange({ ...options, [key]: e.target.checked })}
          />
          {label}
        </label>
      ))}
    </div>
  )
}
