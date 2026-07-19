import { beforeEach, describe, expect, it } from 'vitest'
import { useFavoritesStore } from './favorites-store'

const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear()
  }
})

describe('favorites-store（UI-045/046）', () => {
  beforeEach(() => {
    values.clear()
    useFavoritesStore.setState({ persistKey: 'project-a', items: [] })
  })

  it('Resourceをトグル登録し、表示名を変更してプロジェクト単位で復元する', () => {
    const state = useFavoritesStore.getState()
    state.toggle('project://current', 'ダッシュボード')
    useFavoritesStore.getState().rename('project://current', 'ホーム画面')
    expect(useFavoritesStore.getState().items[0]).toMatchObject({ uri: 'project://current', name: 'ホーム画面' })

    useFavoritesStore.setState({ items: [] })
    useFavoritesStore.getState().loadPersisted('project-a')
    expect(useFavoritesStore.getState().items[0]?.name).toBe('ホーム画面')
    useFavoritesStore.getState().toggle('project://current', 'ダッシュボード')
    expect(useFavoritesStore.getState().items).toEqual([])
  })
})
