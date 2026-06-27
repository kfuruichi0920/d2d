import React, { useCallback, useRef, useState } from 'react'
import { ActivityBar } from './ActivityBar'
import { SideBar } from './SideBar'
import { EditorArea } from './EditorArea'
import { StatusBar } from './StatusBar'
import { CommandPalette } from './CommandPalette'
import { useWorkbenchStore } from '../../stores/workbenchStore'

const MIN_SIDEBAR_WIDTH = 160
const MAX_SIDEBAR_WIDTH = 480

export function Workbench(): React.JSX.Element {
  const { sideBarOpen, sideBarWidth, setSideBarWidth, panelOpen } = useWorkbenchStore()
  const [dragging, setDragging] = useState(false)
  const startX = useRef(0)
  const startWidth = useRef(sideBarWidth)

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      setDragging(true)
      startX.current = e.clientX
      startWidth.current = sideBarWidth

      const onMove = (ev: MouseEvent) => {
        const delta = ev.clientX - startX.current
        const next = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, startWidth.current + delta))
        setSideBarWidth(next)
      }
      const onUp = () => {
        setDragging(false)
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [sideBarWidth, setSideBarWidth]
  )

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        overflow: 'hidden',
        userSelect: dragging ? 'none' : undefined,
      }}
    >
      {/* メインエリア: ActivityBar + SideBar + EditorArea */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <ActivityBar />

        {sideBarOpen && (
          <>
            <SideBar width={sideBarWidth} />
            {/* リサイズハンドル */}
            <div
              onMouseDown={onMouseDown}
              style={{
                width: 4,
                cursor: 'col-resize',
                background: dragging ? 'var(--sd-color-reference-primary-40, #2563eb)' : 'transparent',
                flexShrink: 0,
                transition: 'background 0.15s',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--sd-color-border-default, #d1d5db)' }}
              onMouseLeave={(e) => { if (!dragging) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
            />
          </>
        )}

        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <EditorArea />

          {panelOpen && <BottomPanel />}
        </div>
      </div>

      <StatusBar />
      <CommandPalette />
    </div>
  )
}

function BottomPanel(): React.JSX.Element {
  const { panelHeight, setPanelHeight, setPanelOpen, activePanelTab, setActivePanelTab } = useWorkbenchStore()
  const startY = useRef(0)
  const startH = useRef(panelHeight)

  const onMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    startY.current = e.clientY
    startH.current = panelHeight

    const onMove = (ev: MouseEvent) => {
      const delta = startY.current - ev.clientY
      const next = Math.min(600, Math.max(80, startH.current + delta))
      setPanelHeight(next)
    }
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const TABS = [
    { id: 'jobs' as const, label: 'ジョブ' },
    { id: 'output' as const, label: '出力' },
    { id: 'problems' as const, label: '問題' },
  ]

  return (
    <div style={{ flexShrink: 0, height: panelHeight, display: 'flex', flexDirection: 'column', borderTop: '1px solid var(--sd-color-border-default, #e0e0e0)' }}>
      {/* リサイズハンドル */}
      <div
        onMouseDown={onMouseDown}
        style={{ height: 4, cursor: 'row-resize', background: 'transparent', flexShrink: 0 }}
        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = '#d1d5db' }}
        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      />

      {/* パネルタブバー */}
      <div style={{ display: 'flex', alignItems: 'center', height: 32, background: '#f5f6f7', borderBottom: '1px solid #e0e0e0', paddingLeft: 8, gap: 4, flexShrink: 0 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActivePanelTab(t.id)}
            style={{
              padding: '4px 10px', border: 'none', borderRadius: 4, cursor: 'pointer', fontSize: 12,
              background: activePanelTab === t.id ? '#fff' : 'transparent',
              fontWeight: activePanelTab === t.id ? 600 : 400,
              color: activePanelTab === t.id ? '#111' : '#666',
            }}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={() => setPanelOpen(false)}
          style={{ marginLeft: 'auto', marginRight: 8, border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#999', padding: '0 4px' }}
          title="パネルを閉じる"
        >
          ×
        </button>
      </div>

      {/* パネルコンテンツ */}
      <div style={{ flex: 1, overflow: 'auto', padding: 12, fontSize: 12, color: '#555', background: '#fff' }}>
        {activePanelTab === 'jobs' && <PanelJobs />}
        {activePanelTab === 'output' && <div style={{ fontFamily: 'monospace' }}>出力ログがここに表示されます</div>}
        {activePanelTab === 'problems' && <div>問題は検出されていません</div>}
      </div>
    </div>
  )
}

function PanelJobs(): React.JSX.Element {
  const [jobs, setJobs] = React.useState<Array<{ uid: string; batch_type: string; status: string }>>([])

  React.useEffect(() => {
    window.api.jobs.list().then(setJobs).catch(() => {})
    const off = window.api.events.on('d2d:job:updated', () => {
      window.api.jobs.list().then(setJobs).catch(() => {})
    })
    return off
  }, [])

  if (jobs.length === 0) return <div style={{ color: '#aaa' }}>実行中のジョブはありません</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {jobs.slice(0, 5).map((j) => (
        <div key={j.uid} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ background: STATUS_BG[j.status] ?? '#e0e0e0', color: STATUS_FG[j.status] ?? '#333', padding: '1px 6px', borderRadius: 3, fontSize: 11 }}>
            {j.status}
          </span>
          <span>{j.batch_type}</span>
        </div>
      ))}
    </div>
  )
}

const STATUS_BG: Record<string, string> = { pending: '#fef3c7', running: '#dbeafe', success: '#d1fae5', failed: '#fee2e2' }
const STATUS_FG: Record<string, string> = { pending: '#92400e', running: '#1e40af', success: '#065f46', failed: '#991b1b' }
