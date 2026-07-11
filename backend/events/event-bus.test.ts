import { describe, expect, it, vi } from 'vitest'
import { EventBus } from './event-bus'

describe('EventBus（P2-4、CORE-030〜032）', () => {
  it('特定イベントの購読・発行・解除ができる', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    const off = bus.on('extraction.completed', listener)

    bus.emit('extraction.completed', { uid: 'x' })
    bus.emit('other.event', {})
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith('extraction.completed', { uid: 'x' })

    off()
    bus.emit('extraction.completed', {})
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('onAny は全イベントを受け取る（Renderer 転送用）', () => {
    const bus = new EventBus()
    const listener = vi.fn()
    bus.onAny(listener)
    bus.emit('a.b', 1)
    bus.emit('c.d', 2)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('購読側の例外が他の購読者・発行元へ伝播しない', () => {
    const bus = new EventBus()
    const good = vi.fn()
    bus.on('e', () => {
      throw new Error('boom')
    })
    bus.on('e', good)
    expect(() => bus.emit('e', null)).not.toThrow()
    expect(good).toHaveBeenCalledTimes(1)
  })
})
