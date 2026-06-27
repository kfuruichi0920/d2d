import React, { useEffect, useState, useCallback } from 'react'
import type { PromptTemplate, PromptVersion, ProviderConfig, LlmProvider } from '../types/d2d-api'

const PROVIDER_LABELS: Record<LlmProvider, string> = {
  openai: 'OpenAI',
  gemini: 'Google Gemini',
  ollama: 'Ollama (ローカル)',
  azure_openai: 'Azure OpenAI',
  anthropic: 'Anthropic Claude',
}

const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: 'gpt-4o-mini',
  gemini: 'gemini-1.5-flash',
  ollama: 'llama3.1',
  azure_openai: 'gpt-4o',
  anthropic: 'claude-sonnet-4-6',
}

export function LlmPromptsPage(): React.JSX.Element {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [providers, setProviders] = useState<ProviderConfig[]>([])
  const [selected, setSelected] = useState<PromptTemplate | null>(null)
  const [version, setVersion] = useState<PromptVersion | null>(null)
  const [tab, setTab] = useState<'templates' | 'providers'>('templates')
  const [showNewProvider, setShowNewProvider] = useState(false)
  const [newProvider, setNewProvider] = useState<LlmProvider>('openai')
  const [newModelName, setNewModelName] = useState(DEFAULT_MODELS['openai'])
  const [newEndpoint, setNewEndpoint] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    await window.api.llm.seedBuiltins()
    const [tList, pList] = await Promise.all([
      window.api.llm.listTemplates(),
      window.api.llm.listProviders(),
    ])
    setTemplates(tList)
    setProviders(pList)
  }, [])

  useEffect(() => { load() }, [load])

  const handleSelectTemplate = async (t: PromptTemplate) => {
    setSelected(t)
    const v = await window.api.llm.getLatestVersion(t.uid)
    setVersion(v)
  }

  const handleSaveProvider = async () => {
    setSaving(true)
    try {
      await window.api.llm.createProvider({
        provider: newProvider,
        display_name: PROVIDER_LABELS[newProvider],
        model_name: newModelName,
        endpoint_url: newEndpoint || null,
        max_tokens: 4096,
        temperature: 0.2,
        is_default: providers.length === 0 ? 1 : 0,
      })
      if (apiKey) {
        await window.api.settings.setApiKey(newProvider, 'default', apiKey)
      }
      setShowNewProvider(false)
      setApiKey('')
      setNewEndpoint('')
      load()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontSize: 13 }}>
      {/* 左パネル */}
      <div style={{ width: 300, borderRight: '1px solid #e0e0e0', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        {/* タブ */}
        <div style={{ display: 'flex', borderBottom: '1px solid #e0e0e0' }}>
          {(['templates', 'providers'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{ flex: 1, padding: '8px 4px', border: 'none', background: tab === t ? '#fff' : '#f5f6f7', borderBottom: tab === t ? '2px solid #2563eb' : '2px solid transparent', cursor: 'pointer', fontSize: 12, fontWeight: tab === t ? 600 : 400 }}
            >
              {t === 'templates' ? 'プロンプト' : 'プロバイダー'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          {tab === 'templates' && (
            templates.map((t) => (
              <div
                key={t.uid}
                onClick={() => handleSelectTemplate(t)}
                style={{
                  padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f5f5f5',
                  background: selected?.uid === t.uid ? '#eff6ff' : 'transparent',
                  borderLeft: selected?.uid === t.uid ? '3px solid #2563eb' : '3px solid transparent',
                }}
              >
                <div style={{ fontWeight: 500 }}>{t.name}</div>
                <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>
                  {t.purpose} {t.is_builtin ? '· 組み込み' : ''}
                </div>
              </div>
            ))
          )}

          {tab === 'providers' && (
            <>
              {providers.map((p) => (
                <div key={p.uid} style={{ padding: '8px 12px', borderBottom: '1px solid #f5f5f5' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 500 }}>{p.display_name}</span>
                    {!!p.is_default && <span style={{ fontSize: 10, background: '#dbeafe', color: '#1e40af', padding: '1px 5px', borderRadius: 3 }}>デフォルト</span>}
                  </div>
                  <div style={{ fontSize: 11, color: '#6b7280' }}>{p.model_name}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    {!p.is_default && (
                      <button onClick={() => window.api.llm.updateProvider(p.uid, { is_default: 1 }).then(load)} style={smBtn('#e0e7ff', '#3730a3')}>デフォルト設定</button>
                    )}
                    <button onClick={() => window.api.llm.deleteProvider(p.uid).then(load)} style={smBtn('#fee2e2', '#991b1b')}>削除</button>
                  </div>
                </div>
              ))}

              {!showNewProvider ? (
                <button onClick={() => setShowNewProvider(true)} style={{ margin: 12, padding: '6px 12px', background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 5, cursor: 'pointer', color: '#0369a1', fontSize: 12 }}>
                  + プロバイダーを追加
                </button>
              ) : (
                <div style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ fontSize: 12, fontWeight: 600 }}>新規プロバイダー</div>
                  <select value={newProvider} onChange={(e) => { const p = e.target.value as LlmProvider; setNewProvider(p); setNewModelName(DEFAULT_MODELS[p]) }}
                    style={{ padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12 }}>
                    {(Object.entries(PROVIDER_LABELS) as [LlmProvider, string][]).map(([k, v]) => (
                      <option key={k} value={k}>{v}</option>
                    ))}
                  </select>
                  <input placeholder="モデル名" value={newModelName} onChange={(e) => setNewModelName(e.target.value)}
                    style={inputStyle} />
                  {(newProvider === 'ollama' || newProvider === 'azure_openai') && (
                    <input placeholder="エンドポイント URL" value={newEndpoint} onChange={(e) => setNewEndpoint(e.target.value)}
                      style={inputStyle} />
                  )}
                  {newProvider !== 'ollama' && (
                    <input placeholder="API キー" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                      style={inputStyle} />
                  )}
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button onClick={handleSaveProvider} disabled={saving} style={smBtn('#d1fae5', '#065f46')}>保存</button>
                    <button onClick={() => setShowNewProvider(false)} style={smBtn('#f3f4f6', '#555')}>キャンセル</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 右パネル: プロンプト詳細 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        {tab === 'providers' ? (
          <div style={{ color: '#888' }}>プロバイダーを選択するか追加してください。</div>
        ) : selected && version ? (
          <div>
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 15 }}>{selected.name}</h3>
              {selected.description && <div style={{ color: '#6b7280', marginTop: 4 }}>{selected.description}</div>}
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>
                バージョン {version.version} · {selected.purpose} {selected.is_builtin ? '· 組み込み' : ''}
              </div>
            </div>

            {version.system_prompt && (
              <Section title="システムプロンプト">
                <pre style={preStyle}>{version.system_prompt}</pre>
              </Section>
            )}

            <Section title="ユーザーテンプレート">
              <pre style={preStyle}>{version.user_template}</pre>
            </Section>

            {version.variables_json && (
              <Section title="変数">
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {(JSON.parse(version.variables_json) as string[]).map((v) => (
                    <span key={v} style={{ padding: '2px 8px', background: '#f3f4f6', border: '1px solid #e0e0e0', borderRadius: 4, fontSize: 12, fontFamily: 'monospace' }}>
                      {`{{${v}}}`}
                    </span>
                  ))}
                </div>
              </Section>
            )}

            {!selected.is_builtin && (
              <button onClick={() => window.api.llm.deleteTemplate(selected.uid).then(() => { setSelected(null); load() })} style={{ marginTop: 16, ...smBtn('#fee2e2', '#991b1b') }}>
                テンプレートを削除
              </button>
            )}
          </div>
        ) : (
          <div style={{ color: '#aaa', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
            プロンプトテンプレートを選択してください
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>{title}</div>
      {children}
    </div>
  )
}

const preStyle: React.CSSProperties = {
  background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: 12,
  fontSize: 12, fontFamily: 'monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0,
}
const inputStyle: React.CSSProperties = { padding: '4px 8px', border: '1px solid #d1d5db', borderRadius: 4, fontSize: 12, width: '100%', boxSizing: 'border-box' }
function smBtn(bg: string, color: string): React.CSSProperties {
  return { padding: '3px 8px', background: bg, color, border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 11 }
}
