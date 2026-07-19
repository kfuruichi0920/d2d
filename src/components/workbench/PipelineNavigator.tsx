/** 上部メニューバー（P3-7、UI-046、SEARCH-003）。 */
import { useEffect, useMemo, useState } from 'react'
import { executeCommand } from '../../services/command-registry'
import { getCommandContext } from '../../services/builtin-commands'
import { canNavigateBack, canNavigateForward, subscribeNavigationHistory } from '../../services/navigation-history'
import { resolveResourceAddress } from '../../services/resource-address'
import { useEditorStore } from '../../stores/editor-store'
import { useFavoritesStore } from '../../stores/favorites-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore, type PipelineStats } from '../../stores/project-store'
import { useWorkbenchStore, type WorkMode } from '../../stores/workbench-store'
import { OPEN_SCREEN_TEXT_SEARCH } from './ScreenTextSearch'

interface StageDef {
  key: 'source' | 'extracted' | 'intermediate' | 'design'
  label: string
  mode: WorkMode
  count: (stats: PipelineStats) => number
}

const STAGES: StageDef[] = [
  { key: 'source', label: '①原本', mode: 'M1', count: (stats) => stats.sources },
  { key: 'extracted', label: '②抽出', mode: 'M1', count: (stats) => stats.extracted },
  { key: 'intermediate', label: '③中間', mode: 'M2', count: (stats) => stats.intermediate },
  { key: 'design', label: '④モデル', mode: 'M3', count: (stats) => stats.designElements }
]
const ARROWS = ['抽出▶', '統合▶', 'モデル化▶']

export function PipelineNavigator(): React.JSX.Element {
  const project = useProjectStore((state) => state.project)
  const stats = useProjectStore((state) => state.stats)
  const switchMode = useWorkbenchStore((state) => state.switchMode)
  const notify = useJobsStore((state) => state.notify)
  const openResource = useEditorStore((state) => state.openResource)
  const activeUri = useEditorStore((state) => state.activeUri)
  const groups = useEditorStore((state) => state.groups)
  const favorites = useFavoritesStore((state) => state.items)
  const toggleFavorite = useFavoritesStore((state) => state.toggle)
  const [address, setAddress] = useState(activeUri ?? '')
  const [, setHistoryVersion] = useState(0)

  useEffect(() => setAddress(activeUri ?? ''), [activeUri])
  useEffect(() => subscribeNavigationHistory(() => setHistoryVersion((value) => value + 1)), [])

  const activeTitle = useMemo(() => {
    if (!activeUri) return ''
    for (const group of groups) {
      const tab = group.tabs.find((candidate) => candidate.uri === activeUri)
      if (tab) return tab.title
    }
    return activeUri
  }, [activeUri, groups])
  const favorite = activeUri ? favorites.some((item) => item.uri === activeUri) : false

  const navigateAddress = (): void => {
    const resolved = resolveResourceAddress(address)
    if (!resolved) {
      notify('error', 'アドレスを開けません', '既知のResource URIを入力してください（例: resource://<uid>）')
      return
    }
    openResource(resolved.uri, resolved.title, { preview: false })
  }
  const run = (id: string): void => void executeCommand(id, undefined, getCommandContext())

  return (
    <nav className="wb-pipeline" data-testid="pipeline-navigator" aria-label="Workbenchメニューバー">
      <div className="wb-menu-buttons">
        <span className="wb-navigation-buttons" aria-label="Resource履歴操作">
          <button
            type="button"
            className="wb-nav-icon"
            data-testid="nav-back"
            disabled={!canNavigateBack()}
            title="戻る（Alt+←／マウス戻る）"
            aria-label="戻る"
            onClick={() => run('nav.back')}
          >
            ←
          </button>
          <button
            type="button"
            className="wb-nav-icon"
            data-testid="nav-forward"
            disabled={!canNavigateForward()}
            title="進む（Alt+→／マウス進む）"
            aria-label="進む"
            onClick={() => run('nav.forward')}
          >
            →
          </button>
          <button
            type="button"
            className="wb-nav-icon"
            data-testid="nav-refresh"
            disabled={!activeUri}
            title="現在のEditorを更新"
            aria-label="更新"
            onClick={() => run('nav.refresh')}
          >
            ↻
          </button>
          <button
            type="button"
            className="wb-nav-icon"
            data-testid="nav-home"
            disabled={!project}
            title="ホーム（ダッシュボード）"
            aria-label="ホーム"
            onClick={() => run('nav.home')}
          >
            ⌂
          </button>
        </span>
        <span className="wb-menu-separator" aria-hidden="true" />
        {STAGES.map((stage, index) => (
          <span key={stage.key} className="wb-stage-segment">
            {index > 0 && <span className="wb-stage-arrow">{ARROWS[index - 1]}</span>}
            <button
              type="button"
              className={`wb-stage ${activeUri === `stage://${stage.key}` ? 'active' : ''}`}
              data-testid={`stage-${stage.key}`}
              disabled={!project}
              onClick={() => {
                switchMode(stage.mode)
                openResource(`stage://${stage.key}`, `${stage.label}一覧`, { preview: false })
              }}
              title={`${stage.label} — 一覧を開く`}
            >
              {stage.label}
              <span className="count">{stats ? stage.count(stats) : '-'}</span>
            </button>
          </span>
        ))}
        <button
          type="button"
          className="wb-stage"
          data-testid="pipeline-analysis"
          disabled={!project}
          title="全抽出データ・全中間データ・全モデルの汎用インパクト分析を開く"
          onClick={() => openResource('trace://list-link/pipeline', '汎用インパクト分析', { preview: false })}
        >
          分析
        </button>
        <button
          type="button"
          className="wb-stage"
          data-testid="pipeline-glossary"
          disabled={!project}
          title="プロジェクト用語集を開く"
          onClick={() => openResource('glossary://workspace', '用語集', { preview: false })}
        >
          用語集
        </button>
      </div>
      <span className="wb-menu-separator" aria-hidden="true" />
      <div className="wb-resource-address">
        <input
          value={address}
          data-testid="resource-address"
          aria-label="現在のResourceアドレス"
          title="現在のResource URI。既知のURIを入力してEnterで移動します（例: resource://<uid>）"
          placeholder="resource://..."
          onChange={(event) => setAddress(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') navigateAddress()
          }}
        />
        <button
          type="button"
          className={`wb-address-icon wb-favorite-toggle ${favorite ? 'active' : ''}`}
          data-testid="favorite-toggle"
          aria-label={favorite ? 'お気に入りから解除' : 'お気に入りに追加'}
          aria-pressed={favorite}
          title={favorite ? '現在のResourceをお気に入りから解除' : '現在のResourceをお気に入りに追加'}
          disabled={!project || !activeUri}
          onClick={() => {
            if (activeUri) toggleFavorite(activeUri, activeTitle)
          }}
        >
          {favorite ? '★' : '☆'}
        </button>
      </div>
      <span className="wb-menu-separator" aria-hidden="true" />
      <button
        type="button"
        className="wb-address-icon"
        data-testid="open-screen-search"
        aria-label="画面内検索"
        title="現在画面の文字列検索（Ctrl+F）"
        onClick={() => window.dispatchEvent(new Event(OPEN_SCREEN_TEXT_SEARCH))}
      >
        ⌕
      </button>
    </nav>
  )
}
