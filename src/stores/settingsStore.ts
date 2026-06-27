import { create } from 'zustand'
import type { AppSettings } from '../types/d2d-api'

interface SettingsState {
  appSettings: AppSettings
  isLoaded: boolean
  setAppSettings: (settings: AppSettings) => void
  updateTheme: (theme: AppSettings['theme']) => void
  updateColorMode: (mode: AppSettings['colorMode']) => void
}

const DEFAULT_SETTINGS: AppSettings = {
  theme: 'konjo',
  colorMode: 'system',
  language: 'ja',
  exportOnSave: false,
  autoUpdateCheck: true
}

export const useSettingsStore = create<SettingsState>((set) => ({
  appSettings: DEFAULT_SETTINGS,
  isLoaded: false,

  setAppSettings: (settings) => set({ appSettings: settings, isLoaded: true }),

  updateTheme: (theme) =>
    set((state) => ({ appSettings: { ...state.appSettings, theme } })),

  updateColorMode: (colorMode) =>
    set((state) => ({ appSettings: { ...state.appSettings, colorMode } }))
}))
