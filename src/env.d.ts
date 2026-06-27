/// <reference types="vite/client" />

import type { ElectronAPI } from '@electron-toolkit/preload'
import type { D2DApi } from './types/d2d-api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: D2DApi
  }
}
