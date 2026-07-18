/**
 * Workbench共通Secondary Side Bar（P3-9、UI-026/040、sdd_ui_design §11）。
 * Properties／Relations／Reviewを現在のSelectionへ同期する。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useSelectionStore, type SelectedItem } from '../../stores/selection-store'
import { useWorkbenchStore, type SecondaryTab } from '../../stores/workbench-store'

const SECTIONS: { id: SecondaryTab; label: string }[] = [
  { id: 'properties', label: 'Properties' },
  { id: 'relations', label: 'Relations' },
  { id: 'review', label: 'Review' },
  { id: 'dictionary', label: 'Dictionary' }
]

interface RelationRow {
  uid: string
  code: string
  relation_type: string
  link_direction: 'forward' | 'bidirectional'
  relative_direction: 'outgoing' | 'incoming' | 'bidirectional'
  other_uid: string
  other_code: string
  other_title: string | null
  other_entity_type: string
  open_uri: string | null
  rationale: string | null
}

interface ReviewRow {
  uid: string
  code: string
  body: string
  created_at: string
  created_by: string | null
}

function fallbackSelection(activeUri: string | null): SelectedItem | null {
  if (!activeUri) return null
  const match = /^(design|resource|original|extracted|intermediate|chunk):\/\/(.+)$/.exec(activeUri)
  if (!match?.[2]) return null
  return {
    contextUri: activeUri,
    uid: match[2],
    displayId: match[2],
    entityType: match[1] === 'original' ? 'source_document' : (match[1] ?? 'resource'),
    properties: { resource: activeUri }
  }
}

export function SecondarySideBar(): React.JSX.Element {
  const activeSection = useWorkbenchStore((state) => state.secondaryTab)
  const expanded = useWorkbenchStore((state) => state.secondaryExpanded)
  const toggleSection = useWorkbenchStore((state) => state.toggleSecondarySection)
  const activeUri = useEditorStore((state) => state.activeUri)
  const selectedItem = useSelectionStore((state) => state.selectedItem)
  const openResource = useEditorStore((state) => state.openResource)
  const target = useMemo(
    () => (selectedItem?.contextUri === activeUri ? selectedItem : fallbackSelection(activeUri)),
    [activeUri, selectedItem]
  )

  return (
    <aside className="wb-secondary" data-testid="secondary-sidebar">
      <div className="wb-secondary-accordions">
        {[...SECTIONS]
          .sort((a, b) => Number(expanded.includes(b.id)) - Number(expanded.includes(a.id)))
          .map((section) => {
            const open = expanded.includes(section.id)
            return (
              <section
                key={section.id}
                className={'wb-secondary-accordion ' + (activeSection === section.id ? 'active' : '')}
                data-testid={'secondary-accordion-' + section.id}
              >
                <button
                  type="button"
                  className="wb-secondary-accordion-header"
                  aria-expanded={open}
                  onClick={() => toggleSection(section.id)}
                  data-testid={'secondary-tab-' + section.id}
                >
                  <span>{open ? '▾' : '▸'}</span>
                  {section.label}
                </button>
                {open && (
                  <div className="wb-secondary-accordion-body">
                    {section.id === 'properties' && <PropertiesContent target={target} />}
                    {section.id === 'relations' && <RelationsContent target={target} openResource={openResource} />}
                    {section.id === 'review' && <ReviewContent target={target} />}
                    {section.id === 'dictionary' && <DictionaryContent openResource={openResource} />}
                  </div>
                )}
              </section>
            )
          })}
      </div>
    </aside>
  )
}

function PropertiesContent({ target }: { target: SelectedItem | null }): React.JSX.Element {
  if (!target) return <div className="d2d-empty">アイテムが選択されていません</div>
  return (
    <dl className="d2d-kv" data-testid="selected-item-properties">
      <dt>ID</dt>
      <dd>{target.displayId}</dd>
      <dt>UID</dt>
      <dd>{target.uid}</dd>
      <dt>entity_type</dt>
      <dd>{target.entityType}</dd>
      {target.itemType && (
        <>
          <dt>種別</dt>
          <dd>{target.itemType}</dd>
        </>
      )}
      {target.title && (
        <>
          <dt>名称</dt>
          <dd>{target.title}</dd>
        </>
      )}
      {target.status && (
        <>
          <dt>状態</dt>
          <dd>{target.status}</dd>
        </>
      )}
      {Object.entries(target.properties).map(([key, value]) => (
        <div className="d2d-kv-pair" key={key}>
          <dt>{key}</dt>
          <dd>{value === null || value === undefined || value === '' ? '—' : String(value)}</dd>
        </div>
      ))}
    </dl>
  )
}

function RelationsContent({
  target,
  openResource
}: {
  target: SelectedItem | null
  openResource: (uri: string, title: string) => void
}): React.JSX.Element {
  const [relations, setRelations] = useState<RelationRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    if (!target) {
      setRelations([])
      setError(null)
      return
    }
    const result = await invoke<RelationRow[]>('secondary.listRelations', { itemUid: target.uid })
    if (result.ok) {
      setRelations(result.result)
      setError(null)
    } else {
      setRelations([])
      setError(result.error.message)
    }
  }, [target])
  useEffect(() => {
    void load()
    return onBackendEvent((event, payload) => {
      if (event === 'secondary.updated' && (payload as { itemUid?: string }).itemUid === target?.uid) void load()
    })
  }, [load, target?.uid])

  if (!target) return <div className="d2d-empty">アイテムが選択されていません</div>
  if (error) return <div className="d2d-empty">{error}</div>
  if (relations.length === 0) return <div className="d2d-empty">関係はありません</div>
  return (
    <ul className="secondary-relation-list" data-testid="secondary-relations-list">
      {relations.map((relation) => (
        <li
          key={relation.uid}
          role={relation.open_uri ? 'button' : undefined}
          tabIndex={relation.open_uri ? 0 : undefined}
          onClick={() =>
            relation.open_uri && openResource(relation.open_uri, relation.other_title ?? relation.other_code)
          }
          onKeyDown={(event) => {
            if (relation.open_uri && (event.key === 'Enter' || event.key === ' '))
              openResource(relation.open_uri, relation.other_title ?? relation.other_code)
          }}
        >
          <div>
            <span className="d2d-badge">{relation.relation_type}</span>{' '}
            <b>
              {relation.relative_direction === 'outgoing'
                ? '出力 →'
                : relation.relative_direction === 'incoming'
                  ? '入力 ←'
                  : '双方向 ↔'}
            </b>
          </div>
          <div>
            {relation.other_code} — {relation.other_title ?? '名称なし'}
          </div>
          <small>
            {relation.other_entity_type} / link: {relation.link_direction}
          </small>
          {relation.rationale && <p>{relation.rationale}</p>}
        </li>
      ))}
    </ul>
  )
}

function ReviewContent({ target }: { target: SelectedItem | null }): React.JSX.Element {
  const [comments, setComments] = useState<ReviewRow[]>([])
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const notify = useJobsStore((state) => state.notify)
  const load = useCallback(async () => {
    if (!target) {
      setComments([])
      return
    }
    const result = await invoke<ReviewRow[]>('secondary.listReviews', { itemUid: target.uid })
    if (result.ok) setComments(result.result)
  }, [target])
  useEffect(() => {
    setDraft('')
    void load()
  }, [load])

  const save = async (): Promise<void> => {
    if (!target || !draft.trim()) return
    setSaving(true)
    const result = await invoke<ReviewRow>('secondary.addReview', { itemUid: target.uid, comment: draft })
    setSaving(false)
    if (!result.ok) {
      notify('error', 'レビューコメントを保存できませんでした', result.error.message)
      return
    }
    setDraft('')
    notify('info', 'レビューコメントを保存しました')
    await load()
  }

  if (!target) return <div className="d2d-empty">アイテムが選択されていません</div>
  return (
    <div className="secondary-review" data-testid="secondary-review">
      <label htmlFor="secondary-review-comment">{target.displayId} へのコメント</label>
      <textarea
        id="secondary-review-comment"
        data-testid="secondary-review-comment"
        value={draft}
        maxLength={10_000}
        onChange={(event) => setDraft(event.target.value)}
      />
      <button
        type="button"
        className="d2d-btn primary"
        data-testid="secondary-review-save"
        disabled={saving || !draft.trim()}
        onClick={() => void save()}
      >
        {saving ? '保存中…' : 'コメントを保存'}
      </button>
      <div className="secondary-review-list" data-testid="secondary-review-list">
        {comments.length === 0 ? (
          <div className="d2d-empty">コメントはありません</div>
        ) : (
          comments.map((comment) => (
            <article key={comment.uid}>
              <header>
                {comment.code} / {new Date(comment.created_at).toLocaleString()}
              </header>
              <p>{comment.body}</p>
            </article>
          ))
        )}
      </div>
    </div>
  )
}

interface DictionaryCandidate {
  uid: string
  code: string
  title: string
  definition: string | null
  category: string | null
}
function DictionaryContent({
  openResource
}: {
  openResource: (uri: string, title: string) => void
}): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DictionaryCandidate[]>([])
  const [tooBroad, setTooBroad] = useState(false)
  const [saving, setSaving] = useState(false)
  const notify = useJobsStore((state) => state.notify)
  useEffect(() => {
    let active = true
    const timer = window.setTimeout(async () => {
      if (!query.trim()) {
        setResults([])
        setTooBroad(false)
        return
      }
      const result = await invoke<{ tooBroad: boolean; groups: { glossary: DictionaryCandidate[] } }>(
        'semantic.search',
        {
          prefix: query,
          policy: { candidateKinds: ['glossary'], minimumPrefixLength: 1, maximumCandidates: 50 }
        }
      )
      if (active && result.ok) {
        setResults(result.result.groups.glossary)
        setTooBroad(result.result.tooBroad)
      }
    }, 120)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [query])
  const register = async (): Promise<void> => {
    if (!query.trim()) return
    setSaving(true)
    const result = await invoke<{ uid: string }>('glossary.addTerm', { term: query.trim() })
    setSaving(false)
    if (!result.ok) return notify('error', '辞書候補を登録できません', result.error.message)
    notify('info', `「${query.trim()}」を承認待ちの辞書候補として登録しました`)
    setQuery('')
  }
  return (
    <div className="secondary-dictionary" data-testid="secondary-dictionary">
      <label htmlFor="secondary-dictionary-query">辞書の前方一致検索</label>
      <input
        id="secondary-dictionary-query"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="用語を入力"
        data-testid="secondary-dictionary-query"
      />
      {tooBroad && <small>検索語を追加してください</small>}
      <ul>
        {results.map((term) => (
          <li key={term.uid}>
            <button
              type="button"
              title={`${term.code}\n${term.definition ?? ''}`}
              onClick={() => openResource('glossary://workspace', term.title)}
            >
              <b>{term.title}</b>
              <small>
                {term.code} / {term.category ?? '未分類'}
              </small>
              {term.definition && <span>{term.definition}</span>}
            </button>
          </li>
        ))}
      </ul>
      {query.trim() && !tooBroad && results.length === 0 && (
        <button
          type="button"
          className="d2d-btn primary"
          disabled={saving}
          onClick={() => void register()}
          data-testid="secondary-dictionary-register"
        >
          {saving ? '登録中…' : `「${query.trim()}」を辞書候補に登録`}
        </button>
      )}
    </div>
  )
}
