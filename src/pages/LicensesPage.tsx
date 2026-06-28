// T807: 依存ライブラリ・ライセンス一覧ページ

import { useState, useEffect } from 'react'
import type { DependencyInfo } from '../types/d2d-api'

export default function LicensesPage() {
  const [deps, setDeps] = useState<DependencyInfo[]>([])
  const [devIncluded, setDevIncluded] = useState(false)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    window.api.system.listDependencies(devIncluded).then((d) => {
      setDeps(d)
      setLoading(false)
    })
  }, [devIncluded])

  const filtered = deps.filter((d) =>
    !search || d.name.includes(search) || (d.license ?? '').includes(search) || (d.description ?? '').includes(search)
  )

  const licenseGroups = filtered.reduce<Record<string, number>>((acc, d) => {
    const key = d.license ?? '不明'
    acc[key] = (acc[key] ?? 0) + 1
    return acc
  }, {})

  async function handleSave() {
    const path = await window.api.system.saveLicenses(devIncluded)
    if (path) setSavedPath(path)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      {/* ツールバー */}
      <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--srd-color-border)', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
        <span style={{ fontWeight: 600, marginRight: 8 }}>ライセンス一覧</span>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, cursor: 'pointer' }}>
          <input type="checkbox" checked={devIncluded} onChange={(e) => setDevIncluded(e.target.checked)} />
          開発依存を含む
        </label>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="検索..."
          style={{ padding: '3px 8px', background: 'var(--srd-color-surface)', color: 'var(--srd-color-on-surface)', border: '1px solid var(--srd-color-border)', borderRadius: 4, fontSize: 12 }}
        />
        <span style={{ fontSize: 11, color: 'var(--srd-color-on-surface-variant)' }}>{filtered.length} 件</span>
        <div style={{ flex: 1 }} />
        <button onClick={handleSave} style={btnStyle}>エクスポート</button>
      </div>

      {savedPath && (
        <div style={{ padding: '4px 12px', background: '#d1fae5', color: '#065f46', fontSize: 12 }}>
          保存完了: {savedPath}
        </div>
      )}

      {/* ライセンス集計 */}
      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--srd-color-border)', display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0 }}>
        {Object.entries(licenseGroups).sort(([, a], [, b]) => b - a).map(([lic, count]) => (
          <span
            key={lic}
            onClick={() => setSearch(lic === search ? '' : lic)}
            style={{ padding: '2px 8px', borderRadius: 10, background: 'var(--srd-color-surface-variant)', fontSize: 11, cursor: 'pointer', border: search === lic ? '1px solid var(--srd-color-primary)' : '1px solid transparent' }}
          >
            {lic} ({count})
          </span>
        ))}
      </div>

      {/* テーブル */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && <div style={{ padding: 12, color: 'var(--srd-color-on-surface-variant)' }}>読み込み中...</div>}
        {!loading && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ background: 'var(--srd-color-surface-variant)', position: 'sticky', top: 0 }}>
                <th style={thStyle}>パッケージ</th>
                <th style={{ ...thStyle, width: 100 }}>バージョン</th>
                <th style={{ ...thStyle, width: 120 }}>ライセンス</th>
                <th style={thStyle}>説明</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.name} style={{ borderBottom: '1px solid var(--srd-color-border)' }}>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>
                    {d.repository
                      ? <a href={d.repository} target="_blank" rel="noreferrer" style={{ color: 'var(--srd-color-primary)', textDecoration: 'none' }}>{d.name}</a>
                      : d.name}
                  </td>
                  <td style={{ padding: '4px 8px', color: 'var(--srd-color-on-surface-variant)', fontFamily: 'monospace' }}>{d.version}</td>
                  <td style={{ padding: '4px 8px' }}>
                    <span style={{
                      padding: '1px 6px',
                      borderRadius: 8,
                      background: licenseColor(d.license),
                      color: '#fff',
                      fontSize: 10,
                    }}>
                      {d.license ?? '不明'}
                    </span>
                  </td>
                  <td style={{ padding: '4px 8px', color: 'var(--srd-color-on-surface-variant)' }}>{d.description?.slice(0, 80) ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function licenseColor(license: string | null): string {
  if (!license) return '#6b7280'
  if (license.startsWith('MIT')) return '#2563eb'
  if (license.startsWith('Apache')) return '#7c3aed'
  if (license.startsWith('BSD')) return '#0891b2'
  if (license.startsWith('ISC')) return '#059669'
  if (license.includes('GPL') || license.includes('LGPL')) return '#dc2626'
  return '#6b7280'
}

const thStyle: React.CSSProperties = {
  padding: '4px 8px',
  textAlign: 'left',
  borderBottom: '1px solid var(--srd-color-border)',
  fontWeight: 600,
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
