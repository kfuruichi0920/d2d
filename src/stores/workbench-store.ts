/**
 * Workbenchレイアウト状態（P3-1/P3-7、UI-005/006/021/025/037/038/040）。
 * 作業モードごとに外周パネルの表示・サイズ・Secondaryアコーディオンを保持する。
 */
import { create } from 'zustand'
import { DEFAULT_THEME, applyTheme, type ThemeState } from '../theme/theme'
import { invoke } from '../services/backend'

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

const ALL_SECONDARY_SECTIONS: SecondaryTab[] = ['properties', 'evidence', 'relations', 'candidates', 'review']

export interface ModeLayout {
  activity: Activity
  sideBarVisible: boolean
  secondaryVisible: boolean
  secondaryTab: SecondaryTab
  secondaryExpanded: SecondaryTab[]
  panelVisible: boolean
  panelTab: PanelTab
  primarySize: number
  secondarySize: number
  panelSize: number
}

function modeLayout(
  activity: Activity,
  secondaryVisible: boolean,
  panelVisible: boolean,
  secondaryTab: SecondaryTab,
  panelTab: PanelTab
): ModeLayout {
  return {
    activity,
    sideBarVisible: true,
    secondaryVisible,
    secondaryTab,
    secondaryExpanded: [...ALL_SECONDARY_SECTIONS],
    panelVisible,
    panelTab,
    primarySize: 260,
    secondarySize: 280,
    panelSize: 200
  }
}

const MODE_DEFAULT_LAYOUTS: Record<WorkMode, ModeLayout> = {
  M0: modeLayout('explorer', false, false, 'properties', 'jobs'),
  M1: modeLayout('explorer', true, true, 'properties', 'jobs'),
  M2: modeLayout('explorer', true, false, 'evidence', 'problems'),
  M3: modeLayout('review', true, true, 'candidates', 'llm'),
  M4: modeLayout('trace', true, true, 'relations', 'problems'),
  M5: modeLayout('history', false, false, 'properties', 'output')
}

interface PersistedLayout {
  workMode: WorkMode
  layouts: Record<WorkMode, ModeLayout>
}

interface WorkbenchState extends ModeLayout {
  workMode: WorkMode
  layouts: Record<WorkMode, ModeLayout>
  theme: ThemeState
  paletteOpen: boolean
  persistKey: string
  switchMode(mode: WorkMode): void
  resetLayout(): void
  setActivity(activity: Activity): void
  toggleSideBar(): void
  toggleSecondary(): void
  setSecondaryTab(tab: SecondaryTab): void
  toggleSecondarySection(tab: SecondaryTab): void
  togglePanel(): void
  setPanelTab(tab: PanelTab): void
  openPanel(tab: PanelTab): void
  setPrimarySize(size: number): void
  setSecondarySize(size: number): void
  setPanelSize(size: number): void
  setTheme(theme: Partial<ThemeState>): void
  setPaletteOpen(open: boolean): void
  loadPersisted(persistKey: string): void
}

function storageKey(persistKey: string): string {
  return 'd2d.workbench.' + persistKey
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)))
}

function currentLayout(state: ModeLayout): ModeLayout {
  return {
    activity: state.activity,
    sideBarVisible: state.sideBarVisible,
    secondaryVisible: state.secondaryVisible,
    secondaryTab: state.secondaryTab,
    secondaryExpanded: [...state.secondaryExpanded],
    panelVisible: state.panelVisible,
    panelTab: state.panelTab,
    primarySize: state.primarySize,
    secondarySize: state.secondarySize,
    panelSize: state.panelSize
  }
}

function persist(state: WorkbenchState): void {
  const data: PersistedLayout = {
    workMode: state.workMode,
    layouts: { ...state.layouts, [state.workMode]: currentLayout(state) }
  }
  try {
    localStorage.setItem(storageKey(state.persistKey), JSON.stringify(data))
  } catch {
    // 永続化失敗はUI操作を妨げない。
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
    const layouts = { ...state.layouts, [state.workMode]: currentLayout(state) }
    set({ workMode: mode, layouts, ...layouts[mode] })
    persist(get())
  },

  resetLayout: () => {
    const state = get()
    const definition = structuredClone(MODE_DEFAULT_LAYOUTS[state.workMode])
    set({ ...definition, layouts: { ...state.layouts, [state.workMode]: definition } })
    persist(get())
  },

  setActivity: (activity) => {
    const state = get()
    set(
      state.activity === activity && state.sideBarVisible
        ? { sideBarVisible: false }
        : { activity, sideBarVisible: true }
    )
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
    const expanded = get().secondaryExpanded.includes(tab) ? get().secondaryExpanded : [...get().secondaryExpanded, tab]
    set({ secondaryTab: tab, secondaryVisible: true, secondaryExpanded: expanded })
    persist(get())
  },

  toggleSecondarySection: (tab) => {
    const state = get()
    const expanded = state.secondaryExpanded.includes(tab)
      ? state.secondaryExpanded.filter((candidate) => candidate !== tab)
      : [...state.secondaryExpanded, tab]
    set({ secondaryTab: tab, secondaryExpanded: expanded })
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

  setPrimarySize: (size) => {
    set({ primarySize: clamp(size, 160, 600) })
    persist(get())
  },

  setSecondarySize: (size) => {
    set({ secondarySize: clamp(size, 180, 600) })
    persist(get())
  },

  setPanelSize: (size) => {
    set({ panelSize: clamp(size, 100, 600) })
    persist(get())
  },

  setTheme: (partial) => {
    const theme = { ...get().theme, ...partial }
    set({ theme })
    applyTheme(theme)
    persist(get())
    void invoke('settings.set', { key: 'theme.displayMode', value: theme.displayMode })
    void invoke('settings.set', { key: 'theme.colorTheme', value: theme.colorTheme })
    void invoke('settings.set', { key: 'theme.fontSize', value: theme.fontSize })
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
      const layouts = Object.fromEntries(
        (Object.keys(MODE_DEFAULT_LAYOUTS) as WorkMode[]).map((mode) => {
          const definition = MODE_DEFAULT_LAYOUTS[mode]
          const saved = data?.layouts?.[mode]
          return [
            mode,
            {
              ...definition,
              ...saved,
              secondaryExpanded: saved?.secondaryExpanded ?? definition.secondaryExpanded
            }
          ]
        })
      ) as Record<WorkMode, ModeLayout>
      set({ persistKey, workMode: data.workMode, layouts, ...layouts[data.workMode] })
    } else {
      set({ persistKey })
    }
    applyTheme(get().theme)
  }
}))
