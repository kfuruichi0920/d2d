/** Workbench共通Selectionの抽出要素部分（P3-2/P3-9、P5-6、UI-026、EXT-020）。 */
import { create } from 'zustand'

export interface ExtractedItemSelection {
  documentUid: string
  id: string
  index: number
  type: string
  resourceUid: string | null
  text: string | null
  image: string | null
  sectionPath: string | null
  status: string
  level: number | null
  rowCount: number | null
  columnCount: number | null
}

interface SelectionState {
  extractedItems: ExtractedItemSelection[]
  setExtractedItems(items: ExtractedItemSelection[]): void
  clearExtractedItems(): void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  extractedItems: [],
  setExtractedItems: (extractedItems) => set({ extractedItems }),
  clearExtractedItems: () => set({ extractedItems: [] })
}))
