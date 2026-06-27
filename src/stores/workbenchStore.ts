import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ViewId =
  | 'sources'
  | 'extraction'
  | 'intermediate'
  | 'design'
  | 'glossary'
  | 'trace-matrix'
  | 'trace-graph'
  | 'jobs'
  | 'settings'

export interface Tab {
  id: string
  viewId: ViewId
  label: string
  resourceUid?: string
}

export type ActivityBarItem = 'explorer' | 'trace' | 'jobs' | 'settings'

export type PanelTab = 'jobs' | 'output' | 'problems'

interface WorkbenchState {
  // layout
  sideBarOpen: boolean
  sideBarWidth: number
  panelOpen: boolean
  panelHeight: number
  activeActivity: ActivityBarItem

  // tabs
  tabs: Tab[]
  activeTabId: string | null

  // panel
  activePanelTab: PanelTab

  // command palette
  commandPaletteOpen: boolean

  // actions
  setSideBarOpen: (open: boolean) => void
  setSideBarWidth: (w: number) => void
  setPanelOpen: (open: boolean) => void
  setPanelHeight: (h: number) => void
  setActiveActivity: (a: ActivityBarItem) => void
  openTab: (tab: Omit<Tab, 'id'> & { id?: string }) => void
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  setActivePanelTab: (t: PanelTab) => void
  setCommandPaletteOpen: (open: boolean) => void
}

export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set, get) => ({
      sideBarOpen: true,
      sideBarWidth: 260,
      panelOpen: false,
      panelHeight: 200,
      activeActivity: 'explorer',
      tabs: [],
      activeTabId: null,
      activePanelTab: 'jobs',
      commandPaletteOpen: false,

      setSideBarOpen: (open) => set({ sideBarOpen: open }),
      setSideBarWidth: (w) => set({ sideBarWidth: w }),
      setPanelOpen: (open) => set({ panelOpen: open }),
      setPanelHeight: (h) => set({ panelHeight: h }),
      setActiveActivity: (a) => set({ activeActivity: a }),

      openTab: (tab) => {
        const id = tab.id ?? tab.viewId
        const existing = get().tabs.find((t) => t.id === id)
        if (existing) {
          set({ activeTabId: id })
        } else {
          set((s) => ({
            tabs: [...s.tabs, { ...tab, id }],
            activeTabId: id,
          }))
        }
      },

      closeTab: (id) => {
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== id)
          const activeTabId =
            s.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : s.activeTabId
          return { tabs, activeTabId }
        })
      },

      setActiveTab: (id) => set({ activeTabId: id }),
      setActivePanelTab: (t) => set({ activePanelTab: t }),
      setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
    }),
    {
      name: 'd2d-workbench',
      partialize: (s) => ({
        sideBarOpen: s.sideBarOpen,
        sideBarWidth: s.sideBarWidth,
        panelOpen: s.panelOpen,
        panelHeight: s.panelHeight,
        activeActivity: s.activeActivity,
        tabs: s.tabs,
        activeTabId: s.activeTabId,
      }),
    }
  )
)

// ---- convenience helpers ----

export const VIEW_META: Record<ViewId, { label: string }> = {
  sources: { label: '原本' },
  extraction: { label: '抽出データ' },
  intermediate: { label: '中間データ' },
  design: { label: '設計要素' },
  glossary: { label: '用語集' },
  'trace-matrix': { label: 'トレースマトリクス' },
  'trace-graph': { label: 'トレースグラフ' },
  jobs: { label: 'ジョブ' },
  settings: { label: '設定' },
}
