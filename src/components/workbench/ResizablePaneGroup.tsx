/**
 * 編集画面内の共通可変ペイン（P3-1、UI-038）。
 * 隣接ペインの合計比率を維持したまま、共通ResizeHandleで境界を移動する。
 */
import { Children, Fragment, useRef, useState, type ReactNode } from 'react'
import { ResizeHandle } from './ResizeHandle'

export function normalizePaneSizes(values: number[], count: number): number[] {
  const source = values.length === count ? values : Array.from({ length: count }, () => 1)
  const total = source.reduce((sum, value) => sum + Math.max(value, 0.01), 0)
  return source.map((value) => Math.max(value, 0.01) / total)
}

export function resizePaneSizes(
  current: number[],
  index: number,
  delta: number,
  width: number,
  minPaneSize: number
): number[] {
  if (width <= 0 || index < 0 || index >= current.length - 1) return current
  const next = [...current]
  const pairTotal = next[index]! + next[index + 1]!
  const minimum = Math.min(minPaneSize / width, pairTotal / 2)
  next[index] = Math.max(minimum, Math.min(pairTotal - minimum, next[index]! + delta / width))
  next[index + 1] = pairTotal - next[index]
  return next
}

export function ResizablePaneGroup({
  children,
  initialSizes,
  testId,
  className,
  minPaneSize = 120
}: {
  children: ReactNode
  initialSizes: number[]
  testId: string
  className?: string
  minPaneSize?: number
}): React.JSX.Element {
  const panes = Children.toArray(children)
  const containerRef = useRef<HTMLDivElement>(null)
  const [sizes, setSizes] = useState(() => normalizePaneSizes(initialSizes, panes.length))

  const resize = (index: number, delta: number): void => {
    const width = containerRef.current?.clientWidth
    if (!width || panes.length < 2) return
    setSizes((current) => resizePaneSizes(current, index, delta, width, minPaneSize))
  }

  return (
    <div
      ref={containerRef}
      className={`d2d-resizable-pane-group${className ? ` ${className}` : ''}`}
      data-testid={testId}
    >
      {panes.map((pane, index) => (
        <Fragment key={index}>
          <div className="d2d-resizable-pane" style={{ flexGrow: sizes[index] ?? 1 }}>
            {pane}
          </div>
          {index < panes.length - 1 && (
            <ResizeHandle
              axis="x"
              label={`編集ペイン境界${index + 1}の幅変更`}
              testId={`${testId}-handle-${index}`}
              onDelta={(delta) => resize(index, delta)}
            />
          )}
        </Fragment>
      ))}
    </div>
  )
}
