import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsService, getProjectSettings, setProjectSetting, type SecretCipher } from './settings-service'

/** テスト用の可逆スタブ暗号器（本番は safeStorage を Main ブリッジ経由で使う） */
const stubCipher: SecretCipher = {
  isAvailable: async () => true,
  encrypt: async (plain) => `enc:${Buffer.from(plain, 'utf-8').toString('base64')}`,
  decrypt: async (cipher) => Buffer.from(cipher.slice(4), 'base64').toString('utf-8')
}

describe('SettingsService（P2-2）', () => {
  let dir: string
  let svc: SettingsService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-settings-'))
    svc = new SettingsService(dir, stubCipher)
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('アプリ設定の get/set/delete ができる（CORE-040/044）', () => {
    svc.set('theme', 'dark')
    svc.set('proxy', { host: 'proxy.local', port: 8080 })
    expect(svc.get('theme')).toBe('dark')
    expect(svc.get('proxy')).toEqual({ host: 'proxy.local', port: 8080 })
    svc.delete('theme')
    expect(svc.get('theme')).toBeNull()
  })

  it('アプリ全体設定の実保存先を返す（CORE-040）', () => {
    expect(svc.getStorageInfo()).toEqual({
      scope: 'application',
      settingsPath: join(dir, 'settings.json'),
      secretsPath: join(dir, 'secrets.json')
    })
  })

  it('APIキーらしきキー名の平文保存を拒否する（CORE-045 / NFR-020）', () => {
    expect(() => svc.set('openai_api_key', 'sk-xxx')).toThrowError(/setSecret/)
    expect(() => svc.set('llmToken', 'xxx')).toThrowError(/setSecret/)
  })

  it('機密情報は暗号化して保存し、平文がファイルに残らない', async () => {
    await svc.setSecret('openai_api_key', 'sk-plain-value')
    expect(svc.hasSecret('openai_api_key')).toBe(true)
    expect(svc.listSecretKeys()).toEqual(['openai_api_key'])

    const raw = readFileSync(join(dir, 'secrets.json'), 'utf-8')
    expect(raw).not.toContain('sk-plain-value')

    // Backend 内部用の復号
    await expect(svc.getSecretValue('openai_api_key')).resolves.toBe('sk-plain-value')

    svc.deleteSecret('openai_api_key')
    expect(svc.hasSecret('openai_api_key')).toBe(false)
  })

  it('エクスポートは機密情報を含まない（CORE-046）', async () => {
    svc.set('theme', 'light')
    await svc.setSecret('gemini_api_key', 'secret-123')

    const exported = svc.exportSettings()
    const json = JSON.stringify(exported)
    expect(json).toContain('theme')
    expect(json).not.toContain('secret-123')
    expect(json).not.toContain('gemini_api_key')
  })

  it('インポートは設定をマージし、機密キーを拒否する', () => {
    svc.set('theme', 'dark')
    const count = svc.importSettings({ settings: { locale: 'ja', theme: 'light' } })
    expect(count).toBe(2)
    expect(svc.get('locale')).toBe('ja')
    expect(svc.get('theme')).toBe('light')

    expect(() => svc.importSettings({ settings: { api_key: 'x' } })).toThrowError(/setSecret/)
    expect(() => svc.importSettings('broken')).toThrowError(/形式が不正/)
  })
})

describe('プロジェクト別設定（CORE-041）', () => {
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'd2d-psettings-'))
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('project.settings.json へ保存・取得できる', () => {
    setProjectSetting(root, 'llm.externalSendAllowed', false)
    setProjectSetting(root, 'extraction.lineThreshold', 0.2)
    expect(getProjectSettings(root)).toEqual({
      'llm.externalSendAllowed': false,
      'extraction.lineThreshold': 0.2
    })
    expect(existsSync(join(root, 'project.settings.json'))).toBe(true)
  })

  it('プロジェクト設定への機密保存を拒否する', () => {
    expect(() => setProjectSetting(root, 'my_api_key', 'x')).toThrowError(/機密情報/)
  })
})
