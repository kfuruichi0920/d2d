/**
 * Workbench レイアウト状態（P3-1/P3-7、UI-005/006/021/025、sdd_ui_design §3/§5）。
 * 作業モード（M0〜M5）ごとにレイアウトを保持し、プロジェクト単位で永続化・復元する。
 */
import { create } from 'zustand'
import { DEFAULT_THEME, applyTheme, type ThemeState } from '../theme/theme'

export type WorkMode = 'M0' | 'M1' | 'M2' | 'M3' | 'M4' | 'M5'

export const WORK_MODES: { mode: WorkMode; label: string }[] = [
  { mode: 'M0', label: 'ダッシュボード' },
  { mode: 'M1', label: '取込・抽出' },
  { mode: 'M2', label: '統合' },
  { mode: 'M3', label: 'モデル化' },
  { mode: 'M4', label: 'トレース・分析' },
  { mode: 'M5', label: '履歴・差分' }
]

export type Activity = 'explorer' | 'review' | 'search' | 'trace' | 'jobs' | 'reports' | 'history' | 'settings'

export type PanelTab = 'problems' | 'output' | 'jobs' | 'search' | 'validation' | 'llm'
export type SecondaryTab = 'properties' | 'evidence' | 'relations' | 'candidates' | 'review'

export interface ModeLayout {
  activity: Activity
  sideBarVisible: boolean
  secondaryVisible: boolean
  secondaryTab: SecondaryTab
  panelVisible: boolean
  panelTab: PanelTab
}

const MODE_DEFAULT_LAYOUTS: Record<WorkMode, ModeLayout> = {
  M0: {
    activity: 'explorer',
    sideBarVisible: true,
    secondaryVisible: false,
    secondaryTab: 'properties',
    panelVisible: false,
    panelTab: 'jobs'
  },
  M1: {
    activity: 'explorer',
    sideBarVisible: true,
    secondaryVisible: true,
    secondaryTab: 'properties',
    panelVisible: true,
    panelTab: 'jobs'
  },
  M2: {
    activity: 'explorer',
    sideBarVisible: true,
    secondaryVisible: true,
    secondaryTab: 'evidence',
    panelVisible: false,
    panelTab: 'problems'
  },
  M3: {
    activity: 'review',
    sideBarVisible: true,
    secondaryVisible: true,
    secondaryTab: 'candidates',
    panelVisible: true,
    panelTab: 'llm'
  },
  M4: {
    activity: 'trace',
    sideBarVisible: true,
    secondaryVisible: true,
    secondaryTab: 'relations',
    panelVisible: true,
    panelTab: 'problems'
  },
  M5: {
    activity: 'history',
    sideBarVisible: true,
    secondaryVisible: false,
    secondaryTab: 'properties',
    panelVisible: false,
    panelTab: 'output'
  }
}

interface PersistedLayout {
  workMode: WorkMode
  layouts: Record<WorkMode, ModeLayout>
  theme: ThemeState
}

interface WorkbenchState extends ModeLayout {
  workMode: WorkMode
  layouts: Record<WorkMode, ModeLayout>
  theme: ThemeState
  paletteOpen: boolean
  /** レイアウト永続化キー（プロジェクト単位。未オープン時は global） */
  persistKey: string

  switchMode(mode: WorkMode): void
  resetLayout(): void
  setActivity(activity: Activity): void
  toggleSideBar(): void
  toggleSecondary(): void
  setSecondaryTab(tab: SecondaryTab): void
  togglePanel(): void
  setPanelTab(tab: PanelTab): void
  openPanel(tab: PanelTab): void
  setTheme(theme: Partial<ThemeState>): void
  setPaletteOpen(open: boolean): void
  loadPersisted(persistKey: string): void
}

function storageKey(persistKey: string): string {
  return `d2d.workbench.${persistKey}`
}

function persist(state: WorkbenchState): void {
  const data: PersistedLayout = {
    workMode: state.workMode,
    layouts: { ...state.layouts, [state.workMode]: currentLayout(state) },
    theme: state.theme
  }
  try {
    localStorage.setItem(storageKey(state.persistKey), JSON.stringify(data))
  } catch {
    // 永続化失敗は無視（UI 動作を優先）
  }
}

function currentLayout(state: ModeLayout): ModeLayout {
  return {
    activity: state.activity,
    sideBarVisible: state.sideBarVisible,
    secondaryVisible: state.secondaryVisible,
    secondaryTab: state.secondaryTab,
    panelVisible: state.panelVisible,
    panelTab: state.panelTab
  }
}

export const useWorkbenchStore = create<WorkbenchState>((set, get) => ({
  workMode: 'M0',
  layouts: structuredClone(MODE_DEFAULT_LAYOUTS),
  theme: DEFAULT_THEME,
  paletteOpen: false,
  persistKey: 'global',
  ...MODE_DEFAULT_LAYOUTS.M0,

  switchMode: (mode) => {
    const state = get()
    // 現在モードのレイアウトを保存してから切替（§5.2 レイアウト独立）
    const layouts = { ...state.layouts, [state.workMode]: currentLayout(state) }
    set({ workMode: mode, layouts, ...layouts[mode] })
    persist(get())
  },

  resetLayout: () => {
    const state = get()
    const def = MODE_DEFAULT_LAYOUTS[state.workMode]
    set({ ...def, layouts: { ...state.layouts, [state.workMode]: { ...def } } })
    persist(get())
  },

  setActivity: (activity) => {
    // 同じ Activity の再クリックで Side Bar をトグル（IDE 慣習）
    const state = get()
    if (state.activity === activity && state.sideBarVisible) {
      set({ sideBarVisible: false })
    } else {
      set({ activity, sideBarVisible: true })
    }
    persist(get())
  },

  toggleSideBar: () => {
    set({ sideBarVisible: !get().sideBarVisible })
    persist(get())
  },

  toggleSecondary: () => {
    set({ secondaryVisible: !get().secondaryVisible })
    persist(get())
  },

  setSecondaryTab: (tab) => {
    set({ secondaryTab: tab, secondaryVisible: true })
    persist(get())
  },

  togglePanel: () => {
    set({ panelVisible: !get().panelVisible })
    persist(get())
  },

  setPanelTab: (tab) => {
    set({ panelTab: tab })
    persist(get())
  },

  openPanel: (tab) => {
    set({ panelVisible: true, panelTab: tab })
    persist(get())
  },

  setTheme: (partial) => {
    const theme = { ...get().theme, ...partial }
    set({ theme })
    applyTheme(theme)
    persist(get())
  },

  setPaletteOpen: (open) => set({ paletteOpen: open }),

  loadPersisted: (persistKey) => {
    let data: PersistedLayout | null = null
    try {
      const raw = localStorage.getItem(storageKey(persistKey))
      if (raw) data = JSON.parse(raw) as PersistedLayout
    } catch {
      data = null
    }
    if (data) {
      const layouts = { ...structuredClone(MODE_DEFAULT_LAYOUTS), ...data.layouts }
      set({
        persistKey,
        workMode: data.workMode,
        layouts,
        theme: data.theme ?? DEFAULT_THEME,
        ...layouts[data.workMode]
      })
    } else {
      set({ persistKey })
    }
    applyTheme(get().theme)
  }
}))
