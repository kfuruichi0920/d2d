/**
 * Settings Editor（V-12、CORE-040〜046）。
 * テーマ・表示モード、APIキー（機密）の登録状態を編集する。
 * LLM Provider 詳細設定は P6 で拡張する。
 */
import { useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { useWorkbenchStore } from '../../stores/workbench-store'
import { COLOR_THEMES, DISPLAY_MODES } from '../../theme/theme'
import { LlmSettingsSection } from '../views/LlmViews'
import { useProjectStore } from '../../stores/project-store'
import { SearchEngineSettingsSection } from '../views/SearchSettingsView'
import { PlantUmlSettingsSection } from '../views/PlantUmlSettingsView'
import { AppSettingsStorageNotice } from '../views/AppSettingsStorageNotice'

export function SettingsEditor(): React.JSX.Element {
  const theme = useWorkbenchStore((s) => s.theme)
  const setTheme = useWorkbenchStore((s) => s.setTheme)
  const notify = useJobsStore((s) => s.notify)

  const hasProject = useProjectStore((s) => s.project !== null)
  const [secretKeys, setSecretKeys] = useState<string[]>([])
  const [newKeyName, setNewKeyName] = useState('openai_api_key')
  const [newKeyValue, setNewKeyValue] = useState('')
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({})

  const loadSecrets = async (): Promise<void> => {
    const res = await invoke<string[]>('settings.listSecretKeys')
    if (res.ok) setSecretKeys(res.result)
  }

  useEffect(() => {
    void loadSecrets()
  }, [])

  const saveSecret = async (): Promise<void> => {
    if (!newKeyName || !newKeyValue) return
    const res = await invoke('settings.setSecret', { key: newKeyName, value: newKeyValue })
    if (res.ok) {
      notify('info', `機密情報を暗号化保存しました: ${newKeyName}`)
      setNewKeyValue('')
      await loadSecrets()
    } else {
      notify('error', '機密情報の保存に失敗しました', res.error.message)
    }
  }

  const toggleSecretVisibility = async (key: string): Promise<void> => {
    if (revealedSecrets[key] !== undefined) {
      setRevealedSecrets((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      return
    }
    const result = await invoke<string>('settings.getSecret', { key })
    if (result.ok) {
      setRevealedSecrets((current) => ({ ...current, [key]: result.result }))
    } else {
      notify('error', '秘密情報を表示できませんでした', result.error.message)
    }
  }
  const deleteSecret = async (key: string): Promise<void> => {
    const res = await invoke('settings.deleteSecret', { key })
    if (res.ok) {
      setRevealedSecrets((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
      await loadSecrets()
    }
  }

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }

  return (
    <div style={{ padding: 20, maxWidth: 640 }} data-testid="settings-editor">
      <h1 style={{ fontSize: 18, marginTop: 0 }}>ツール設定</h1>

      <h2 style={{ fontSize: 14 }}>テーマ（UI-001 / UI-027）</h2>
      <div style={rowStyle}>
        <label style={{ width: 120, color: 'var(--d2d-fg-muted)' }}>表示モード</label>
        <select
          data-testid="setting-display-mode"
          value={theme.displayMode}
          onChange={(e) => setTheme({ displayMode: e.target.value as (typeof DISPLAY_MODES)[number] })}
        >
          {DISPLAY_MODES.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </div>
      <div style={rowStyle}>
        <label style={{ width: 120, color: 'var(--d2d-fg-muted)' }}>カラーテーマ</label>
        <select
          data-testid="setting-color-theme"
          value={theme.colorTheme}
          onChange={(e) => setTheme({ colorTheme: e.target.value as (typeof COLOR_THEMES)[number] })}
        >
          {COLOR_THEMES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <AppSettingsStorageNotice />
      <PlantUmlSettingsSection />
      <SearchEngineSettingsSection />

      <h2 style={{ fontSize: 14, marginTop: 20 }}>APIキー等の機密情報（CORE-044/045）</h2>
      <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11.5 }}>
        アプリ全体の秘密情報として safeStorage
        で暗号化保存します。登録状態は起動後も復元し、「表示」を押した場合のみこのPC内で復号した値を表示します。
      </p>
      {secretKeys.map((key) => (
        <div key={key} style={rowStyle} data-testid={`secret-row-${key}`}>
          <code style={{ flex: 1 }}>{key}</code>
          <span className="d2d-badge status-success">登録済み</span>
          {revealedSecrets[key] !== undefined && (
            <input
              readOnly
              value={revealedSecrets[key]}
              aria-label={`${key} の値`}
              data-testid={`secret-revealed-${key}`}
              style={{ flex: 1 }}
            />
          )}
          <button type="button" className="d2d-btn small" onClick={() => void toggleSecretVisibility(key)}>
            {revealedSecrets[key] !== undefined ? '隠す' : '表示'}
          </button>
          <button type="button" className="d2d-btn small" onClick={() => void deleteSecret(key)}>
            削除
          </button>
        </div>
      ))}
      <div style={rowStyle}>
        <input
          style={{ width: 180 }}
          value={newKeyName}
          onChange={(e) => setNewKeyName(e.target.value)}
          placeholder="キー名（例: openai_api_key）"
        />
        <input
          style={{ flex: 1 }}
          type="password"
          value={newKeyValue}
          onChange={(e) => setNewKeyValue(e.target.value)}
          placeholder="値"
          data-testid="secret-value-input"
        />
        <button type="button" className="d2d-btn primary" onClick={() => void saveSecret()} data-testid="secret-save">
          暗号化保存
        </button>
      </div>

      {hasProject && <LlmSettingsSection showExternalSend={false} />}
      {!hasProject && (
        <p style={{ color: 'var(--d2d-fg-muted)', marginTop: 20 }}>
          LLM Provider 設定はプロジェクトを開くと表示されます。外部送信可否は「プロジェクト設定」で管理します。
        </p>
      )}
    </div>
  )
}
