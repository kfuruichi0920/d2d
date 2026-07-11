import { create } from 'zustand'
import { invoke } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useProjectStore } from '../../stores/project-store'
import { useWorkbenchStore } from '../../stores/workbench-store'

export interface SearchResultRow {
  uid: string
  entityType: string
  code: string
  title: string
  snippet: string
  score: number
  resourceUri: string
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
    if (result.ok) {
      set({ loading: false, response: result.result })
      useWorkbenchStore.getState().openPanel('search')
    } else set({ loading: false, error: result.error.message })
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

export function SearchSideBar(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const { query, entityType, useMecab, loading, response, error, setQuery, setEntityType, setUseMecab, run } =
    useSearchStore()
  if (!project) return <div className="d2d-empty">検索するプロジェクトを開いてください。</div>
  return (
    <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="search-sidebar">
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="タイトル、本文、code、uidを検索"
          style={{ width: '100%', boxSizing: 'border-box' }}
          data-testid="search-input"
        />
      </form>
      <select value={entityType} onChange={(e) => setEntityType(e.target.value)} data-testid="search-entity-type">
        <option value="">すべてのResource</option>
        {ENTITY_TYPES.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="checkbox"
          checked={useMecab}
          onChange={(e) => setUseMecab(e.target.checked)}
          data-testid="search-use-mecab"
        />
        MeCab検索を使用
      </label>
      <button type="button" className="d2d-btn primary" disabled={loading || !query.trim()} onClick={() => void run()}>
        {loading ? '検索中…' : '検索'}
      </button>
      {error && <div className="d2d-error">{error}</div>}
      {response && (
        <div style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>
          {response.results.length}件 / 索引{response.indexCount}件 /{' '}
          {response.tokenizer === 'mecab' ? 'MeCab' : 'Unicode検索'}
        </div>
      )}
    </div>
  )
}

export function SearchResultsPanel(): React.JSX.Element {
  const response = useSearchStore((s) => s.response)
  const openResource = useEditorStore((s) => s.openResource)
  if (!response) return <div className="d2d-empty">検索条件を入力してください。</div>
  if (response.results.length === 0) return <div className="d2d-empty">該当するResourceはありません。</div>
  return (
    <div data-testid="search-results">
      {response.warning && <div style={{ padding: '6px 10px', color: 'var(--d2d-warning)' }}>{response.warning}</div>}
      {response.results.map((row) => (
        <div
          key={row.uid}
          className="d2d-list-row"
          data-testid={`search-result-${row.code}`}
          onClick={() => openResource(row.resourceUri, `${row.code}: ${row.title}`, { preview: true })}
        >
          <span className="d2d-badge status-running">{row.entityType}</span>
          <code>{row.code}</code>
          <span style={{ fontWeight: 600 }}>{row.title}</span>
          <span style={{ color: 'var(--d2d-fg-muted)' }}>{row.snippet}</span>
        </div>
      ))}
    </div>
  )
}
