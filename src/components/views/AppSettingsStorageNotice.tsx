/** アプリ全体設定の保存スコープ・実保存先表示（P2-2、CORE-040）。 */
import { useEffect, useState } from 'react'
import { invoke } from '../../services/backend'

interface StorageInfo {
  scope: 'application'
  settingsPath: string
}

export function AppSettingsStorageNotice(): React.JSX.Element {
  const [settingsPath, setSettingsPath] = useState('')

  useEffect(() => {
    void invoke<StorageInfo>('settings.getStorageInfo').then((result) => {
      if (result.ok) setSettingsPath(result.result.settingsPath)
    })
  }, [])

  return (
    <aside
      data-testid="app-settings-storage-notice"
      style={{ marginTop: 20, padding: 10, border: '1px solid var(--d2d-border)', fontSize: 11.5 }}
    >
      <strong>アプリ全体設定</strong>
      <div style={{ color: 'var(--d2d-fg-muted)', marginTop: 4 }}>
        PlantUML・検索エンジン設定は全プロジェクトで共通です。プロジェクト未読込でも保存・利用できます。
      </div>
      <div style={{ marginTop: 4 }}>
        保存先: <code data-testid="app-settings-storage-path">{settingsPath || '読込中…'}</code>
      </div>
    </aside>
  )
}
