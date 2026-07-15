/**
 * ④設計モデルのツリー・要素ビューア（P8-6、V-04、UI-013）。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { StateMachineEditor } from '../editors/StateMachineEditor'

export interface DesignElementRow {
  uid: string
  code: string
  design_category: string
  title: string | null
  status: string
  description: string | null
  entity_type: string
  verification_json: string | null
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
    <details open className="d2d-explorer-section" data-testid="design-tree">
      <summary className="d2d-explorer-section-header">
        <span className="d2d-explorer-section-title">④設計モデル</span>
        <span className="d2d-explorer-section-count">{elements.length}</span>
      </summary>
      {elements.map((element) => (
        <div
          key={element.uid}
          className="d2d-list-row"
          data-testid={`design-el-${element.code}`}
          title={`名称: ${element.title ?? element.code}\nID: ${element.code}\n分類: ${element.design_category}\n種別: ${element.entity_type}\n状態: ${element.status}${element.description ? `\n説明: ${element.description}` : ''}`}
          onClick={() => openResource(`design://${element.uid}`, element.code, { preview: true })}
        >
          <span className="d2d-badge status-running">{element.design_category}</span>
          <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{element.code}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{element.title}</span>
        </div>
      ))}
    </details>
  )
}

/** 設計要素ビューア（design://<uid>）: 属性 + 関係一覧。STATE 機械は専用エディタへ */
export function DesignElementViewer({ uid }: { uid: string }): React.JSX.Element {
  const [element, setElement] = useState<DesignElementRow | null>(null)
  const [relations, setRelations] = useState<TraceLinkRow[]>([])
  const openResource = useEditorStore((s) => s.openResource)

  const load = useCallback(async () => {
    const [elementsRes, relationsRes] = await Promise.all([
      invoke<DesignElementRow[]>('design.listElements'),
      invoke<TraceLinkRow[]>('design.listRelations', { uid })
    ])
    if (elementsRes.ok) setElement(elementsRes.result.find((e) => e.uid === uid) ?? null)
    if (relationsRes.ok) setRelations(relationsRes.result)
  }, [uid])

  useEffect(() => {
    void load()
  }, [load])

  if (!element) return <div className="d2d-empty">読込中…</div>

  // 状態遷移リソースは専用エディタで開く（P10-4）
  if (element.entity_type === 'resource_state_transition') {
    return <StateMachineEditor uid={uid} />
  }

  return (
    <div style={{ padding: 16 }} data-testid="design-element-viewer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span className="d2d-badge status-running">{element.design_category}</span>
        <h1 style={{ fontSize: 15, margin: 0 }}>
          {element.code} — {element.title}
        </h1>
        <ReviewStatusBadge status={reviewStateFromEntityStatus(element.status)} />
        {['REQ', 'CST', 'FUNC'].includes(element.design_category) && (
          <button
            type="button"
            className="d2d-btn small"
            title="検証項目を作成して verifies で紐づける（EDIT-040/041）"
            data-testid="create-verification"
            onClick={() =>
              void invoke('design.createVerification', { targetUid: uid }).then((res) => {
                if (res.ok) void load()
              })
            }
          >
            +検証項目
          </button>
        )}
      </div>
      {element.description && <p style={{ whiteSpace: 'pre-wrap' }}>{element.description}</p>}

      {element.design_category === 'VERIF' && <VerificationDetailForm element={element} onSaved={load} />}

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

/** VERIF 要素の検証条件・手順・期待結果の編集（P10-5、EDIT-042） */
function VerificationDetailForm({
  element,
  onSaved
}: {
  element: DesignElementRow
  onSaved: () => Promise<void>
}): React.JSX.Element {
  const initial = element.verification_json
    ? (JSON.parse(element.verification_json) as { condition?: string; procedure?: string; expected?: string })
    : {}
  const [condition, setCondition] = useState(initial.condition ?? '')
  const [procedure, setProcedure] = useState(initial.procedure ?? '')
  const [expected, setExpected] = useState(initial.expected ?? '')
  const notify = useJobsStore((s) => s.notify)

  const save = async (): Promise<void> => {
    const res = await invoke('design.setVerificationDetail', { uid: element.uid, condition, procedure, expected })
    if (res.ok) {
      notify('info', '検証詳細を保存しました')
      await onSaved()
    } else {
      notify('error', '保存できませんでした', res.error.message)
    }
  }

  const fieldStyle: React.CSSProperties = { display: 'flex', gap: 8, margin: '4px 0', alignItems: 'flex-start' }
  const labelStyle: React.CSSProperties = { width: 80, color: 'var(--d2d-fg-muted)', fontSize: 12 }

  return (
    <div
      style={{ border: '1px solid var(--d2d-border)', borderRadius: 'var(--d2d-radius)', padding: 10, margin: '8px 0' }}
      data-testid="verification-form"
    >
      <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>検証詳細（EDIT-042）</div>
      <div style={fieldStyle}>
        <label style={labelStyle}>検証条件</label>
        <input
          style={{ flex: 1 }}
          value={condition}
          onChange={(e) => setCondition(e.target.value)}
          data-testid="verif-condition"
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>手順</label>
        <textarea
          style={{ flex: 1, minHeight: 40 }}
          value={procedure}
          onChange={(e) => setProcedure(e.target.value)}
          data-testid="verif-procedure"
        />
      </div>
      <div style={fieldStyle}>
        <label style={labelStyle}>期待結果</label>
        <input
          style={{ flex: 1 }}
          value={expected}
          onChange={(e) => setExpected(e.target.value)}
          data-testid="verif-expected"
        />
      </div>
      <button type="button" className="d2d-btn primary small" onClick={() => void save()} data-testid="verif-save">
        保存
      </button>
    </div>
  )
}
