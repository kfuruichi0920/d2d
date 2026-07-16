import { describe, expect, it } from 'vitest'
import { normalizePaneSizes, resizePaneSizes } from './ResizablePaneGroup'

describe('ResizablePaneGroup', () => {
  it('初期比率を正規化する', () => {
    expect(normalizePaneSizes([40, 27, 33], 3)).toEqual([0.4, 0.27, 0.33])
  })

  it('隣接する2ペインの合計比率を維持して境界を移動する', () => {
    const resized = resizePaneSizes([0.4, 0.3, 0.3], 0, 100, 1000, 120)
    expect(resized[0]).toBeCloseTo(0.5)
    expect(resized[1]).toBeCloseTo(0.2)
    expect(resized[2]).toBeCloseTo(0.3)
  })

  it('最小ペイン幅で境界移動を制限する', () => {
    const resized = resizePaneSizes([0.5, 0.5], 0, -1000, 1000, 120)
    expect(resized).toEqual([0.12, 0.88])
  })
})
