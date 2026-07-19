/** 検索結果等から文書内要素まで移動する一時Selection要求（UI-030、SEARCH-003）。 */
import { create } from 'zustand'

export interface ResourceNavigationTarget {
  uri: string
  itemUid?: string
  resourceUid?: string
  requestId: number
}

interface ResourceNavigationState {
  target: ResourceNavigationTarget | null
  select(uri: string, itemUid?: string, resourceUid?: string): void
}

let requestSequence = 0
export const useResourceNavigationStore = create<ResourceNavigationState>((set) => ({
  target: null,
  select: (uri, itemUid, resourceUid) => set({ target: { uri, itemUid, resourceUid, requestId: ++requestSequence } })
}))
