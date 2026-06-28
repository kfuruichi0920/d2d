// T801: レポート出力ページ

import { useState } from 'react'

type Format = 'markdown' | 'html'

const SECTIONS = [
  { key: 'includeResources', label: '設計要素' },
  { key: 'includeTraceLinks', label: 'トレースリンク' },
  { key: 'includeGlossary', label: '用語集' },
] as const

export default function ReportsPage() {
  const [format, setFormat] = useState<Format>('markdown')
  const [sections, setSections] = useState({ includeResources: true, includeTraceLinks: true, includeGlossary: true })
  const [preview, setPreview] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  const opts = { ...sections }

  async function handlePreview() {
    setLoading(true)
    setSavedPath(null)
    try {
      const content = format === 'markdown'
        ? await window.api.reports.generateMarkdown(opts)
        : await window.api.reports.generateHtml(opts)
      setPreview(content)
    } finally {
      setLoading(false)
    }
  }

  async function handleSave() {
    setLoading(true)
    try {
      const path = format === 'markdown'
        ? await window.api.reports.saveMarkdown(opts)
        : await window.api.reports.saveHtml(opts)
      setSavedPath(path)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ツールバー */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--srd-color-border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontWeight: 600, marginRight: 8 }}>レポート出力</span>

        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as Format)}
          style={{ padding: '2px 6px', background: 'var(--srd-color-surface)', color: 'var(--srd-color-on-surface)', border: '1px solid var(--srd-color-border)', borderRadius: 4, cursor: 'pointer' }}
        >
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
        </select>

        {SECTIONS.map((s) => (
          <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={sections[s.key]}
              onChange={(e) => setSections((prev) => ({ ...prev, [s.key]: e.target.checked }))}
            />
            {s.label}
          </label>
        ))}

        <div style={{ flex: 1 }} />
        <button onClick={handlePreview} disabled={loading} style={btnStyle}>プレビュー</button>
        <button onClick={handleSave} disabled={loading} style={{ ...btnStyle, background: 'var(--srd-color-primary)', color: '#fff' }}>保存</button>
      </div>

      {savedPath && (
        <div style={{ padding: '4px 12px', background: '#d1fae5', color: '#065f46', fontSize: 12 }}>
          保存完了: {savedPath}
        </div>
      )}

      {/* プレビュー */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {loading && <div style={{ color: 'var(--srd-color-on-surface-variant)' }}>生成中...</div>}
        {!loading && preview == null && (
          <div style={{ color: 'var(--srd-color-on-surface-variant)', textAlign: 'center', marginTop: 60 }}>
            「プレビュー」ボタンでレポートを生成します
          </div>
        )}
        {!loading && preview != null && (
          format === 'html'
            ? <iframe
                srcDoc={preview}
                style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
                title="report-preview"
              />
            : <pre style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0 }}>
                {preview}
              </pre>
        )}
      </div>
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '4px 10px',
  background: 'var(--srd-color-surface-variant)',
  color: 'var(--srd-color-on-surface)',
  border: '1px solid var(--srd-color-border)',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
}
