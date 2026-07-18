/**
 * 共通Resource Editor（P7-2/P7-3、MID-002/004/005、EDIT-004）。
 * 中間要素では由来／変更前Resourceと保存候補を2ペイン表示し、通常／LLMマージは保存前候補として扱う。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { useSelectionStore } from '../../stores/selection-store'
import { ResizablePaneGroup } from '../workbench/ResizablePaneGroup'
import { SemanticTextInput } from '../common/SemanticTextInput'
import type { SemanticDocument } from '../../types/semantic'

interface FieldDefinition {
  name: string
  label: string
  kind: 'text' | 'multiline' | 'number' | 'json' | 'enum'
  required?: boolean
  options?: string[]
  defaultValue?: string | number
}
interface TypeDefinition {
  type: string
  label: string
  fields: FieldDefinition[]
}
interface ResourceData {
  uid: string
  code: string
  title: string | null
  type: string
  typeLabel: string
  values: Record<string, unknown>
  definitions: TypeDefinition[]
  ownership: {
    exclusiveIntermediate: boolean
    intermediateItemUid?: string
    protectionReasons: string[]
  }
}
interface ResourceContext {
  intermediateDocumentUid: string
  intermediateItemUid: string
  elementId: string
}
interface MergeSource {
  resourceUid: string
  sourceKind: 'extracted' | 'intermediate'
  sourceLabel: string
  readonly: boolean
  type: string
  typeLabel: string
  values: Record<string, unknown>
}
interface MergeCandidate {
  values: Record<string, unknown>
  warnings: string[]
  llmRunUid?: string
}

function displayValue(field: FieldDefinition, value: unknown): string | number {
  if (value === null || value === undefined || value === '') return field.defaultValue ?? ''
  if (field.kind === 'json' && typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2)
    } catch {
      return value
    }
  }
  return field.kind === 'number' ? Number(value) : String(value)
}
function initialValues(definition: TypeDefinition, source?: Record<string, unknown>): Record<string, string | number> {
  return Object.fromEntries(definition.fields.map((field) => [field.name, displayValue(field, source?.[field.name])]))
}

function ResourceFields({
  definition,
  values,
  readonly = false,
  onChange,
  ownerUid,
  semanticDocuments = {},
  onSemanticChange
}: {
  definition: TypeDefinition
  values: Record<string, string | number>
  readonly?: boolean
  onChange?: (values: Record<string, string | number>) => void
  ownerUid?: string
  semanticDocuments?: Record<string, SemanticDocument>
  onSemanticChange?: (fieldName: string, document: SemanticDocument) => void
}): React.JSX.Element {
  const update = (name: string, value: string): void => onChange?.({ ...values, [name]: value })
  return (
    <div className="resource-editor-fields">
      {definition.fields.map((field) => (
        <label className={field.kind === 'multiline' || field.kind === 'json' ? 'wide' : ''} key={field.name}>
          <span>
            {field.label}
            {field.required && ' *'} <code>{field.name}</code>
          </span>
          {field.kind === 'enum' ? (
            <select
              value={values[field.name] ?? ''}
              disabled={readonly}
              onChange={(event) => update(field.name, event.target.value)}
              data-testid={`resource-field-${field.name}`}
            >
              <option value="">（未設定）</option>
              {field.options?.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : !readonly &&
            ownerUid &&
            (field.kind === 'text' || field.kind === 'multiline') &&
            semanticDocuments[field.name] ? (
            <SemanticTextInput
              document={semanticDocuments[field.name]!}
              multiline={field.kind === 'multiline'}
              testId={`resource-field-${field.name}`}
              onChange={(value) => update(field.name, value)}
              onDocumentChange={(document) => onSemanticChange?.(field.name, document)}
            />
          ) : field.kind === 'multiline' || field.kind === 'json' ? (
            <textarea
              value={values[field.name] ?? ''}
              readOnly={readonly}
              onChange={(event) => update(field.name, event.target.value)}
              spellCheck={field.kind !== 'json'}
              data-testid={`resource-field-${field.name}`}
            />
          ) : (
            <input
              type={field.kind === 'number' ? 'number' : 'text'}
              value={values[field.name] ?? ''}
              readOnly={readonly}
              onChange={(event) => update(field.name, event.target.value)}
              data-testid={`resource-field-${field.name}`}
            />
          )}
        </label>
      ))}
    </div>
  )
}

export function ResourceEditor({
  resourceUid,
  context,
  onSaved,
  embedded = false
}: {
  resourceUid: string
  context?: ResourceContext
  onSaved?: (result: { uid: string; type: string }) => void
  embedded?: boolean
}): React.JSX.Element {
  const [currentUid, setCurrentUid] = useState(resourceUid)
  const [data, setData] = useState<ResourceData | null>(null)
  const [targetType, setTargetType] = useState('')
  const [values, setValues] = useState<Record<string, string | number>>({})
  const [semanticDocuments, setSemanticDocuments] = useState<Record<string, SemanticDocument>>({})
  const [sources, setSources] = useState<MergeSource[]>([])
  const [sourceValues, setSourceValues] = useState<Record<string, Record<string, string | number>>>({})
  const [warnings, setWarnings] = useState<string[]>([])
  const [mergeMode, setMergeMode] = useState<'edit-resource' | 'merge' | 'llm-merge'>('edit-resource')
  const [llmRunUid, setLlmRunUid] = useState<string | undefined>()
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [merging, setMerging] = useState(false)
  const notify = useJobsStore((state) => state.notify)
  const setSelectedItem = useSelectionStore((state) => state.setSelectedItem)
  const clearSelectedItem = useSelectionStore((state) => state.clearSelectedItem)
  const loadSemanticDocuments = useCallback(
    async (ownerUid: string, definition: TypeDefinition, source: Record<string, unknown>) => {
      const fields = definition.fields.filter((field) => field.kind === 'text' || field.kind === 'multiline')
      const results = await Promise.all(
        fields.map(async (field) => {
          const fallbackText = String(source[field.name] ?? field.defaultValue ?? '')
          const result = await invoke<SemanticDocument>('semantic.get', {
            ownerUid,
            fieldName: field.name,
            fallbackText
          })
          return [field.name, result.ok ? result.result : null] as const
        })
      )
      setSemanticDocuments(
        Object.fromEntries(results.filter((entry): entry is readonly [string, SemanticDocument] => entry[1] !== null))
      )
    },
    []
  )
  useEffect(() => {
    if (embedded || !data) return
    const contextUri = `resource://${currentUid}`
    const properties = Object.fromEntries(
      Object.entries(data.values).filter(
        ([, value]) => value === null || ['string', 'number', 'boolean'].includes(typeof value)
      )
    ) as Record<string, string | number | boolean | null>
    setSelectedItem({
      contextUri,
      uid: data.uid,
      displayId: data.code,
      entityType: data.type,
      itemType: data.type,
      title: data.title ?? undefined,
      properties: { resourceTypeLabel: data.typeLabel, ...properties }
    })
    return () => clearSelectedItem(contextUri)
  }, [clearSelectedItem, currentUid, data, embedded, setSelectedItem])
  const load = useCallback(async () => {
    const [resourceResult, contextResult] = await Promise.all([
      invoke<ResourceData>('resource.get', { uid: currentUid }),
      context
        ? invoke<{ sources: MergeSource[] }>('resource.getMergeContext', {
            resourceUid: currentUid,
            ...context
          })
        : Promise.resolve(null)
    ])
    if (!resourceResult.ok) {
      notify('error', 'Resourceを読み込めません', resourceResult.error.message)
      return
    }
    const resource = resourceResult.result
    setData(resource)
    setTargetType(resource.type)
    const definition = resource.definitions.find((candidate) => candidate.type === resource.type)!
    setValues(initialValues(definition, resource.values))
    await loadSemanticDocuments(resource.uid, definition, resource.values)
    const mergeSources = contextResult?.ok ? contextResult.result.sources : []
    setSources(mergeSources)
    const allSources: MergeSource[] = [
      ...mergeSources,
      {
        resourceUid: resource.uid,
        sourceKind: 'intermediate',
        sourceLabel: `変更前Resource ${resource.code}`,
        readonly: false,
        type: resource.type,
        typeLabel: resource.typeLabel,
        values: resource.values
      }
    ]
    setSourceValues(
      Object.fromEntries(
        allSources.map((source) => {
          const sourceDefinition = resource.definitions.find((candidate) => candidate.type === source.type)!
          return [source.resourceUid, initialValues(sourceDefinition, source.values)]
        })
      )
    )
    setWarnings([])
    setMergeMode('edit-resource')
    setLlmRunUid(undefined)
  }, [context, currentUid, loadSemanticDocuments, notify])
  useEffect(() => void load(), [load])
  useEffect(() => setCurrentUid(resourceUid), [resourceUid])

  const definition = useMemo(
    () => data?.definitions.find((candidate) => candidate.type === targetType),
    [data, targetType]
  )
  const currentAsSource = useMemo<MergeSource | null>(
    () =>
      data
        ? {
            resourceUid: data.uid,
            sourceKind: 'intermediate',
            sourceLabel: `変更前Resource ${data.code}`,
            readonly: false,
            type: data.type,
            typeLabel: data.typeLabel,
            values: data.values
          }
        : null,
    [data]
  )
  const activeSources = targetType !== data?.type && currentAsSource ? [currentAsSource] : sources
  const lostFields = useMemo(() => {
    if (!data || targetType === data.type) return []
    const old = data.definitions.find((candidate) => candidate.type === data.type)
    return (
      old?.fields
        .filter((field) => {
          const value = data.values[field.name]
          return value !== null && value !== undefined && String(value).trim() !== ''
        })
        .map((field) => field.label) ?? []
    )
  }, [data, targetType])

  const changeType = (type: string): void => {
    if (!data) return
    const next = data.definitions.find((candidate) => candidate.type === type)
    if (!next) return
    setTargetType(type)
    const nextValues = initialValues(next, type === data.type ? data.values : undefined)
    setValues(nextValues)
    void loadSemanticDocuments(data.uid, next, nextValues)
    setWarnings([])
    setMergeMode('edit-resource')
    setLlmRunUid(undefined)
    setConfirming(false)
  }
  const mergePayload = (): Array<{ resourceUid: string; type: string; values: Record<string, string | number> }> =>
    activeSources.map((source) => ({
      resourceUid: source.resourceUid,
      type: source.type,
      values: sourceValues[source.resourceUid] ?? {}
    }))
  const applyCandidate = (candidate: MergeCandidate, mode: 'merge' | 'llm-merge'): void => {
    if (!definition) return
    setValues(initialValues(definition, candidate.values))
    setWarnings(candidate.warnings)
    setMergeMode(mode)
    setLlmRunUid(candidate.llmRunUid)
  }
  const ruleMerge = async (): Promise<void> => {
    const result = await invoke<MergeCandidate>('resource.mergePreview', { targetType, sources: mergePayload() })
    if (!result.ok) return notify('error', 'ルールマージできません', result.error.message)
    applyCandidate(result.result, 'merge')
  }
  const llmMerge = async (): Promise<void> => {
    setMerging(true)
    try {
      const enqueued = await invoke<{ jobId: string }>('resource.generateMergeCandidate', {
        targetType,
        sources: mergePayload()
      })
      if (!enqueued.ok) return notify('error', 'LLMマージを開始できません', enqueued.error.message)
      for (let index = 0; index < 240; index++) {
        const job = await invoke<{ status: string; output: MergeCandidate; error?: { message: string } | null }>(
          'job.get',
          { jobId: enqueued.result.jobId }
        )
        if (job.ok && job.result.status === 'success') {
          applyCandidate(job.result.output, 'llm-merge')
          return
        }
        if (job.ok && ['failed', 'aborted', 'partial'].includes(job.result.status))
          return notify('error', 'LLMマージに失敗しました', job.result.error?.message)
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      notify('error', 'LLMマージがタイムアウトしました')
    } finally {
      setMerging(false)
    }
  }
  const submit = async (): Promise<void> => {
    if (!data || !definition) return
    const textFields = definition.fields.filter((field) => field.kind === 'text' || field.kind === 'multiline')
    const documents = textFields
      .map((field) => semanticDocuments[field.name])
      .filter((document): document is SemanticDocument => document !== undefined)
      .map((document) => ({ ...document, displayText: String(values[document.fieldName] ?? document.displayText) }))
    for (const document of documents) {
      const validation = await invoke('semantic.validateStructured', {
        ownerUid: data.uid,
        fieldName: document.fieldName,
        json: JSON.stringify({
          schemaVersion: 1,
          originalText: document.originalText,
          displayText: document.displayText,
          policy: document.policy,
          references: document.references
        })
      })
      if (!validation.ok) {
        notify('error', `${document.fieldName} のセマンティック参照を保存できません`, validation.error.message)
        return
      }
    }
    setSaving(true)
    const result = await invoke<{
      uid: string
      type: string
      saveMode: 'updated' | 'created-replaced' | 'created-protected'
      protectionReasons: string[]
    }>('resource.revise', {
      resourceUid: data.uid,
      targetType,
      values,
      ...context,
      basedOnResourceUids:
        mergeMode === 'edit-resource' ? undefined : activeSources.map((source) => source.resourceUid),
      transformNote: mergeMode,
      llmRunUid
    })
    setSaving(false)
    setConfirming(false)
    if (!result.ok) return notify('error', 'Resourceを保存できません', result.error.message)
    for (const document of documents) {
      const semanticResult = await invoke('semantic.save', {
        document: { ...document, ownerUid: result.result.uid, history: undefined }
      })
      if (!semanticResult.ok) {
        notify('error', `${document.fieldName} の構造化参照を保存できません`, semanticResult.error.message)
        return
      }
    }
    const message =
      result.result.saveMode === 'updated'
        ? `${definition.label} Resourceを同じIDへ上書きしました`
        : result.result.saveMode === 'created-replaced'
          ? `旧Resourceを削除し、${definition.label} Resourceを新しいIDで保存しました`
          : `共有元を保護し、${definition.label} Resourceを新しいIDで保存しました`
    notify('info', message, result.result.protectionReasons.join(' '))
    if (context && onSaved) onSaved(result.result)
    else {
      setCurrentUid(result.result.uid)
      onSaved?.(result.result)
    }
  }

  const saveLabel =
    targetType === data?.type
      ? data?.ownership.exclusiveIntermediate
        ? '同じResourceへ上書き保存'
        : '元Resourceを保護して新Resourceとして保存'
      : data?.ownership.exclusiveIntermediate
        ? '旧Resourceを削除して新Resourceとして保存'
        : '元Resourceを保護して新Resourceとして保存'
  if (!data || !definition) return <div className="d2d-empty">Resourceを読込中…</div>
  return (
    <div className={`resource-editor${embedded ? ' embedded' : ''}`} data-testid="resource-editor">
      <div className="resource-editor-header">
        <div>
          <b>{data.code}</b>
          <span>{data.uid}</span>
        </div>
        <label>
          Resource種別
          <select
            value={targetType}
            onChange={(event) => changeType(event.target.value)}
            data-testid="resource-type-select"
          >
            {data.definitions.map((candidate) => (
              <option value={candidate.type} key={candidate.type}>
                {candidate.label} ({candidate.type})
              </option>
            ))}
          </select>
        </label>
      </div>
      {targetType !== data.type && (
        <div className="resource-type-warning" data-testid="resource-type-warning">
          種別変更: {data.typeLabel} → {definition.label}
          。専有Resourceなら保存時に旧Resourceを削除し、共有Resourceなら元を保護します。
        </div>
      )}
      <ResizablePaneGroup
        initialSizes={context ? [1, 1] : [1]}
        testId="resource-editor-layout"
        className={context ? 'resource-merge-layout' : undefined}
      >
        {context && (
          <section className="resource-merge-source" data-testid="resource-merge-source">
            <h3>{targetType === data.type ? 'マージ元／抽出由来' : '変更前Resource'}</h3>
            {activeSources.map((source) => {
              const sourceDefinition = data.definitions.find((candidate) => candidate.type === source.type)!
              return (
                <details open key={`${source.sourceKind}-${source.resourceUid}`}>
                  <summary>
                    {source.sourceLabel} <span>{source.typeLabel}</span>
                    {source.readonly && <small>読取専用</small>}
                  </summary>
                  <ResourceFields
                    definition={sourceDefinition}
                    values={sourceValues[source.resourceUid] ?? initialValues(sourceDefinition, source.values)}
                    readonly={source.readonly}
                    onChange={(next) => setSourceValues((current) => ({ ...current, [source.resourceUid]: next }))}
                  />
                </details>
              )
            })}
            <div className="resource-merge-actions">
              <button
                type="button"
                className="d2d-btn"
                onClick={() => void ruleMerge()}
                data-testid="resource-rule-merge"
              >
                マージ
              </button>
              <button
                type="button"
                className="d2d-btn"
                disabled={merging}
                onClick={() => void llmMerge()}
                data-testid="resource-llm-merge"
              >
                {merging ? 'LLMマージ中…' : 'LLMマージ'}
              </button>
            </div>
          </section>
        )}
        <section className="resource-merge-target" data-testid="resource-merge-target">
          {context && <h3>保存候補: {definition.label}</h3>}
          {warnings.length > 0 && (
            <div className="resource-merge-warnings" data-testid="resource-merge-warnings">
              {warnings.map((warning) => (
                <div key={warning}>{warning}</div>
              ))}
            </div>
          )}
          <ResourceFields
            definition={definition}
            values={values}
            onChange={setValues}
            ownerUid={data.uid}
            semanticDocuments={semanticDocuments}
            onSemanticChange={(fieldName, document) =>
              setSemanticDocuments((current) => ({ ...current, [fieldName]: document }))
            }
          />
          <div className="resource-editor-actions">
            <button
              type="button"
              className="d2d-btn primary"
              disabled={saving}
              onClick={() => (targetType !== data.type && lostFields.length > 0 ? setConfirming(true) : void submit())}
              data-testid="resource-save"
            >
              {saving ? '保存中…' : saveLabel}
            </button>
          </div>
        </section>
      </ResizablePaneGroup>
      {confirming && (
        <div className="resource-loss-confirm" role="dialog" aria-modal="true" data-testid="resource-loss-confirm">
          <h3>Resource種別を変更しますか？</h3>
          <p>{data.typeLabel}固有の次の情報は新Resourceへ引き継がれません。</p>
          <ul>
            {lostFields.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <p>
            {data.ownership.exclusiveIntermediate
              ? `現在のResourceは③専有のため、保存時に削除されます。新しい${definition.label}では上記情報を利用できません。`
              : `現在のResourceは共有されているため保護されますが、新しい${definition.label}では上記情報を利用できません。`}
          </p>
          <div>
            <button type="button" className="d2d-btn" onClick={() => setConfirming(false)}>
              キャンセル
            </button>
            <button
              type="button"
              className="d2d-btn danger"
              onClick={() => void submit()}
              data-testid="resource-loss-confirm-apply"
            >
              情報を失って変更
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function ResourceEditorPage({ uid }: { uid: string }): React.JSX.Element {
  return <ResourceEditor resourceUid={uid} />
}
