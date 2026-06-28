import React, { useEffect, useRef, useState, useMemo } from 'react'
import { useWorkbenchStore, type ViewId, VIEW_META } from '../../stores/workbenchStore'

interface Command {
  id: string
  label: string
  description?: string
  action: () => void
}

function useCommands(): Command[] {
  const { openTab } = useWorkbenchStore()

  return useMemo(() => {
    const views = Object.entries(VIEW_META) as [ViewId, { label: string }][]
    return [
      ...views.map(([viewId, { label }]) => ({
        id: `view:${viewId}`,
        label: `ビューを開く: ${label}`,
        description: viewId,
        action: () => openTab({ viewId, label }),
      })),
      {
        id: 'dbToText',
        label: 'DB to Text 出力',
        description: 'exports/db_to_text/ にJSONLを生成',
        action: async () => {
          try {
            const r = await window.api.trace.dbToText()
            alert(`完了: ${r.totalRows} 行 → ${r.outputDir}`)
          } catch (e) {
            alert(`エラー: ${e}`)
          }
        },
      },
      {
        id: 'sqliteDump',
        label: 'SQLite Dump 出力',
        description: 'exports/sqlite_dump/ に schema.sql + data.sql を生成',
        action: async () => {
          try {
            const r = await window.api.trace.sqliteDump()
            alert(`完了: ${r.schemaPath}`)
          } catch (e) {
            alert(`エラー: ${e}`)
          }
        },
      },
      {
        id: 'archive',
        label: 'ZIP アーカイブ生成',
        description: 'archives/ に project.db + blobs + exports を圧縮',
        action: async () => {
          try {
            const r = await window.api.artifacts.generateArchive()
            alert(`完了: ${r.archivePath} (${(r.sizeBytes / 1024).toFixed(0)} KB)`)
          } catch (e) {
            alert(`エラー: ${e}`)
          }
        },
      },
      {
        id: 'reports:saveMarkdown',
        label: 'レポート: Markdown 保存',
        description: 'exports/reports/ に Markdown レポートを保存',
        action: async () => {
          try {
            const path = await window.api.reports.saveMarkdown()
            alert(`保存完了: ${path}`)
          } catch (e) { alert(`エラー: ${e}`) }
        },
      },
      {
        id: 'git:commit',
        label: 'Git: 全変更をコミット',
        description: 'git add . && git commit',
        action: async () => {
          const msg = prompt('コミットメッセージ:')
          if (!msg) return
          try {
            const hash = await window.api.git.commit(msg, true)
            alert(`コミット: ${hash}`)
          } catch (e) { alert(`エラー: ${e}`) }
        },
      },
      {
        id: 'licenses:save',
        label: 'ライセンス一覧を保存',
        description: '依存ライブラリのライセンス一覧をエクスポート',
        action: async () => {
          try {
            const path = await window.api.system.saveLicenses()
            if (path) alert(`保存完了: ${path}`)
          } catch (e) { alert(`エラー: ${e}`) }
        },
      },
      {
        id: 'settings:export',
        label: '設定をエクスポート',
        description: '設定ファイルを JSON でエクスポート',
        action: async () => {
          try {
            const path = await window.api.settings.exportToFile()
            if (path) alert(`保存完了: ${path}`)
          } catch (e) { alert(`エラー: ${e}`) }
        },
      },
    ]
  }, [openTab])
}

export function CommandPalette(): React.JSX.Element | null {
  const { commandPaletteOpen, setCommandPaletteOpen } = useWorkbenchStore()
  const [query, setQuery] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const commands = useCommands()

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    const q = query.toLowerCase()
    return commands.filter((c) => c.label.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q))
  }, [commands, query])

  useEffect(() => {
    if (commandPaletteOpen) {
      setQuery('')
      setSelectedIdx(0)
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [commandPaletteOpen])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'P') {
        e.preventDefault()
        setCommandPaletteOpen(!commandPaletteOpen)
      }
      if (!commandPaletteOpen) return
      if (e.key === 'Escape') setCommandPaletteOpen(false)
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)) }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)) }
      if (e.key === 'Enter' && filtered[selectedIdx]) {
        filtered[selectedIdx].action()
        setCommandPaletteOpen(false)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [commandPaletteOpen, filtered, selectedIdx, setCommandPaletteOpen])

  if (!commandPaletteOpen) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'flex-start', justifyContent: 'center', paddingTop: '15vh' }}
      onClick={() => setCommandPaletteOpen(false)}
    >
      <div
        style={{ width: 560, background: '#fff', borderRadius: 8, boxShadow: '0 8px 32px rgba(0,0,0,0.18)', overflow: 'hidden' }}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0) }}
          placeholder="コマンドを検索…"
          style={{
            width: '100%', padding: '12px 16px', border: 'none', outline: 'none',
            fontSize: 14, boxSizing: 'border-box', borderBottom: '1px solid #e0e0e0',
          }}
        />
        <div style={{ maxHeight: 400, overflow: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '12px 16px', color: '#aaa', fontSize: 13 }}>コマンドが見つかりません</div>
          ) : (
            filtered.map((cmd, i) => (
              <div
                key={cmd.id}
                onClick={() => { cmd.action(); setCommandPaletteOpen(false) }}
                style={{
                  padding: '9px 16px', cursor: 'pointer', fontSize: 13,
                  background: i === selectedIdx ? '#eff6ff' : 'transparent',
                  borderLeft: i === selectedIdx ? '2px solid #2563eb' : '2px solid transparent',
                }}
                onMouseEnter={() => setSelectedIdx(i)}
              >
                <div style={{ fontWeight: 500 }}>{cmd.label}</div>
                {cmd.description && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>{cmd.description}</div>}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
