import React from 'react'
import { useWorkbenchStore, type ViewId, VIEW_META } from '../../stores/workbenchStore'

const EXPLORER_VIEWS: ViewId[] = ['sources', 'extraction', 'intermediate', 'design', 'glossary']
const TRACE_VIEWS: ViewId[] = ['trace-matrix', 'trace-graph']

interface SideBarProps {
  width: number
}

function NavItem({ viewId, label }: { viewId: ViewId; label: string }): React.JSX.Element {
  const { openTab, activeTabId, tabs } = useWorkbenchStore()
  const isActive = tabs.find((t) => t.id === viewId && t.id === activeTabId) !== undefined

  return (
    <div
      onClick={() => openTab({ viewId, label })}
      style={{
        padding: '6px 16px 6px 24px',
        cursor: 'pointer',
        fontSize: 13,
        color: isActive ? 'var(--sd-color-text-primary, #111)' : 'var(--sd-color-text-secondary, #555)',
        fontWeight: isActive ? 600 : 400,
        background: isActive ? 'var(--sd-color-bg-layer2-hover, #e8eaed)' : 'transparent',
        borderLeft: isActive ? '2px solid var(--sd-color-reference-primary-40, #2563eb)' : '2px solid transparent',
        userSelect: 'none',
      }}
    >
      {label}
    </div>
  )
}

function SectionHeader({ label }: { label: string }): React.JSX.Element {
  return (
    <div style={{
      padding: '8px 12px 4px',
      fontSize: 11,
      fontWeight: 700,
      color: 'var(--sd-color-text-secondary, #888)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      userSelect: 'none',
    }}>
      {label}
    </div>
  )
}

export function SideBar({ width }: SideBarProps): React.JSX.Element {
  const { activeActivity } = useWorkbenchStore()

  return (
    <div
      style={{
        width,
        background: 'var(--sd-color-bg-layer1, #f5f6f7)',
        borderRight: '1px solid var(--sd-color-border-default, #e0e0e0)',
        display: 'flex',
        flexDirection: 'column',
        flexShrink: 0,
        overflow: 'hidden',
      }}
    >
      <div style={{ padding: '10px 12px', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#888', borderBottom: '1px solid #e0e0e0', userSelect: 'none' }}>
        {activeActivity === 'explorer' && 'エクスプローラー'}
        {activeActivity === 'trace' && 'トレース'}
        {activeActivity === 'jobs' && 'ジョブ'}
        {activeActivity === 'settings' && '設定'}
      </div>

      <div style={{ flex: 1, overflow: 'auto' }}>
        {activeActivity === 'explorer' && (
          <>
            <SectionHeader label="データ階層" />
            {EXPLORER_VIEWS.map((v) => (
              <NavItem key={v} viewId={v} label={VIEW_META[v].label} />
            ))}
          </>
        )}

        {activeActivity === 'trace' && (
          <>
            <SectionHeader label="トレース" />
            {TRACE_VIEWS.map((v) => (
              <NavItem key={v} viewId={v} label={VIEW_META[v].label} />
            ))}
          </>
        )}

        {activeActivity === 'jobs' && (
          <NavItem viewId="jobs" label={VIEW_META['jobs'].label} />
        )}

        {activeActivity === 'settings' && (
          <NavItem viewId="settings" label={VIEW_META['settings'].label} />
        )}
      </div>
    </div>
  )
}
