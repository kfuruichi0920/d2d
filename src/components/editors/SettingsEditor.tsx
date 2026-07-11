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

export function SettingsEditor(): React.JSX.Element {
  const theme = useWorkbenchStore((s) => s.theme)
  const setTheme = useWorkbenchStore((s) => s.setTheme)
  const notify = useJobsStore((s) => s.notify)

  const hasProject = useProjectStore((s) => s.project !== null)
  const [secretKeys, setSecretKeys] = useState<string[]>([])
  const [newKeyName, setNewKeyName] = useState('openai_api_key')
  const [newKeyValue, setNewKeyValue] = useState('')

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

  const deleteSecret = async (key: string): Promise<void> => {
    const res = await invoke('settings.deleteSecret', { key })
    if (res.ok) await loadSecrets()
  }

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }

  return (
    <div style={{ padding: 20, maxWidth: 640 }} data-testid="settings-editor">
      <h1 style={{ fontSize: 18, marginTop: 0 }}>設定</h1>

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

      <h2 style={{ fontSize: 14, marginTop: 20 }}>APIキー等の機密情報（CORE-044/045）</h2>
      <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11.5 }}>
        OS の資格情報保護機構（safeStorage）で暗号化して保存します。値の再表示はできません。
      </p>
      {secretKeys.map((key) => (
        <div key={key} style={rowStyle}>
          <code style={{ flex: 1 }}>{key}</code>
          <span className="d2d-badge status-success">登録済み</span>
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

      {hasProject && <SearchEngineSettingsSection />}
      {hasProject && <LlmSettingsSection />}
      {!hasProject && (
        <p style={{ color: 'var(--d2d-fg-muted)', marginTop: 20 }}>
          LLM Provider 設定はプロジェクトを開くと表示されます（外部送信可否はプロジェクト単位のため）。
        </p>
      )}
    </div>
  )
}
