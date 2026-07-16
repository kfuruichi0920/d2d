/** Workbench共通Selection（P3-2/P3-9、UI-026、EXT-020）。 */
import { create } from 'zustand'

export interface SelectedItem {
  contextUri: string
  uid: string
  displayId: string
  entityType: string
  itemType?: string
  title?: string | null
  status?: string
  properties: Record<string, string | number | boolean | null | undefined>
}

export interface ExtractedItemSelection {
  documentUid: string
  entityUid: string | null
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
  contextUri: string
  pane: 'extracted' | 'intermediate'
  entityUid: string | null
  id: string
  type: string
  resourceUid: string | null
  text: string | null
  status: string
  sourceTitle?: string
}

interface SelectionState {
  selectedItem: SelectedItem | null
  extractedItems: ExtractedItemSelection[]
  workbenchItems: WorkbenchItemSelection[]
  setSelectedItem(item: SelectedItem): void
  clearSelectedItem(contextUri?: string): void
  setExtractedItems(items: ExtractedItemSelection[]): void
  clearExtractedItems(): void
  setWorkbenchItems(items: WorkbenchItemSelection[]): void
}

export const useSelectionStore = create<SelectionState>((set, get) => ({
  selectedItem: null,
  extractedItems: [],
  workbenchItems: [],
  setSelectedItem: (selectedItem) => set({ selectedItem }),
  clearSelectedItem: (contextUri) => {
    if (!contextUri || get().selectedItem?.contextUri === contextUri) set({ selectedItem: null })
  },
  setExtractedItems: (extractedItems) => set({ extractedItems }),
  clearExtractedItems: () => set({ extractedItems: [] }),
  setWorkbenchItems: (workbenchItems) => set({ workbenchItems })
}))
