/**
 * Settings Editor（V-12、CORE-040〜047）。
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
import { KeybindingSettingsSection } from '../views/KeybindingSettingsView'

export function SettingsEditor(): React.JSX.Element {
  const theme = useWorkbenchStore((s) => s.theme)
  const setTheme = useWorkbenchStore((s) => s.setTheme)
  const notify = useJobsStore((s) => s.notify)

  const hasProject = useProjectStore((s) => s.project !== null)
  const [secretKeys, setSecretKeys] = useState<string[]>([])
  const [newKeyName, setNewKeyName] = useState('openai_api_key')
  const [newKeyValue, setNewKeyValue] = useState('')
  const [revealedSecrets, setRevealedSecrets] = useState<Record<string, string>>({})
  const [initializeGitOnCreate, setInitializeGitOnCreate] = useState(true)

  const loadSecrets = async (): Promise<void> => {
    const res = await invoke<string[]>('settings.listSecretKeys')
    if (res.ok) setSecretKeys(res.result)
  }

  useEffect(() => {
    void loadSecrets()
    void invoke<unknown>('settings.get', { key: 'project.initializeGitOnCreate' }).then((result) => {
      if (result.ok) setInitializeGitOnCreate(result.result !== false)
    })
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
          title="Workbench全体の明暗を選択します（例: light=明色、dark=暗色、system=OS設定に追従）"
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
          title="アクセントカラーの配色テーマを選択します（例: blue、green）"
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
      <div style={rowStyle}>
        <label style={{ width: 120, color: 'var(--d2d-fg-muted)' }}>文字サイズ</label>
        <input
          type="range"
          min={10}
          max={20}
          step={1}
          value={theme.fontSize}
          onChange={(event) => setTheme({ fontSize: Number(event.target.value) })}
          data-testid="setting-font-size"
          aria-label="ツール全体の文字サイズ"
          title="Workbench全体の文字サイズを10〜20pxで調整します（既定: 13px。Monacoエディタにも即時反映）"
        />
        <output data-testid="setting-font-size-value">{theme.fontSize}px</output>
      </div>

      <h2 style={{ fontSize: 14, marginTop: 20 }}>プロジェクト作成（CORE-047）</h2>
      <label style={rowStyle} title="新規プロジェクトの作成後にgit initを実行します。失敗しても作成処理は継続します。">
        <input
          type="checkbox"
          checked={initializeGitOnCreate}
          onChange={async (event) => {
            const value = event.target.checked
            setInitializeGitOnCreate(value)
            const result = await invoke('settings.set', { key: 'project.initializeGitOnCreate', value })
            if (!result.ok) {
              setInitializeGitOnCreate(!value)
              notify('error', 'Git初期化設定を保存できませんでした', result.error.message)
            }
          }}
          data-testid="setting-project-initialize-git"
        />
        新規プロジェクトでGitリポジトリを初期化する（既定: 有効、失敗時は継続）
      </label>

      <KeybindingSettingsSection />

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
          title="保存する機密情報の識別名を入力します（例: openai_api_key、anthropic_api_key）"
        />
        <input
          style={{ flex: 1 }}
          type="password"
          value={newKeyValue}
          onChange={(e) => setNewKeyValue(e.target.value)}
          placeholder="値"
          title="機密情報の値を入力します（例: sk-... 形式のAPIキー）。safeStorageで暗号化され平文保存されません"
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
