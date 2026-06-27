import React from 'react'
import { useSettingsStore } from '../../../stores/settingsStore'
import type { AppSettings } from '../../../types/d2d-api'

const THEMES: AppSettings['theme'][] = ['konjo', 'asagi', 'sumire', 'tsutsuji', 'kurikawa']
const THEME_LABELS: Record<AppSettings['theme'], string> = {
  konjo: '紺青 (Konjo)',
  asagi: '浅葱 (Asagi)',
  sumire: '菫 (Sumire)',
  tsutsuji: '躑躅 (Tsutsuji)',
  kurikawa: '栗皮 (Kurikawa)',
}

const COLOR_MODES: AppSettings['colorMode'][] = ['system', 'light', 'dark']
const COLOR_MODE_LABELS: Record<AppSettings['colorMode'], string> = {
  system: 'システム設定に従う',
  light: 'ライト',
  dark: 'ダーク',
}

const LANG_LABELS: Record<AppSettings['language'], string> = {
  ja: '日本語',
  en: 'English',
}

export function SettingsView(): React.JSX.Element {
  const { appSettings, updateTheme, updateColorMode, setAppSettings } = useSettingsStore()

  const handleToggle = async (key: 'exportOnSave' | 'autoUpdateCheck') => {
    const updated = { ...appSettings, [key]: !appSettings[key] }
    await window.api.settings.setApp(updated)
    setAppSettings(updated)
  }

  return (
    <div style={{ padding: 32, maxWidth: 560, fontSize: 13 }}>
      <h2 style={{ margin: '0 0 24px', fontSize: 18, fontWeight: 700 }}>設定</h2>

      <Section title="カラーテーマ">
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {THEMES.map((t) => (
            <button
              key={t}
              onClick={() => updateTheme(t)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '2px solid',
                borderColor: appSettings.theme === t ? 'var(--sd-color-reference-primary-40, #2563eb)' : '#d1d5db',
                background: appSettings.theme === t ? 'var(--sd-color-reference-primary-40, #2563eb)' : '#f9fafb',
                color: appSettings.theme === t ? '#fff' : '#333',
                cursor: 'pointer', fontSize: 13, fontWeight: appSettings.theme === t ? 600 : 400,
              }}
            >
              {THEME_LABELS[t]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="表示モード">
        <div style={{ display: 'flex', gap: 8 }}>
          {COLOR_MODES.map((m) => (
            <button
              key={m}
              onClick={() => updateColorMode(m)}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '2px solid',
                borderColor: appSettings.colorMode === m ? 'var(--sd-color-reference-primary-40, #2563eb)' : '#d1d5db',
                background: appSettings.colorMode === m ? 'var(--sd-color-reference-primary-40, #2563eb)' : '#f9fafb',
                color: appSettings.colorMode === m ? '#fff' : '#333',
                cursor: 'pointer', fontSize: 13,
              }}
            >
              {COLOR_MODE_LABELS[m]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="言語">
        <div style={{ display: 'flex', gap: 8 }}>
          {(['ja', 'en'] as const).map((l) => (
            <button
              key={l}
              onClick={() => {
                const updated = { ...appSettings, language: l }
                window.api.settings.setApp(updated)
                setAppSettings(updated)
              }}
              style={{
                padding: '6px 14px', borderRadius: 6, border: '2px solid',
                borderColor: appSettings.language === l ? '#2563eb' : '#d1d5db',
                background: appSettings.language === l ? '#2563eb' : '#f9fafb',
                color: appSettings.language === l ? '#fff' : '#333',
                cursor: 'pointer', fontSize: 13,
              }}
            >
              {LANG_LABELS[l]}
            </button>
          ))}
        </div>
      </Section>

      <Section title="動作">
        <ToggleRow
          label="保存時に自動エクスポート"
          checked={appSettings.exportOnSave}
          onChange={() => handleToggle('exportOnSave')}
        />
        <ToggleRow
          label="起動時に更新確認"
          checked={appSettings.autoUpdateCheck}
          onChange={() => handleToggle('autoUpdateCheck')}
        />
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#888', letterSpacing: '0.05em', textTransform: 'uppercase', marginBottom: 10 }}>{title}</div>
      {children}
    </div>
  )
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }): React.JSX.Element {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f0f0f0' }}>
      <span>{label}</span>
      <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
        <input type="checkbox" checked={checked} onChange={onChange} style={{ width: 16, height: 16 }} />
      </label>
    </div>
  )
}
