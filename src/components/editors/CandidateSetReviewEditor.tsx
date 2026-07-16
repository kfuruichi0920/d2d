/**
 * Candidate Set Review Editor（P8-4、V-18、MODEL-007/008、UI-035/036）。
 * candidate://<llm_run_uid> を開き、保存前の候補セットを表形式で追加・修正・削除する。
 * 関係候補は一時ID（temp_id）で参照するため、要素名変更は From/To 表示へ即時追従する。
 * 採用時のみ同一トランザクションで④正本へ反映される（MODEL-006/009）。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'

const CATEGORIES = ['STD', 'REQ', 'CST', 'FUNC', 'STRUCT', 'BEH', 'STATE', 'IF', 'DATA', 'VERIF', 'MGMT', 'IMPL']
interface CandidateElement {
  temp_id: string
  category: string
  title: string
  description?: string | null
  evidence?: string | null
}

interface CandidateRelation {
  from_temp_id: string
  to_temp_id: string
  relation_type: string
  rationale?: string | null
}

interface AllowedRelationRule {
  relationType: string
  sourceCategory: string
  targetCategory: string
}

interface CandidateSetResponse {
  llmRunUid: string
  chunkUid: string | null
  intermediateDocumentUid: string | null
  candidateSet: { elements: CandidateElement[]; relations: CandidateRelation[] } | null
  errors: string[]
  ok: boolean
}

export function CandidateSetReviewEditor({ llmRunUid }: { llmRunUid: string }): React.JSX.Element {
  const [context, setContext] = useState<CandidateSetResponse | null>(null)
  const [elements, setElements] = useState<CandidateElement[]>([])
  const [relations, setRelations] = useState<CandidateRelation[]>([])
  const [serverErrors, setServerErrors] = useState<string[]>([])
  const [adopting, setAdopting] = useState(false)
  const [allowedRules, setAllowedRules] = useState<AllowedRelationRule[]>([])
  const notify = useJobsStore((s) => s.notify)
  const closeTab = useEditorStore((s) => s.closeTab)

  const load = useCallback(async () => {
    const res = await invoke<CandidateSetResponse>('design.getCandidateSet', { llmRunUid })
    if (res.ok) {
      setContext(res.result)
      setElements(res.result.candidateSet?.elements ?? [])
      setRelations(res.result.candidateSet?.relations ?? [])
      setServerErrors(res.result.errors)
    }
  }, [llmRunUid])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    void invoke<AllowedRelationRule[]>('design.listAllowedRelationRules').then((res) => {
      if (res.ok) setAllowedRules(res.result)
    })
  }, [])

  // クライアント側の即時検証（未解決参照・自己参照・空タイトル）
  const clientErrors: string[] = []
  const tempIds = new Set(elements.map((e) => e.temp_id))
  elements.forEach((e, i) => {
    if (!e.title.trim()) clientErrors.push(`要素[${i}] のタイトルが空です`)
  })
  relations.forEach((r, i) => {
    if (!tempIds.has(r.from_temp_id)) clientErrors.push(`関係[${i}] の From（${r.from_temp_id}）が未解決です`)
    if (!tempIds.has(r.to_temp_id)) clientErrors.push(`関係[${i}] の To（${r.to_temp_id}）が未解決です`)
    if (r.from_temp_id === r.to_temp_id) clientErrors.push(`関係[${i}] が自己参照です`)
  })

  const allowedTypes = (relation: CandidateRelation): string[] => {
    const source = elements.find((e) => e.temp_id === relation.from_temp_id)?.category
    const target = elements.find((e) => e.temp_id === relation.to_temp_id)?.category
    return [
      ...new Set(
        allowedRules
          .filter(
            (rule) =>
              (rule.sourceCategory === source || rule.sourceCategory === 'ANY') &&
              (rule.targetCategory === target || rule.targetCategory === 'ANY')
          )
          .map((rule) => rule.relationType)
      )
    ]
  }
  const relationAllowed = (relation: CandidateRelation): boolean =>
    allowedTypes(relation).includes(relation.relation_type)
  relations.forEach((relation, i) => {
    if (allowedRules.length > 0 && !relationAllowed(relation))
      clientErrors.push(`関係[${i}] は許容外です: ${relation.relation_type}`)
  })
  const titleOf = (tempId: string): string => elements.find((e) => e.temp_id === tempId)?.title ?? tempId

  const updateElement = (index: number, patch: Partial<CandidateElement>): void => {
    setElements((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)))
  }

  const removeElement = (index: number): void => {
    const removed = elements[index]!
    setElements((prev) => prev.filter((_, i) => i !== index))
    // 参照する関係候補も同時に削除する
    setRelations((prev) => prev.filter((r) => r.from_temp_id !== removed.temp_id && r.to_temp_id !== removed.temp_id))
  }

  const addElement = (): void => {
    let n = elements.length + 1
    while (tempIds.has(`t${n}`)) n++
    setElements((prev) => [...prev, { temp_id: `t${n}`, category: 'REQ', title: '' }])
  }

  const updateRelation = (index: number, patch: Partial<CandidateRelation>): void => {
    setRelations((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const addRelation = (): void => {
    const first = elements[0]?.temp_id ?? 't1'
    const second = elements[1]?.temp_id ?? first
    setRelations((prev) => [...prev, { from_temp_id: second, to_temp_id: first, relation_type: 'relates_to' }])
  }

  const adopt = async (): Promise<void> => {
    setAdopting(true)
    try {
      const res = await invoke<{ elements: { code: string }[]; relationCount: number }>('design.adoptCandidates', {
        llmRunUid,
        intermediateDocumentUid: context?.intermediateDocumentUid ?? undefined,
        elements,
        relations
      })
      if (res.ok) {
        notify(
          'info',
          `④設計モデルへ反映しました（要素 ${res.result.elements.length} 件 / 関係 ${res.result.relationCount} 件）`
        )
        void useProjectStore.getState().refreshStats()
        closeTab(`candidate://${llmRunUid}`)
      } else {
        notify('error', '採用できませんでした（正本は変更されていません）', res.error.detail || res.error.message)
      }
    } finally {
      setAdopting(false)
    }
  }

  if (!context) return <div className="d2d-empty">読込中…</div>

  const inputStyle: React.CSSProperties = { width: '100%', boxSizing: 'border-box' }
  const thStyle: React.CSSProperties = {
    textAlign: 'left',
    padding: '4px 6px',
    borderBottom: '1px solid var(--d2d-border)',
    color: 'var(--d2d-fg-muted)',
    fontSize: 11
  }
  const tdStyle: React.CSSProperties = { padding: '2px 6px', borderBottom: '1px solid var(--d2d-border)' }

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }} data-testid="candidate-editor">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <h1 style={{ fontSize: 14, margin: 0 }}>LLM 候補セット</h1>
        <span className="d2d-badge review-candidate">候補（採用まで正本を変更しません）</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="d2d-btn primary"
          disabled={adopting || clientErrors.length > 0 || elements.length === 0}
          onClick={() => void adopt()}
          data-testid="candidate-adopt-all"
        >
          {adopting ? '反映中…' : '採用（④正本へ同一トランザクションで反映）'}
        </button>
      </div>

      {[...serverErrors, ...clientErrors].map((error, i) => (
        <div key={i} style={{ color: 'var(--d2d-error)', fontSize: 11.5, marginTop: 4 }} data-testid="candidate-error">
          ⚠ {error}
        </div>
      ))}

      <h2 style={{ fontSize: 13, marginTop: 14 }}>
        要素候補（{elements.length}）
        <button type="button" className="d2d-btn small" style={{ marginLeft: 8 }} onClick={addElement}>
          + 追加
        </button>
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} data-testid="candidate-elements">
        <thead>
          <tr>
            <th style={{ ...thStyle, width: 50 }}>ID</th>
            <th style={{ ...thStyle, width: 90 }}>分類</th>
            <th style={thStyle}>タイトル</th>
            <th style={thStyle}>説明</th>
            <th style={{ ...thStyle, width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {elements.map((element, i) => (
            <tr key={element.temp_id}>
              <td style={tdStyle}>
                <code>{element.temp_id}</code>
              </td>
              <td style={tdStyle}>
                <select value={element.category} onChange={(e) => updateElement(i, { category: e.target.value })}>
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <input
                  style={inputStyle}
                  value={element.title}
                  onChange={(e) => updateElement(i, { title: e.target.value })}
                  data-testid={`element-title-${element.temp_id}`}
                />
              </td>
              <td style={tdStyle}>
                <input
                  style={inputStyle}
                  value={element.description ?? ''}
                  onChange={(e) => updateElement(i, { description: e.target.value })}
                />
              </td>
              <td style={tdStyle}>
                <button type="button" className="d2d-btn small" onClick={() => removeElement(i)} title="要素候補を削除">
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2 style={{ fontSize: 13, marginTop: 14 }}>
        関係候補（{relations.length}）
        <button
          type="button"
          className="d2d-btn small"
          style={{ marginLeft: 8 }}
          onClick={addRelation}
          disabled={elements.length < 2}
        >
          + 追加
        </button>
      </h2>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} data-testid="candidate-relations">
        <thead>
          <tr>
            <th style={thStyle}>From（要素名に追従）</th>
            <th style={{ ...thStyle, width: 130 }}>関係</th>
            <th style={thStyle}>To（要素名に追従）</th>
            <th style={thStyle}>根拠</th>
            <th style={{ ...thStyle, width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {relations.map((relation, i) => (
            <tr
              key={i}
              data-testid={`relation-row-${i}`}
              className={allowedRules.length > 0 && !relationAllowed(relation) ? 'relation-candidate-invalid' : ''}
            >
              <td style={tdStyle}>
                <select
                  value={relation.from_temp_id}
                  onChange={(e) => updateRelation(i, { from_temp_id: e.target.value })}
                >
                  {elements.map((el) => (
                    <option key={el.temp_id} value={el.temp_id}>
                      {el.temp_id}: {titleOf(el.temp_id)}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <select
                  value={relation.relation_type}
                  onChange={(e) => updateRelation(i, { relation_type: e.target.value })}
                >
                  {[
                    ...new Set([
                      ...(relationAllowed(relation) ? [] : [relation.relation_type]),
                      ...allowedTypes(relation)
                    ])
                  ].map((t) => (
                    <option key={t} value={t}>
                      {t}
                      {!allowedTypes(relation).includes(t) ? '（許容外）' : ''}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <select value={relation.to_temp_id} onChange={(e) => updateRelation(i, { to_temp_id: e.target.value })}>
                  {elements.map((el) => (
                    <option key={el.temp_id} value={el.temp_id}>
                      {el.temp_id}: {titleOf(el.temp_id)}
                    </option>
                  ))}
                </select>
              </td>
              <td style={tdStyle}>
                <input
                  style={inputStyle}
                  value={relation.rationale ?? ''}
                  onChange={(e) => updateRelation(i, { rationale: e.target.value })}
                />
              </td>
              <td style={tdStyle}>
                <button
                  type="button"
                  className="d2d-btn small"
                  onClick={() => setRelations((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
