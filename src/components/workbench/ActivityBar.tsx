import React from 'react'
import {
  SerendieSymbolFolder,
  SerendieSymbolLink,
  SerendieSymbolLoader,
  SerendieSymbolGear,
  SerendieSymbolBriefcase,
} from '@serendie/symbols'
import { useWorkbenchStore, type ActivityBarItem } from '../../stores/workbenchStore'

interface ActivityItem {
  id: ActivityBarItem
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>
  label: string
}

const ITEMS: ActivityItem[] = [
  { id: 'explorer', Icon: SerendieSymbolFolder, label: 'エクスプローラー' },
  { id: 'trace', Icon: SerendieSymbolLink, label: 'トレース' },
  { id: 'llm', Icon: SerendieSymbolBriefcase, label: 'LLM 支援' },
  { id: 'jobs', Icon: SerendieSymbolLoader, label: 'ジョブ' },
  { id: 'settings', Icon: SerendieSymbolGear, label: '設定' },
]

export function ActivityBar(): React.JSX.Element {
  const { activeActivity, setActiveActivity, sideBarOpen, setSideBarOpen } = useWorkbenchStore()

  const handleClick = (id: ActivityBarItem) => {
    if (activeActivity === id && sideBarOpen) {
      setSideBarOpen(false)
    } else {
      setActiveActivity(id)
      setSideBarOpen(true)
    }
  }

  return (
    <div
      style={{
        width: 48,
        background: 'var(--sd-color-bg-layer1, #1e2128)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        paddingTop: 8,
        gap: 4,
        flexShrink: 0,
        zIndex: 10,
      }}
    >
      {ITEMS.map(({ id, Icon, label }) => {
        const active = activeActivity === id && sideBarOpen
        return (
          <button
            key={id}
            onClick={() => handleClick(id)}
            title={label}
            style={{
              width: 40,
              height: 40,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: active ? 'rgba(255,255,255,0.15)' : 'transparent',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
              borderLeft: active ? '2px solid #fff' : '2px solid transparent',
              opacity: active ? 1 : 0.55,
              transition: 'opacity 0.15s, background 0.15s',
            }}
            onMouseEnter={(e) => { if (!active) (e.currentTarget as HTMLElement).style.opacity = '0.85' }}
            onMouseLeave={(e) => { if (!active) (e.currentTarget as HTMLElement).style.opacity = '0.55' }}
          >
            <Icon width={20} height={20} fill="#fff" />
          </button>
        )
      })}
    </div>
  )
}
