/**
 * ④設計モデルのツリー・要素ビューア（P8-6、V-04、UI-013）。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'

export interface DesignElementRow {
  uid: string
  code: string
  design_category: string
  title: string | null
  status: string
  description: string | null
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

/** Explorer の④設計モデルツリー */
export function DesignModelTree(): React.JSX.Element {
  const [elements, setElements] = useState<DesignElementRow[]>([])
  const openResource = useEditorStore((s) => s.openResource)

  const refresh = useCallback(async () => {
    const res = await invoke<DesignElementRow[]>('design.listElements')
    if (res.ok) setElements(res.result)
  }, [])

  useEffect(() => {
    void refresh()
    return onBackendEvent((event) => {
      if (['design_model.updated', 'relation.updated'].includes(event)) void refresh()
    })
  }, [refresh])

  return (
    <div data-testid="design-tree">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 4px 2px' }}>
        <span style={{ fontWeight: 700 }}>④設計モデル</span>
        <span style={{ color: 'var(--d2d-fg-muted)' }}>{elements.length}</span>
      </div>
      {elements.map((element) => (
        <div
          key={element.uid}
          className="d2d-list-row"
          data-testid={`design-el-${element.code}`}
          onClick={() => openResource(`design://${element.uid}`, element.code, { preview: true })}
        >
          <span className="d2d-badge status-running">{element.design_category}</span>
          <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{element.code}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{element.title}</span>
        </div>
      ))}
    </div>
  )
}

/** 設計要素ビューア（design://<uid>）: 属性 + 関係一覧 */
export function DesignElementViewer({ uid }: { uid: string }): React.JSX.Element {
  const [element, setElement] = useState<DesignElementRow | null>(null)
  const [relations, setRelations] = useState<TraceLinkRow[]>([])
  const openResource = useEditorStore((s) => s.openResource)

  useEffect(() => {
    void (async () => {
      const [elementsRes, relationsRes] = await Promise.all([
        invoke<DesignElementRow[]>('design.listElements'),
        invoke<TraceLinkRow[]>('design.listRelations', { uid })
      ])
      if (elementsRes.ok) setElement(elementsRes.result.find((e) => e.uid === uid) ?? null)
      if (relationsRes.ok) setRelations(relationsRes.result)
    })()
  }, [uid])

  if (!element) return <div className="d2d-empty">読込中…</div>

  return (
    <div style={{ padding: 16 }} data-testid="design-element-viewer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="d2d-badge status-running">{element.design_category}</span>
        <h1 style={{ fontSize: 15, margin: 0 }}>
          {element.code} — {element.title}
        </h1>
        <ReviewStatusBadge status={reviewStateFromEntityStatus(element.status)} />
      </div>
      {element.description && <p style={{ whiteSpace: 'pre-wrap' }}>{element.description}</p>}

      <h2 style={{ fontSize: 13, marginTop: 16 }}>関係（{relations.length}）</h2>
      {relations.length === 0 ? (
        <div className="d2d-empty">関係はまだありません</div>
      ) : (
        relations.map((link) => {
          const outgoing = link.from_uid === uid
          const otherUid = outgoing ? link.to_uid : link.from_uid
          const otherLabel = outgoing
            ? `${link.to_code} ${link.to_title ?? ''}`
            : `${link.from_code} ${link.from_title ?? ''}`
          return (
            <div
              key={link.uid}
              className="d2d-list-row"
              onClick={() => openResource(`design://${otherUid}`, otherLabel, { preview: true })}
            >
              <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{outgoing ? '→' : '←'}</span>
              <span className="d2d-badge review-candidate">{link.relation_type}</span>
              <span style={{ flex: 1 }}>{otherLabel}</span>
              {link.rationale && <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{link.rationale}</span>}
            </div>
          )
        })
      )}
    </div>
  )
}
