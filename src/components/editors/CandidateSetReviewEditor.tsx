/**
 * Candidate Set Review Editor（P8-4、V-18、MODEL-007/008、UI-035/036）。
 * candidate://<llm_run_uid> を開き、保存前の候補セットを表形式で追加・修正・削除する。
 * 関係候補は一時ID（temp_id）で参照するため、要素名変更は From/To 表示へ即時追従する。
 * 採用時のみ同一トランザクションで④正本へ反映される（MODEL-006/009）。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'

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
  sourceModelType: string
  targetModelType: string
}

interface CandidateDraftResponse {
  candidateSet: { elements: CandidateElement[]; relations: CandidateRelation[] }
  updatedAt: string
}

const candidatePrefix = (modelType: string): string => modelType.replace(/^model_/, '').replaceAll('_', '-') || 'model'

function normalizeCandidateIds(
  sourceElements: CandidateElement[],
  sourceRelations: CandidateRelation[]
): { elements: CandidateElement[]; relations: CandidateRelation[] } {
  const idMap = new Map<string, string>()
  const elements = sourceElements.map((element, index) => {
    const tempId = `${candidatePrefix(element.category)}-${String(index + 1).padStart(2, '0')}`
    idMap.set(element.temp_id, tempId)
    return { ...element, temp_id: tempId }
  })
  const relations = sourceRelations.map((relation) => ({
    ...relation,
    from_temp_id: idMap.get(relation.from_temp_id) ?? relation.from_temp_id,
    to_temp_id: idMap.get(relation.to_temp_id) ?? relation.to_temp_id
  }))
  return { elements, relations }
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
  const [hasSavedDraft, setHasSavedDraft] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const skipDraftEffect = useRef(true)
  const [adopting, setAdopting] = useState(false)
  const [allowedRules, setAllowedRules] = useState<AllowedRelationRule[]>([])
  const [modelTypes, setModelTypes] = useState<string[]>([])
  const notify = useJobsStore((s) => s.notify)
  const closeTab = useEditorStore((s) => s.closeTab)
  const setDirty = useEditorStore((s) => s.setDirty)
  const candidateUri = `candidate://${llmRunUid}`

  const load = useCallback(async () => {
    const [res, saved] = await Promise.all([
      invoke<CandidateSetResponse>('design.getCandidateSet', { llmRunUid }),
      invoke<CandidateDraftResponse | null>('design.getCandidateDraft', { llmRunUid })
    ])
    if (saved.ok) setHasSavedDraft(saved.result !== null)
    if (res.ok) {
      const memoryDraft = useEditorStore.getState().candidateDrafts[candidateUri]
      const source = memoryDraft
        ? {
            elements: memoryDraft.elements as unknown as CandidateElement[],
            relations: memoryDraft.relations as unknown as CandidateRelation[]
          }
        : normalizeCandidateIds(res.result.candidateSet?.elements ?? [], res.result.candidateSet?.relations ?? [])
      skipDraftEffect.current = true
      setContext(res.result)
      setElements(source.elements)
      setRelations(source.relations)
      setServerErrors(memoryDraft ? [] : res.result.errors)
      setHydrated(true)
    }
  }, [candidateUri, llmRunUid])

  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    if (!hydrated) return
    if (skipDraftEffect.current) {
      skipDraftEffect.current = false
      return
    }
    useEditorStore.getState().setCandidateDraft(candidateUri, {
      elements: elements as unknown as Array<Record<string, unknown>>,
      relations: relations as unknown as Array<Record<string, unknown>>
    })
    setDirty(candidateUri, true)
    setServerErrors([])
  }, [candidateUri, elements, hydrated, relations, setDirty])

  useEffect(() => {
    const loadOntology = (): void => {
      void Promise.all([
        invoke<AllowedRelationRule[]>('design.listAllowedRelationRules'),
        invoke<{ models: Array<{ model_type: string; is_enabled: number }> }>('ontology.get')
      ]).then(([rules, ontology]) => {
        if (rules.ok) setAllowedRules(rules.result)
        if (ontology.ok)
          setModelTypes(
            ontology.result.models.filter((model) => model.is_enabled === 1).map((model) => model.model_type)
          )
      })
    }
    loadOntology()
    return onBackendEvent((event) => {
      if (event === 'ontology.updated') loadOntology()
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
              (rule.sourceModelType === source || rule.sourceModelType === 'ANY') &&
              (rule.targetModelType === target || rule.targetModelType === 'ANY')
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
    const current = elements[index]
    if (!current) return
    if (patch.category && patch.category !== current.category) {
      const suffix = /-(\d+)$/.exec(current.temp_id)?.[1] ?? String(index + 1).padStart(2, '0')
      const nextId = `${candidatePrefix(patch.category)}-${suffix}`
      setElements((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch, temp_id: nextId } : e)))
      setRelations((prev) =>
        prev.map((relation) => ({
          ...relation,
          from_temp_id: relation.from_temp_id === current.temp_id ? nextId : relation.from_temp_id,
          to_temp_id: relation.to_temp_id === current.temp_id ? nextId : relation.to_temp_id
        }))
      )
      return
    }
    setElements((prev) => prev.map((e, i) => (i === index ? { ...e, ...patch } : e)))
  }

  const removeElement = (index: number): void => {
    const removed = elements[index]!
    setElements((prev) => prev.filter((_, i) => i !== index))
    // 参照する関係候補も同時に削除する
    setRelations((prev) => prev.filter((r) => r.from_temp_id !== removed.temp_id && r.to_temp_id !== removed.temp_id))
  }

  const addElement = (): void => {
    const category = modelTypes.includes('model_req') ? 'model_req' : (modelTypes[0] ?? 'model_req')
    const maxSequence = elements.reduce((max, item) => Math.max(max, Number(/-(\d+)$/.exec(item.temp_id)?.[1] ?? 0)), 0)
    setElements((prev) => [
      ...prev,
      {
        temp_id: `${candidatePrefix(category)}-${String(maxSequence + 1).padStart(2, '0')}`,
        category,
        title: ''
      }
    ])
  }

  const updateRelation = (index: number, patch: Partial<CandidateRelation>): void => {
    setRelations((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  const addRelation = (): void => {
    const first = elements[0]?.temp_id ?? 'req-01'
    const second = elements[1]?.temp_id ?? first
    setRelations((prev) => [...prev, { from_temp_id: second, to_temp_id: first, relation_type: 'relates_to' }])
  }

  const saveDraft = async (): Promise<void> => {
    const result = await invoke('design.saveCandidateDraft', { llmRunUid, elements, relations })
    if (result.ok) {
      setHasSavedDraft(true)
      setDirty(candidateUri, false)
      notify('info', '編集途中の候補セットを一時保存しました')
    } else notify('error', '候補セットを一時保存できませんでした', result.error.message)
  }

  const resumeDraft = async (): Promise<void> => {
    const result = await invoke<CandidateDraftResponse | null>('design.getCandidateDraft', { llmRunUid })
    if (!result.ok || !result.result) {
      notify('warning', '再開できる一時保存はありません')
      setHasSavedDraft(false)
      return
    }
    const normalized = normalizeCandidateIds(result.result.candidateSet.elements, result.result.candidateSet.relations)
    setElements(normalized.elements)
    setRelations(normalized.relations)
    setServerErrors([])
    notify('info', '一時保存した候補セットを再開しました')
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
        useEditorStore.getState().clearCandidateDraft(candidateUri)
        closeTab(candidateUri)
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
        <button type="button" className="d2d-btn" onClick={() => void saveDraft()} data-testid="candidate-save-draft">
          一時保存
        </button>
        <button
          type="button"
          className="d2d-btn"
          disabled={!hasSavedDraft}
          onClick={() => void resumeDraft()}
          data-testid="candidate-resume-draft"
        >
          一時保存を再開
        </button>
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
                  {modelTypes.map((c) => (
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
