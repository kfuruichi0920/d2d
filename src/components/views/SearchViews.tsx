import { useEffect, useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { invoke } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useProjectStore } from '../../stores/project-store'
import { useResourceNavigationStore } from '../../stores/resource-navigation-store'

export interface SearchResultRow {
  uid: string
  entityType: string
  code: string
  title: string
  snippet: string
  score: number
  resourceUri: string
  targetItemUid?: string
  targetResourceUid?: string
}
interface SearchResponse {
  results: SearchResultRow[]
  indexCount: number
  tokenizer: 'mecab' | 'unicode'
  warning?: string
}
interface SearchState {
  query: string
  entityType: string
  useMecab: boolean
  loading: boolean
  response: SearchResponse | null
  error: string | null
  setQuery(query: string): void
  setEntityType(entityType: string): void
  setUseMecab(useMecab: boolean): void
  run(): Promise<void>
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  entityType: '',
  useMecab: false,
  loading: false,
  response: null,
  error: null,
  setQuery: (query) => set({ query }),
  setEntityType: (entityType) => set({ entityType }),
  setUseMecab: (useMecab) => set({ useMecab }),
  run: async () => {
    const { query, entityType, useMecab } = get()
    if (!query.trim()) return
    set({ loading: true, error: null })
    const result = await invoke<SearchResponse>('search.elements', {
      query,
      entityType: entityType || undefined,
      useMecab,
      limit: 100
    })
    if (result.ok) set({ loading: false, response: result.result })
    else set({ loading: false, error: result.error.message })
  }
}))

const ENTITY_TYPES = [
  ['source_document', '原本'],
  ['extracted_document', '抽出文書'],
  ['intermediate_document', '中間文書'],
  ['resource_glossary', '用語'],
  ['resource_text', 'テキスト'],
  ['resource_model', 'モデル']
]
const TYPE_LABELS: Record<string, string> = Object.fromEntries(ENTITY_TYPES)

function SearchResultsTree({ response }: { response: SearchResponse }): React.JSX.Element {
  const openResource = useEditorStore((state) => state.openResource)
  const selectTarget = useResourceNavigationStore((state) => state.select)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => {
    const result = new Map<string, SearchResultRow[]>()
    for (const row of response.results) result.set(row.entityType, [...(result.get(row.entityType) ?? []), row])
    return [...result.entries()]
  }, [response.results])

  useEffect(() => {
    setCollapsed(Object.fromEntries(groups.map(([type, rows]) => [type, rows.length > 10])))
    setSelectedUid(response.results[0]?.uid ?? null)
  }, [groups, response.results])

  const visible = groups.flatMap(([type, rows]) => (collapsed[type] ? [] : rows))
  const open = (row: SearchResultRow): void => {
    setSelectedUid(row.uid)
    selectTarget(row.resourceUri, row.targetItemUid, row.targetResourceUid)
    openResource(row.resourceUri, `${row.code}: ${row.title}`, { preview: true })
  }
  const toggle = (type: string, value?: boolean): void =>
    setCollapsed((current) => ({ ...current, [type]: value ?? !current[type] }))
  const selected = response.results.find((row) => row.uid === selectedUid)

  return (
    <div
      ref={rootRef}
      className="d2d-search-results-tree"
      data-testid="search-results"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          if (visible.length === 0) return
          const index = Math.max(
            0,
            visible.findIndex((row) => row.uid === selectedUid)
          )
          const next = visible[Math.max(0, Math.min(visible.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]
          if (next) open(next)
        } else if (selected && event.key === 'ArrowLeft') {
          event.preventDefault()
          toggle(selected.entityType, true)
        } else if (selected && event.key === 'ArrowRight') {
          event.preventDefault()
          toggle(selected.entityType, false)
        }
      }}
    >
      {response.warning && <div className="d2d-search-warning">{response.warning}</div>}
      {groups.map(([type, rows]) => (
        <section key={type} className="d2d-search-result-group">
          <button
            type="button"
            className="d2d-search-group-header"
            aria-expanded={!collapsed[type]}
            onClick={() => toggle(type)}
          >
            <span>{collapsed[type] ? '▸' : '▾'}</span>
            <span>{TYPE_LABELS[type] ?? type}</span>
            <span className="d2d-search-group-count">{rows.length}</span>
          </button>
          {!collapsed[type] &&
            rows.map((row) => (
              <button
                type="button"
                key={row.uid}
                className={`d2d-search-result ${selectedUid === row.uid ? 'selected' : ''}`}
                data-testid={`search-result-${row.code}`}
                onClick={() => open(row)}
                onFocus={() => setSelectedUid(row.uid)}
                title={row.resourceUri}
              >
                <span>
                  <code>{row.code}</code> {row.title}
                </span>
                <span className="d2d-search-snippet">{row.snippet}</span>
              </button>
            ))}
        </section>
      ))}
      {response.results.length === 0 && <div className="d2d-empty">該当するResourceはありません。</div>}
    </div>
  )
}

export function SearchSideBar(): React.JSX.Element {
  const project = useProjectStore((state) => state.project)
  const { query, entityType, useMecab, loading, response, error, setQuery, setEntityType, setUseMecab, run } =
    useSearchStore()
  if (!project) return <div className="d2d-empty">検索するプロジェクトを開いてください。</div>
  return (
    <div className="d2d-search-sidebar" data-testid="search-sidebar">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void run()
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="タイトル、本文、code、uidを検索"
          data-testid="search-input"
        />
      </form>
      <select
        value={entityType}
        onChange={(event) => setEntityType(event.target.value)}
        data-testid="search-entity-type"
      >
        <option value="">すべてのResource</option>
        {ENTITY_TYPES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <label className="d2d-search-mecab">
        <input
          type="checkbox"
          checked={useMecab}
          onChange={(event) => setUseMecab(event.target.checked)}
          data-testid="search-use-mecab"
        />
        MeCab検索を使用
      </label>
      <p className="d2d-search-note" data-testid="search-mecab-note">
        MeCab検索は索引の形態素解析を行うため、全文検索より時間がかかる場合があります。
      </p>
      <button type="button" className="d2d-btn primary" disabled={loading || !query.trim()} onClick={() => void run()}>
        {loading ? '検索中…' : '検索'}
      </button>
      {error && <div className="d2d-error">{error}</div>}
      {response && (
        <>
          <div className="d2d-search-summary">
            {response.results.length}件 / 索引{response.indexCount}件 /{' '}
            {response.tokenizer === 'mecab' ? 'MeCab検索' : '全文検索'}
          </div>
          <SearchResultsTree response={response} />
        </>
      )}
    </div>
  )
}
