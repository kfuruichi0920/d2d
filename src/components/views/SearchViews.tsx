import { useEffect, useState } from 'react'
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
  loading: boolean
  response: SearchResponse | null
  error: string | null
  setQuery(query: string): void
  setEntityType(entityType: string): void
  run(): Promise<void>
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  entityType: '',
  loading: false,
  response: null,
  error: null,
  setQuery: (query) => set({ query }),
  setEntityType: (entityType) => set({ entityType }),
  run: async () => {
    const { query, entityType } = get()
    if (!query.trim()) return
    set({ loading: true, error: null })
    const result = await invoke<SearchResponse>('search.elements', {
      query,
      entityType: entityType || undefined,
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
  ['glossary', '用語'],
  ['design_element', '設計要素'],
  ['trace_link', 'トレース']
]

export function SearchSideBar(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const { query, entityType, loading, response, error, setQuery, setEntityType, run } = useSearchStore()
  const [showSettings, setShowSettings] = useState(false)
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
      <button type="button" className="d2d-btn primary" disabled={loading || !query.trim()} onClick={() => void run()}>
        {loading ? '検索中…' : '検索'}
      </button>
      {error && <div className="d2d-error">{error}</div>}
      {response && (
        <div style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>
          {response.results.length}件 / 索引{response.indexCount}件 /{' '}
          {response.tokenizer === 'mecab' ? 'MeCab' : 'Unicode fallback'}
        </div>
      )}
      <button type="button" className="d2d-btn small" onClick={() => setShowSettings(!showSettings)}>
        検索エンジン設定
      </button>
      {showSettings && <SearchSettings />}
    </div>
  )
}

function SearchSettings(): React.JSX.Element {
  const [mecabPath, setMecabPath] = useState('')
  const [dictionaryPath, setDictionaryPath] = useState('')
  const [userDictionaries, setUserDictionaries] = useState('')
  const [message, setMessage] = useState('')
  useEffect(() => {
    void invoke<Record<string, unknown>>('settings.getProjectSettings').then((r) => {
      if (!r.ok) return
      setMecabPath(String(r.result['search.mecabPath'] ?? ''))
      setDictionaryPath(String(r.result['search.dictionaryPath'] ?? ''))
      const paths = r.result['search.userDictionaryPaths']
      setUserDictionaries(Array.isArray(paths) ? paths.join('\n') : '')
    })
  }, [])
  const save = async (): Promise<void> => {
    const values: [string, unknown][] = [
      ['search.mecabPath', mecabPath],
      ['search.dictionaryPath', dictionaryPath],
      [
        'search.userDictionaryPaths',
        userDictionaries
          .split(/\r?\n/)
          .map((x) => x.trim())
          .filter(Boolean)
      ]
    ]
    for (const [key, value] of values) {
      const r = await invoke('settings.setProjectSetting', { key, value })
      if (!r.ok) {
        setMessage(r.error.message)
        return
      }
    }
    const rebuilt = await invoke<{ count: number; tokenizer: string; warning?: string }>('search.rebuildIndex')
    setMessage(
      rebuilt.ok
        ? `索引${rebuilt.result.count}件を再構築（${rebuilt.result.tokenizer}）${rebuilt.result.warning ? `: ${rebuilt.result.warning}` : ''}`
        : rebuilt.error.message
    )
  }
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        borderTop: '1px solid var(--d2d-border)',
        paddingTop: 8
      }}
    >
      <label>
        MeCab実行ファイル
        <input
          value={mecabPath}
          onChange={(e) => setMecabPath(e.target.value)}
          placeholder="C:\\Program Files\\MeCab\\bin\\mecab.exe"
        />
      </label>
      <label>
        UniDicディレクトリ
        <input
          value={dictionaryPath}
          onChange={(e) => setDictionaryPath(e.target.value)}
          placeholder="...\\dic\\unidic"
        />
      </label>
      <label>
        ユーザ辞書（1行1ファイル）
        <textarea rows={3} value={userDictionaries} onChange={(e) => setUserDictionaries(e.target.value)} />
      </label>
      <button type="button" className="d2d-btn" onClick={() => void save()}>
        保存して索引再構築
      </button>
      {message && <small>{message}</small>}
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
