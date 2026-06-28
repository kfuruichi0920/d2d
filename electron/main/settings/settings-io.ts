// T808: 設定エクスポート / インポート

import fs from 'fs'
import { dialog } from 'electron'
import { getAppSettings, setAppSettings, getProjectSettings, setProjectSettings } from './settings-manager'
import type { AppSettings, ProjectSettings } from '../../../src/types/d2d-api'

interface SettingsBundle {
  version: string
  exportedAt: string
  app: AppSettings
  project: ProjectSettings
}

export async function exportSettingsToFile(): Promise<string | null> {
  const { filePath, canceled } = await dialog.showSaveDialog({
    title: '設定のエクスポート',
    defaultPath: `d2d-settings-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  })
  if (canceled || !filePath) return null

  const bundle: SettingsBundle = {
    version: '1',
    exportedAt: new Date().toISOString(),
    app: getAppSettings(),
    project: getProjectSettings(),
  }
  fs.writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf-8')
  return filePath
}

export async function importSettingsFromFile(): Promise<{ app: AppSettings; project: ProjectSettings } | null> {
  const { filePaths, canceled } = await dialog.showOpenDialog({
    title: '設定のインポート',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  })
  if (canceled || filePaths.length === 0) return null

  const raw = fs.readFileSync(filePaths[0], 'utf-8')
  const bundle = JSON.parse(raw) as Partial<SettingsBundle>

  if (bundle.app) setAppSettings(bundle.app)
  if (bundle.project) setProjectSettings(bundle.project)

  return {
    app: getAppSettings(),
    project: getProjectSettings(),
  }
}
