/** ④設計モデルのツリーと定義駆動型model_*編集画面（P8-6 / MODEL-001〜028）。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SerendieSymbolCube, SerendieSymbolFolderFilled } from '@serendie/symbols'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useSelectionStore } from '../../stores/selection-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { StateMachineEditor } from '../editors/StateMachineEditor'

export interface DesignElementRow {
  uid: string
  code: string
  model_type: string
  model_label: string
  layer: string
  title: string | null
  status: string
  summary: string
  detail_json: string
  entity_type: string
  owner_uid?: string | null
  created_at?: string
  updated_at?: string
}
interface TraceLinkRow {
  uid: string
  code: string
  from_uid: string
  to_uid: string
  relation_type: string
  rationale: string | null
  from_title: string | null
  from_code: string
  to_title: string | null
  to_code: string
}
interface FieldDefinition {
  key: string
  label: string
  type: 'text' | 'multiline' | 'json' | 'select'
  description: string
  options?: string[]
  is_enabled?: number
}
interface ModelDefinition {
  model_type: string
  label: string
  layer: string
  definition: string
  field_schema_json: string
  is_enabled: number
}
interface OntologySnapshot {
  version: string
  models: ModelDefinition[]
}

export function DesignModelTree(): React.JSX.Element {
  const [elements, setElements] = useState<DesignElementRow[]>([])
  const openResource = useEditorStore((s) => s.openResource)
  const refresh = useCallback(async () => {
    const r = await invoke<DesignElementRow[]>('design.listElements')
    if (r.ok) setElements(r.result)
  }, [])
  useEffect(() => {
    void refresh()
    return onBackendEvent((event) => {
      if (['design_model.updated', 'relation.updated', 'ontology.updated'].includes(event)) void refresh()
    })
  }, [refresh])
  const groups = useMemo(() => {
    const map = new Map<string, DesignElementRow[]>()
    for (const e of elements) {
      const key = `${e.layer} / ${e.model_label}`
      ;(map.get(key) ?? map.set(key, []).get(key)!).push(e)
    }
    return [...map]
  }, [elements])
  return (
    <details open className="d2d-explorer-section" data-testid="design-tree">
      <summary className="d2d-explorer-section-header" role="treeitem" tabIndex={-1} data-explorer-treeitem>
        <SerendieSymbolFolderFilled width={16} height={16} className="d2d-explorer-folder-icon" />
        <span className="d2d-explorer-section-title">④設計モデル</span>
        <span className="d2d-explorer-section-count">{elements.length}</span>
      </summary>
      {groups.map(([group, rows]) => (
        <details open key={group}>
          <summary style={{ paddingLeft: 12, fontSize: 11, color: 'var(--d2d-fg-muted)' }}>
            {group} ({rows.length})
          </summary>
          {rows.map((e) => (
            <div
              key={e.uid}
              className="d2d-list-row"
              role="treeitem"
              tabIndex={-1}
              data-explorer-treeitem
              data-testid={`design-el-${e.code}`}
              title={`${e.model_type}\n${e.summary}`}
              onClick={() => openResource(`design://${e.uid}`, e.code, { preview: true })}
            >
              <SerendieSymbolCube width={15} height={15} className="d2d-explorer-resource-icon is-design" />
              <span className="d2d-explorer-resource-name">
                <span className="d2d-explorer-resource-code">{e.code}</span>
                {e.title}
              </span>
              <span className="d2d-explorer-tags">
                <span className="d2d-badge status-running">{e.model_label}</span>
                <ReviewStatusBadge status={reviewStateFromEntityStatus(e.status)} />
              </span>
            </div>
          ))}
        </details>
      ))}
    </details>
  )
}

export function DesignElementViewer({ uid }: { uid: string }): React.JSX.Element {
  const [element, setElement] = useState<DesignElementRow | null>(null),
    [relations, setRelations] = useState<TraceLinkRow[]>([]),
    [definition, setDefinition] = useState<ModelDefinition | null>(null)
  const [title, setTitle] = useState(''),
    [summary, setSummary] = useState(''),
    [detail, setDetail] = useState<Record<string, unknown>>({}),
    [status, setStatus] = useState('draft')
  const openResource = useEditorStore((s) => s.openResource),
    notify = useJobsStore((s) => s.notify),
    setSelectedItem = useSelectionStore((s) => s.setSelectedItem),
    clearSelectedItem = useSelectionStore((s) => s.clearSelectedItem)
  const load = useCallback(async () => {
    const [er, rr, or] = await Promise.all([
      invoke<DesignElementRow[]>('design.listElements'),
      invoke<TraceLinkRow[]>('design.listRelations', { uid }),
      invoke<OntologySnapshot>('ontology.get')
    ])
    if (er.ok) {
      const e = er.result.find((x) => x.uid === uid) ?? null
      setElement(e)
      if (e) {
        setTitle(e.title ?? '')
        setSummary(e.summary)
        setStatus(e.status)
        try {
          setDetail(JSON.parse(e.detail_json) as Record<string, unknown>)
        } catch {
          setDetail({})
        }
        if (or.ok) setDefinition(or.result.models.find((m) => m.model_type === e.model_type) ?? null)
      }
    }
    if (rr.ok) setRelations(rr.result)
  }, [uid])
  useEffect(() => {
    void load()
    return onBackendEvent((event) => {
      if (['design_model.updated', 'relation.updated', 'ontology.updated'].includes(event)) void load()
    })
  }, [load])
  useEffect(() => {
    if (element)
      setSelectedItem({
        contextUri: `design://${uid}`,
        uid: element.uid,
        displayId: element.code,
        entityType: element.entity_type,
        itemType: element.model_type,
        title: element.title,
        status: element.status,
        properties: { modelType: element.model_type, summary: element.summary, detail: element.detail_json }
      })
  }, [detail, element, setSelectedItem, uid])
  useEffect(() => () => clearSelectedItem(`design://${uid}`), [clearSelectedItem, uid])
  if (!element) return <div className="d2d-empty">読込中…</div>
  let fields: FieldDefinition[] = []
  try {
    fields = definition
      ? (JSON.parse(definition.field_schema_json) as FieldDefinition[]).filter((field) => field.is_enabled !== 0)
      : []
  } catch {
    fields = []
  }
  const save = async (): Promise<void> => {
    const r = await invoke('design.updateElement', { uid, title, summary, detail, status })
    if (r.ok) {
      notify('info', `${element.code} を保存しました`)
      await load()
    } else notify('error', '設計モデルを保存できませんでした', r.error.message)
  }
  return (
    <div style={{ padding: 16, maxWidth: 900 }} data-testid="design-element-viewer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="d2d-badge status-running">{element.model_label}</span>
        <h1 style={{ fontSize: 15, margin: 0 }}>
          {element.code} — {element.model_type}
        </h1>
        <ReviewStatusBadge status={reviewStateFromEntityStatus(element.status)} />
        {['model_req', 'model_cst', 'model_func'].includes(element.model_type) && (
          <button
            type="button"
            className="d2d-btn small"
            data-testid="create-verification"
            onClick={() =>
              void invoke('design.createVerification', { targetUid: uid }).then((r) => {
                if (r.ok) void load()
              })
            }
          >
            +検証項目
          </button>
        )}
      </div>
      {definition && (
        <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 12 }}>
          {definition.layer}：{definition.definition}
        </p>
      )}
      {element.model_type === 'model_state' && <StateMachineEditor uid={uid} />}
      <section style={{ border: '1px solid var(--d2d-border)', padding: 12, borderRadius: 4 }}>
        <h2 style={{ fontSize: 13 }}>共通部</h2>
        <Field label="タイトル">
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <Field label="概要">
          <textarea value={summary} onChange={(e) => setSummary(e.target.value)} style={{ minHeight: 70 }} />
        </Field>
        <Field label="状態">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            {['draft', 'review', 'approved', 'rejected'].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <h2 style={{ fontSize: 13, marginTop: 16 }}>{element.model_label} 固有情報</h2>
        {fields.map((field) => (
          <Field key={field.key} label={field.label} description={field.description}>
            {field.type === 'select' ? (
              <select
                data-testid={`design-field-${field.key}`}
                value={String(detail[field.key] ?? '')}
                onChange={(e) => setDetail((v) => ({ ...v, [field.key]: e.target.value }))}
              >
                <option value="">未設定</option>
                {field.options?.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            ) : field.type === 'multiline' || field.type === 'json' ? (
              <textarea
                data-testid={`design-field-${field.key}`}
                value={
                  field.type === 'json' && typeof detail[field.key] !== 'string'
                    ? JSON.stringify(detail[field.key] ?? {}, null, 2)
                    : String(detail[field.key] ?? '')
                }
                onChange={(e) => {
                  let value: unknown = e.target.value
                  if (field.type === 'json') {
                    try {
                      value = JSON.parse(e.target.value)
                    } catch {
                      value = e.target.value
                    }
                  }
                  setDetail((v) => ({ ...v, [field.key]: value }))
                }}
                style={{
                  minHeight: field.type === 'json' ? 100 : 70,
                  fontFamily: field.type === 'json' ? 'monospace' : undefined
                }}
              />
            ) : (
              <input
                data-testid={`design-field-${field.key}`}
                value={String(detail[field.key] ?? '')}
                onChange={(e) => setDetail((v) => ({ ...v, [field.key]: e.target.value }))}
              />
            )}
          </Field>
        ))}
        <button type="button" className="d2d-btn primary" onClick={() => void save()} data-testid="design-model-save">
          保存
        </button>
      </section>
      <h2 style={{ fontSize: 13, marginTop: 16 }}>関係（{relations.length}）</h2>
      {relations.length === 0 ? (
        <div className="d2d-empty">関係はまだありません</div>
      ) : (
        relations.map((link) => {
          const outgoing = link.from_uid === uid,
            otherUid = outgoing ? link.to_uid : link.from_uid,
            otherLabel = outgoing
              ? `${link.to_code} ${link.to_title ?? ''}`
              : `${link.from_code} ${link.from_title ?? ''}`
          return (
            <div
              key={link.uid}
              className="d2d-list-row"
              onClick={() => openResource(`design://${otherUid}`, otherLabel, { preview: true })}
            >
              <span>{outgoing ? '→' : '←'}</span>
              <span className="d2d-badge review-candidate">{link.relation_type}</span>
              <span style={{ flex: 1 }}>{otherLabel}</span>
            </div>
          )
        })
      )}
    </div>
  )
}
function Field({
  label,
  description,
  children
}: {
  label: string
  description?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <label
      style={{
        display: 'grid',
        gridTemplateColumns: '150px minmax(220px,1fr)',
        gap: 8,
        margin: '7px 0',
        alignItems: 'start'
      }}
    >
      <span style={{ fontSize: 12 }}>
        {label}
        {description && <small style={{ display: 'block', color: 'var(--d2d-fg-muted)' }}>{description}</small>}
      </span>
      {children}
    </label>
  )
}
