import React, { useEffect, useState } from 'react'
import type { ProjectInfo } from '../../types/d2d-api'

interface Props {
  onCloseProject?: () => void
}

export function StatusBar({ onCloseProject }: Props): React.JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null>(null)

  useEffect(() => {
    window.api.project.getCurrent().then(setProject).catch(() => {})
    const off = window.api.events.on('d2d:project:opened', () => {
      window.api.project.getCurrent().then(setProject).catch(() => {})
    })
    return off
  }, [])

  const handleClose = async () => {
    if (!confirm(`「${project?.name}」を閉じますか？`)) return
    await window.api.project.close()
    onCloseProject?.()
  }

  return (
    <div
      style={{
        height: 24,
        background: 'var(--sd-color-reference-primary-40, #2563eb)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 12px',
        gap: 16,
        fontSize: 11,
        color: '#fff',
        flexShrink: 0,
        userSelect: 'none',
      }}
    >
      <span style={{ fontWeight: 600 }}>D2D</span>
      {project ? (
        <>
          <span style={{ opacity: 0.85 }}>{project.name}</span>
          <span style={{ opacity: 0.6 }}>schema {project.schema_version}</span>
          <span style={{ opacity: 0.5, fontSize: 10, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 240, whiteSpace: 'nowrap' }}>
            {project.root_path}
          </span>
        </>
      ) : (
        <span style={{ opacity: 0.6 }}>プロジェクト未選択</span>
      )}
      <span style={{ marginLeft: 'auto', opacity: 0.7 }}>Ctrl+Shift+P: コマンドパレット</span>
      {project && onCloseProject && (
        <button
          onClick={handleClose}
          style={{ background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', cursor: 'pointer', borderRadius: 3, padding: '1px 8px', fontSize: 11, opacity: 0.85 }}
          title="プロジェクトを閉じる"
        >
          閉じる
        </button>
      )}
    </div>
  )
}
