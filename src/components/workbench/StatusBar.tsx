import React, { useEffect, useState } from 'react'
import type { ProjectInfo } from '../../types/d2d-api'

export function StatusBar(): React.JSX.Element {
  const [project, setProject] = useState<ProjectInfo | null>(null)

  useEffect(() => {
    window.api.project.getCurrent().then(setProject).catch(() => {})
    const off = window.api.events.on('d2d:project:opened', () => {
      window.api.project.getCurrent().then(setProject).catch(() => {})
    })
    return off
  }, [])

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
        </>
      ) : (
        <span style={{ opacity: 0.6 }}>プロジェクト未選択</span>
      )}
      <span style={{ marginLeft: 'auto', opacity: 0.7 }}>Ctrl+Shift+P: コマンドパレット</span>
    </div>
  )
}
