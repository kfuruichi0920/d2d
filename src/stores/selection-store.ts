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

export interface WorkbenchItemSelection {
  pane: 'extracted' | 'intermediate'
  id: string
  type: string
  resourceUid: string | null
  text: string | null
  status: string
  sourceTitle?: string
}

interface SelectionState {
  extractedItems: ExtractedItemSelection[]
  workbenchItems: WorkbenchItemSelection[]
  setExtractedItems(items: ExtractedItemSelection[]): void
  clearExtractedItems(): void
  setWorkbenchItems(items: WorkbenchItemSelection[]): void
}

export const useSelectionStore = create<SelectionState>((set) => ({
  extractedItems: [],
  workbenchItems: [],
  setExtractedItems: (extractedItems) => set({ extractedItems }),
  clearExtractedItems: () => set({ extractedItems: [] }),
  setWorkbenchItems: (workbenchItems) => set({ workbenchItems })
}))
