/**
 * Workbench共通リサイズ境界（P3-1、UI-038/039）。
 * Pointer Captureでドラッグ中の境界外移動も追跡し、矢印キーでも微調整できる。
 */
export function ResizeHandle({
  axis,
  label,
  testId,
  reverse = false,
  onDelta
}: {
  axis: 'x' | 'y'
  label: string
  testId: string
  reverse?: boolean
  onDelta(delta: number): void
}): React.JSX.Element {
  const sign = reverse ? -1 : 1
  return (
    <div
      className={'wb-resize-handle ' + (axis === 'x' ? 'vertical' : 'horizontal')}
      role="separator"
      aria-label={label}
      aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
      tabIndex={0}
      data-testid={testId}
      onPointerDown={(event) => {
        event.preventDefault()
        const handle = event.currentTarget
        handle.setPointerCapture(event.pointerId)
        let previous = axis === 'x' ? event.clientX : event.clientY
        const move = (moveEvent: PointerEvent): void => {
          const current = axis === 'x' ? moveEvent.clientX : moveEvent.clientY
          onDelta((current - previous) * sign)
          previous = current
        }
        const finish = (): void => {
          handle.removeEventListener('pointermove', move)
          handle.removeEventListener('pointerup', finish)
          handle.removeEventListener('pointercancel', finish)
        }
        handle.addEventListener('pointermove', move)
        handle.addEventListener('pointerup', finish)
        handle.addEventListener('pointercancel', finish)
      }}
      onKeyDown={(event) => {
        const delta =
          axis === 'x'
            ? event.key === 'ArrowLeft'
              ? -10
              : event.key === 'ArrowRight'
                ? 10
                : 0
            : event.key === 'ArrowUp'
              ? -10
              : event.key === 'ArrowDown'
                ? 10
                : 0
        if (delta !== 0) {
          event.preventDefault()
          onDelta(delta * sign)
        }
      }}
    />
  )
}
