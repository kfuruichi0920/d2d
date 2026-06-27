import { ipcMain } from 'electron'
import {
  getAppSettings,
  setAppSettings,
  getProjectSettings,
  setProjectSettings,
  getApiKey,
  setApiKey,
  deleteApiKey
} from '../../settings/settings-manager'
import type { AppSettings, ProjectSettings } from '../../settings/settings-manager'

export function registerSettingsHandlers(): void {
  ipcMain.handle('settings:getApp', () => getAppSettings())

  ipcMain.handle('settings:setApp', (_event, settings: Partial<AppSettings>) =>
    setAppSettings(settings)
  )

  ipcMain.handle('settings:getProject', () => getProjectSettings())

  ipcMain.handle('settings:setProject', (_event, settings: Partial<ProjectSettings>) =>
    setProjectSettings(settings)
  )

  ipcMain.handle('settings:getApiKey', (_event, service: string, account: string) =>
    getApiKey(service, account)
  )

  ipcMain.handle(
    'settings:setApiKey',
    (_event, service: string, account: string, key: string) => setApiKey(service, account, key)
  )

  ipcMain.handle('settings:deleteApiKey', (_event, service: string, account: string) =>
    deleteApiKey(service, account)
  )
}
