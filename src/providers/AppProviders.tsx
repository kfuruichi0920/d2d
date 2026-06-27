import React, { useEffect, useState } from 'react'
import { SerendieProvider } from '@serendie/ui'
import { useSettingsStore } from '../stores/settingsStore'

interface AppProvidersProps {
  children: React.ReactNode
}

export function AppProviders({ children }: AppProvidersProps): React.JSX.Element {
  const { appSettings, setAppSettings } = useSettingsStore()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const load = async (): Promise<void> => {
      try {
        if (typeof window !== 'undefined' && window.api) {
          const settings = await window.api.settings.getApp()
          setAppSettings(settings)
        }
      } catch {
        // API 呼び出し失敗時はデフォルト設定のまま続行
      } finally {
        setReady(true)
      }
    }
    load()
  }, [setAppSettings])

  // 設定ロード前の一瞬を非表示にして FOUC を防ぐ
  if (!ready) return <div style={{ visibility: 'hidden' }} />

  return (
    <SerendieProvider
      lang={appSettings.language}
      colorTheme={appSettings.theme}
      colorMode={appSettings.colorMode}
    >
      {children}
    </SerendieProvider>
  )
}
