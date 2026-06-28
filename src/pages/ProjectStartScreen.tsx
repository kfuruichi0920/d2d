// プロジェクト未選択時のスタート画面

import React, { useState } from 'react'
import type { ProjectInfo } from '../types/d2d-api'

interface Props {
  onProjectOpened: (info: ProjectInfo) => void
}

type Mode = 'top' | 'create'

export function ProjectStartScreen({ onProjectOpened }: Props): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('top')
  const [projectName, setProjectName] = useState('')
  const [dirPath, setDirPath] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleOpen() {
    setLoading(true)
    setError(null)
    try {
      const info = await window.api.project.openDialog()
      if (info) onProjectOpened(info)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleSelectDir() {
    const dir = await window.api.project.selectDir()
    if (dir) setDirPath(dir)
  }

  async function handleCreate() {
    if (!projectName.trim()) { setError('プロジェクト名を入力してください'); return }
    if (!dirPath.trim()) { setError('フォルダを選択してください'); return }
    setLoading(true)
    setError(null)
    try {
      await window.api.project.create({ name: projectName.trim(), description: description.trim() || undefined, dirPath })
      const info = await window.api.project.getCurrent()
      if (info) onProjectOpened(info)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '100vh', background: 'var(--srd-color-surface, #f8fafc)',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    }}>
      {/* ロゴ */}
      <div style={{ marginBottom: 40, textAlign: 'center' }}>
        <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--srd-color-on-surface, #111)' }}>D2D</div>
        <div style={{ fontSize: 14, color: 'var(--srd-color-on-surface-variant, #666)', marginTop: 4 }}>Design to Digital</div>
      </div>

      {mode === 'top' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, width: 320 }}>
          <button onClick={() => setMode('create')} disabled={loading} style={primaryBtn}>
            ＋ 新しいプロジェクトを作成
          </button>
          <button onClick={handleOpen} disabled={loading} style={secondaryBtn}>
            📂 既存のプロジェクトを開く
          </button>
          {error && <div style={errorStyle}>{error}</div>}
          {loading && <div style={{ textAlign: 'center', fontSize: 13, color: '#888' }}>読み込み中...</div>}
        </div>
      )}

      {mode === 'create' && (
        <div style={{ width: 400, background: 'var(--srd-color-surface, #fff)', borderRadius: 12, border: '1px solid var(--srd-color-border, #e0e0e0)', padding: 28, boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <h2 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 700 }}>新しいプロジェクト</h2>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>プロジェクト名 *</label>
            <input
              autoFocus
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="例: System Requirements v1"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <label style={labelStyle}>説明（任意）</label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="プロジェクトの概要"
              style={inputStyle}
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label style={labelStyle}>保存フォルダ *</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={dirPath}
                onChange={(e) => setDirPath(e.target.value)}
                placeholder="フォルダのパス"
                style={{ ...inputStyle, flex: 1 }}
                readOnly
              />
              <button onClick={handleSelectDir} style={secondaryBtn}>
                選択
              </button>
            </div>
            {dirPath && (
              <div style={{ fontSize: 11, color: '#888', marginTop: 4, wordBreak: 'break-all' }}>{dirPath}</div>
            )}
          </div>

          {error && <div style={errorStyle}>{error}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => { setMode('top'); setError(null) }} style={{ ...secondaryBtn, flex: 1 }}>
              キャンセル
            </button>
            <button onClick={handleCreate} disabled={loading || !projectName.trim() || !dirPath.trim()} style={{ ...primaryBtn, flex: 2 }}>
              {loading ? '作成中...' : '作成'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

const primaryBtn: React.CSSProperties = {
  padding: '12px 20px',
  background: '#2563eb',
  color: '#fff',
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 14,
  fontWeight: 600,
  textAlign: 'center',
}

const secondaryBtn: React.CSSProperties = {
  padding: '10px 16px',
  background: 'var(--srd-color-surface-variant, #f3f4f6)',
  color: 'var(--srd-color-on-surface, #111)',
  border: '1px solid var(--srd-color-border, #e0e0e0)',
  borderRadius: 8,
  cursor: 'pointer',
  fontSize: 13,
  textAlign: 'center',
}

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--srd-color-on-surface-variant, #555)',
  marginBottom: 5,
}

const inputStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  boxSizing: 'border-box',
  padding: '8px 10px',
  background: 'var(--srd-color-surface, #fff)',
  color: 'var(--srd-color-on-surface, #111)',
  border: '1px solid var(--srd-color-border, #d1d5db)',
  borderRadius: 6,
  fontSize: 13,
  outline: 'none',
}

const errorStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: '#fef2f2',
  color: '#dc2626',
  border: '1px solid #fca5a5',
  borderRadius: 6,
  fontSize: 12,
}
