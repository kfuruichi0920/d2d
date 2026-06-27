import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import keytar from 'keytar'
import { getCurrentProjectRoot } from '../project/project-manager'
import type { AppSettings, ProjectSettings } from '../../../src/types/d2d-api'

export type { AppSettings, ProjectSettings }

const APP_SETTINGS_FILE = 'app-settings.json'
const PROJECT_SETTINGS_FILE = 'project-settings.json'
const KEYTAR_SERVICE = 'd2d-app'

const DEFAULT_APP_SETTINGS: AppSettings = {
  theme: 'konjo',
  language: 'ja',
  exportOnSave: false,
  autoUpdateCheck: true
}

const DEFAULT_PROJECT_SETTINGS: ProjectSettings = {
  defaultArtifactTypeId: null,
  defaultDevPhaseId: null,
  llmModel: null,
  extractorVersion: null
}

function appSettingsPath(): string {
  return join(app.getPath('userData'), APP_SETTINGS_FILE)
}

function projectSettingsPath(): string {
  const root = getCurrentProjectRoot()
  if (!root) throw new Error('No project is open')
  return join(root, PROJECT_SETTINGS_FILE)
}

export function getAppSettings(): AppSettings {
  const path = appSettingsPath()
  if (!existsSync(path)) return { ...DEFAULT_APP_SETTINGS }
  try {
    return { ...DEFAULT_APP_SETTINGS, ...JSON.parse(readFileSync(path, 'utf-8')) }
  } catch {
    return { ...DEFAULT_APP_SETTINGS }
  }
}

export function setAppSettings(settings: Partial<AppSettings>): AppSettings {
  const current = getAppSettings()
  const next = { ...current, ...settings }
  writeFileSync(appSettingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export function getProjectSettings(): ProjectSettings {
  try {
    const path = projectSettingsPath()
    if (!existsSync(path)) return { ...DEFAULT_PROJECT_SETTINGS }
    return { ...DEFAULT_PROJECT_SETTINGS, ...JSON.parse(readFileSync(path, 'utf-8')) }
  } catch {
    return { ...DEFAULT_PROJECT_SETTINGS }
  }
}

export function setProjectSettings(settings: Partial<ProjectSettings>): ProjectSettings {
  const current = getProjectSettings()
  const next = { ...current, ...settings }
  writeFileSync(projectSettingsPath(), JSON.stringify(next, null, 2), 'utf-8')
  return next
}

export async function getApiKey(service: string, account: string): Promise<string | null> {
  return keytar.getPassword(`${KEYTAR_SERVICE}:${service}`, account)
}

export async function setApiKey(service: string, account: string, key: string): Promise<void> {
  await keytar.setPassword(`${KEYTAR_SERVICE}:${service}`, account, key)
}

export async function deleteApiKey(service: string, account: string): Promise<void> {
  await keytar.deletePassword(`${KEYTAR_SERVICE}:${service}`, account)
}
