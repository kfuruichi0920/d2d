/**
 * 設定管理（P2-2、CORE-040〜046、NFR-020）。
 *
 * - アプリ全体設定:      <userData>/settings.json（平文。機密を含めない）
 * - 機密情報（APIキー等）: <userData>/secrets.json（safeStorage で暗号化した base64 のみ保存）
 * - プロジェクト別設定:   <projectRoot>/project.settings.json（Git 管理対象。機密を含めない）
 *
 * エクスポートは機密情報を除外する（CORE-046）。復号値は Backend 内部（LLM 通信等）で使用し、
 * Renderer へは設定画面でユーザーが明示的に表示操作した場合のみ返す。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { BackendError } from '../api/errors'

export interface SecretCipher {
  isAvailable(): Promise<boolean>
  encrypt(plain: string): Promise<string>
  decrypt(cipher: string): Promise<string>
}

type SettingsMap = Record<string, unknown>

function readJson(path: string): SettingsMap {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SettingsMap
  } catch (err) {
    throw new BackendError('io', `設定ファイルの読込に失敗しました: ${path}`, err instanceof Error ? err.message : '')
  }
}

function writeJson(path: string, data: SettingsMap): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

export class SettingsService {
  private readonly settingsPath: string
  private readonly secretsPath: string

  constructor(
    userDataDir: string,
    private readonly cipher: SecretCipher
  ) {
    this.settingsPath = join(userDataDir, 'settings.json')
    this.secretsPath = join(userDataDir, 'secrets.json')
  }

  // ---- アプリ全体設定（CORE-040） ----

  getStorageInfo(): { scope: 'application'; settingsPath: string; secretsPath: string } {
    return { scope: 'application', settingsPath: this.settingsPath, secretsPath: this.secretsPath }
  }

  getAll(): SettingsMap {
    return readJson(this.settingsPath)
  }

  get(key: string): unknown {
    return this.getAll()[key] ?? null
  }

  set(key: string, value: unknown): void {
    this.assertNotSecretKey(key)
    const all = this.getAll()
    all[key] = value
    writeJson(this.settingsPath, all)
  }

  delete(key: string): void {
    const all = this.getAll()
    delete all[key]
    writeJson(this.settingsPath, all)
  }

  // ---- 機密情報（CORE-044/045、NFR-020） ----

  async setSecret(key: string, plainValue: string): Promise<void> {
    if (!key) throw new BackendError('validation', '機密キー名は必須です', '')
    const encrypted = await this.cipher.encrypt(plainValue)
    const secrets = readJson(this.secretsPath)
    secrets[key] = encrypted
    writeJson(this.secretsPath, secrets)
  }

  hasSecret(key: string): boolean {
    return typeof readJson(this.secretsPath)[key] === 'string'
  }

  listSecretKeys(): string[] {
    return Object.keys(readJson(this.secretsPath))
  }

  deleteSecret(key: string): void {
    const secrets = readJson(this.secretsPath)
    delete secrets[key]
    writeJson(this.secretsPath, secrets)
  }

  /** Backend 内部用（LLM Provider 等）。Renderer へ返す API にしないこと */
  async getSecretValue(key: string): Promise<string> {
    const cipherText = readJson(this.secretsPath)[key]
    if (typeof cipherText !== 'string') {
      throw new BackendError('not_found', `機密情報が登録されていません: ${key}`, '')
    }
    return this.cipher.decrypt(cipherText)
  }

  // ---- エクスポート / インポート（CORE-046） ----

  /** 機密情報を除外した設定エクスポート */
  exportSettings(): { settings: SettingsMap; exported_at: string } {
    return { settings: this.getAll(), exported_at: new Date().toISOString() }
  }

  importSettings(data: unknown): number {
    if (typeof data !== 'object' || data === null || typeof (data as { settings?: unknown }).settings !== 'object') {
      throw new BackendError('validation', '設定インポートデータの形式が不正です', '')
    }
    const incoming = (data as { settings: SettingsMap }).settings
    const all = this.getAll()
    let count = 0
    for (const [key, value] of Object.entries(incoming)) {
      this.assertNotSecretKey(key)
      all[key] = value
      count++
    }
    writeJson(this.settingsPath, all)
    return count
  }

  /** APIキー等が平文設定へ紛れ込むことを防ぐ簡易ガード */
  private assertNotSecretKey(key: string): void {
    if (/api[_-]?key|secret|token|password/i.test(key)) {
      throw new BackendError(
        'validation',
        `機密情報は settings.setSecret を使用してください: ${key}`,
        'APIキー等は平文保存しない（CORE-045 / NFR-020）'
      )
    }
  }
}

// ---- プロジェクト別設定（CORE-041） ----

const PROJECT_SETTINGS_FILE = 'project.settings.json'

export function getProjectSettings(projectRoot: string): SettingsMap {
  return readJson(join(projectRoot, PROJECT_SETTINGS_FILE))
}

export function setProjectSetting(projectRoot: string, key: string, value: unknown): void {
  if (/api[_-]?key|secret|token|password/i.test(key)) {
    throw new BackendError('validation', `プロジェクト設定に機密情報は保存できません: ${key}`, '')
  }
  const path = join(projectRoot, PROJECT_SETTINGS_FILE)
  const all = readJson(path)
  all[key] = value
  writeJson(path, all)
}
