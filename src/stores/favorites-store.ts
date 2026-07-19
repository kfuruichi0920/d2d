/** プロジェクト単位のお気に入りResource（UI-045/046）。 */
import { create } from 'zustand'

export interface FavoriteResource {
  uri: string
  name: string
  title: string
}

interface FavoritesState {
  persistKey: string
  items: FavoriteResource[]
  loadPersisted(persistKey: string): void
  toggle(uri: string, title: string): void
  rename(uri: string, name: string): void
  remove(uri: string): void
}

function storageKey(persistKey: string): string {
  return 'd2d.favorites.' + persistKey
}

function persist(state: FavoritesState): void {
  try {
    localStorage.setItem(storageKey(state.persistKey), JSON.stringify(state.items))
  } catch {
    // お気に入り保存失敗はResource表示を妨げない。
  }
}

export const useFavoritesStore = create<FavoritesState>((set, get) => ({
  persistKey: 'global',
  items: [],
  loadPersisted: (persistKey) => {
    let items: FavoriteResource[] = []
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey(persistKey)) ?? '[]') as unknown
      if (Array.isArray(parsed)) {
        items = parsed.filter(
          (item): item is FavoriteResource =>
            typeof item === 'object' &&
            item !== null &&
            typeof (item as FavoriteResource).uri === 'string' &&
            typeof (item as FavoriteResource).name === 'string' &&
            typeof (item as FavoriteResource).title === 'string'
        )
      }
    } catch {
      items = []
    }
    set({ persistKey, items })
  },
  toggle: (uri, title) => {
    const state = get()
    const exists = state.items.some((item) => item.uri === uri)
    set({
      items: exists ? state.items.filter((item) => item.uri !== uri) : [...state.items, { uri, title, name: title }]
    })
    persist(get())
  },
  rename: (uri, name) => {
    const normalized = name.trim()
    if (!normalized) return
    set({ items: get().items.map((item) => (item.uri === uri ? { ...item, name: normalized } : item)) })
    persist(get())
  },
  remove: (uri) => {
    set({ items: get().items.filter((item) => item.uri !== uri) })
    persist(get())
  }
}))
