/**
 * 共通Resource Editor（P7-2/P7-3、MID-002/004/005、EDIT-004）。
 * 中間要素では由来／変更前Resourceと保存候補を2ペイン表示し、通常／LLMマージは保存前候補として扱う。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { useSelectionStore } from '../../stores/selection-store'
import { useEditorStore } from '../../stores/editor-store'
import { ResizablePaneGroup } from '../workbench/ResizablePaneGroup'
import { useEscapeToClose } from '../common/useEscapeToClose'
import { SemanticTextInput } from '../common/SemanticTextInput'
import { LlmRequestDialog, type LlmRequestMessage, type PreparedLlmRequest } from '../common/LlmRequestDialog'
import type { SemanticDocument } from '../../types/semantic'
import { MarkdownPreview } from '../common/MarkdownPreview'
import { MathJaxPreview } from '../common/MathJaxPreview'

interface FieldDefinition {
  name: string
  label: string
  kind: 'text' | 'multiline' | 'number' | 'json' | 'enum' | 'table'
  required?: boolean
  options?: string[]
  defaultValue?: string | number
  description: string
  language?: 'markdown' | 'latex'
  preview?: 'markdown' | 'image' | 'formula'
  hidden?: boolean
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
  administrativeNotes: string
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

function ResourceFigurePreview({ resourceUid }: { resourceUid: string }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    void invoke<{ dataUrl: string }>('extracted.getFigurePreview', { resourceUid }).then((result) => {
      if (result.ok) setSrc(result.result.dataUrl)
      else setFailed(true)
    })
  }, [resourceUid])
  if (failed) return <div className="d2d-empty">画像を表示できません</div>
  if (!src) return <div className="d2d-empty">画像を読込中…</div>
  return <img className="resource-figure-preview" src={src} alt="図Resource" data-testid="resource-figure-preview" />
}

function parseTableGrid(value: unknown, rowCount = 0, columnCount = 0): string[][] {
  let parsed: unknown = []
  try {
    parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value
  } catch {
    parsed = []
  }
  const source = Array.isArray(parsed) ? parsed : []
  const rows = Math.max(rowCount, source.length)
  const columns = Math.max(columnCount, ...source.map((row) => (Array.isArray(row) ? row.length : 0)), rows > 0 ? 1 : 0)
  return Array.from({ length: rows }, (_, rowIndex) =>
    Array.from({ length: columns }, (_, columnIndex) => {
      const cell = Array.isArray(source[rowIndex]) ? source[rowIndex]![columnIndex] : undefined
      if (typeof cell === 'string') return cell
      if (cell && typeof cell === 'object' && 'text' in cell) return String((cell as { text?: unknown }).text ?? '')
      return ''
    })
  )
}

function parseHeaderCount(value: unknown): number {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value
    if (Array.isArray(parsed)) return parsed.length
    return Math.max(0, Number(parsed) || 0)
  } catch {
    return 0
  }
}

function tableCellFieldName(row: number, column: number): string {
  return `cells_json.${row}.${column}`
}

function ResourceTableGrid({
  values,
  readonly,
  onChange,
  semanticDocuments,
  onSemanticChange
}: {
  values: Record<string, string | number>
  readonly: boolean
  onChange?: (values: Record<string, string | number>) => void
  semanticDocuments: Record<string, SemanticDocument>
  onSemanticChange?: (fieldName: string, document: SemanticDocument) => void
}): React.JSX.Element {
  const grid = parseTableGrid(values.cells_json, Number(values.row_count) || 0, Number(values.column_count) || 0)
  const headerRows = parseHeaderCount(values.header_rows_json)
  const headerColumns = parseHeaderCount(values.header_columns_json)
  const updateCell = (row: number, column: number, text: string): void => {
    const next = grid.map((cells) => [...cells])
    next[row]![column] = text
    onChange?.({
      ...values,
      row_count: next.length,
      column_count: next[0]?.length ?? 0,
      cells_json: JSON.stringify(next.map((cells) => cells.map((value) => ({ text: value }))))
    })
  }
  const updateHeaders = (kind: 'row' | 'column', count: number): void => {
    const normalized = Math.max(0, Math.floor(count))
    onChange?.({
      ...values,
      [kind === 'row' ? 'header_rows_json' : 'header_columns_json']: JSON.stringify(
        Array.from({ length: normalized }, (_, index) => index)
      )
    })
  }
  return (
    <div className="wide resource-table-grid-field" title="スプレッドシート形式で各セルをセマンティック編集します">
      <span>
        表セル <code>cells_json</code>
      </span>
      <div className="resource-table-header-controls">
        <label>
          ヘッダ行数
          <input
            type="number"
            min={0}
            max={grid.length}
            value={headerRows}
            readOnly={readonly}
            onChange={(event) => updateHeaders('row', Number(event.target.value))}
          />
        </label>
        <label>
          ヘッダ列数
          <input
            type="number"
            min={0}
            max={grid[0]?.length ?? 0}
            value={headerColumns}
            readOnly={readonly}
            onChange={(event) => updateHeaders('column', Number(event.target.value))}
          />
        </label>
      </div>
      <div className="resource-table-grid" data-testid="resource-table-grid">
        <table>
          <tbody>
            {grid.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, columnIndex) => {
                  const fieldName = tableCellFieldName(rowIndex, columnIndex)
                  const content = readonly ? (
                    <span>{cell}</span>
                  ) : semanticDocuments[fieldName] ? (
                    <SemanticTextInput
                      document={semanticDocuments[fieldName]!}
                      multiline={false}
                      testId={`resource-table-cell-${rowIndex}-${columnIndex}`}
                      onChange={(value) => updateCell(rowIndex, columnIndex, value)}
                      onDocumentChange={(document) => onSemanticChange?.(fieldName, document)}
                    />
                  ) : (
                    <input value={cell} onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} />
                  )
                  return rowIndex < headerRows || columnIndex < headerColumns ? (
                    <th key={columnIndex}>{content}</th>
                  ) : (
                    <td key={columnIndex}>{content}</td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
function ResourceFields({
  definition,
  values,
  readonly = false,
  onChange,
  ownerUid,
  semanticDocuments = {},
  onSemanticChange,
  onRequestDescription
}: {
  definition: TypeDefinition
  values: Record<string, string | number>
  readonly?: boolean
  onChange?: (values: Record<string, string | number>) => void
  ownerUid?: string
  semanticDocuments?: Record<string, SemanticDocument>
  onSemanticChange?: (fieldName: string, document: SemanticDocument) => void
  onRequestDescription?: () => void
}): React.JSX.Element {
  const update = (name: string, value: string): void => onChange?.({ ...values, [name]: value })
  return (
    <div className="resource-editor-fields">
      {definition.fields
        .filter((field) => !field.hidden)
        .map((field) =>
          field.kind === 'table' ? (
            <ResourceTableGrid
              key={field.name}
              values={values}
              readonly={readonly}
              onChange={onChange}
              semanticDocuments={semanticDocuments}
              onSemanticChange={onSemanticChange}
            />
          ) : (
            <label
              className={field.kind === 'multiline' || field.kind === 'json' ? 'wide' : ''}
              key={field.name}
              title={field.description}
            >
              <span title={field.description}>
                {field.label}
                {field.required && ' *'} <code>{field.name}</code>
                {field.name === 'description' && onRequestDescription && !readonly && (
                  <button
                    type="button"
                    className="d2d-btn small resource-description-llm"
                    data-testid="resource-description-llm"
                    onClick={onRequestDescription}
                  >
                    LLMから説明文を取得
                  </button>
                )}
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
              {field.preview === 'markdown' && String(values[field.name] ?? '').trim() && (
                <div className="resource-field-preview" title="Markdownプレビュー">
                  <MarkdownPreview markdown={String(values[field.name] ?? '')} />
                </div>
              )}
            </label>
          )
        )}
    </div>
  )
}
export function ResourceEditor({
  resourceUid,
  context,
  onSaved,
  embedded = false,
  onIntegrated
}: {
  resourceUid: string
  context?: ResourceContext
  onSaved?: (result: { uid: string; type: string }) => void
  embedded?: boolean
  onIntegrated?: () => void
}): React.JSX.Element {
  const [currentUid, setCurrentUid] = useState(resourceUid)
  const [data, setData] = useState<ResourceData | null>(null)
  const [targetType, setTargetType] = useState('')
  const [values, setValues] = useState<Record<string, string | number>>({})
  const [semanticDocuments, setSemanticDocuments] = useState<Record<string, SemanticDocument>>({})
  const [administrativeNotes, setAdministrativeNotes] = useState('')
  const [sources, setSources] = useState<MergeSource[]>([])
  const [sourceValues, setSourceValues] = useState<Record<string, Record<string, string | number>>>({})
  const [warnings, setWarnings] = useState<string[]>([])
  const [mergeMode, setMergeMode] = useState<'edit-resource' | 'merge' | 'llm-merge'>('edit-resource')
  const [llmRunUid, setLlmRunUid] = useState<string | undefined>()
  const [derivedMode, setDerivedMode] = useState<'new' | 'existing'>('new')
  const [derivedValue, setDerivedValue] = useState('')
  const [derivedRelation, setDerivedRelation] = useState<'contains' | 'decomposes' | 'uses' | 'relates_to'>(
    'relates_to'
  )
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [merging, setMerging] = useState(false)
  const [llmRequest, setLlmRequest] = useState<PreparedLlmRequest | null>(null)
  const [llmOperation, setLlmOperation] = useState<'merge' | 'description'>('merge')
  const notify = useJobsStore((state) => state.notify)
  const openResource = useEditorStore((state) => state.openResource)
  // 種別変更の確認モーダルは Escape でキャンセルする（W10）
  useEscapeToClose(confirming, () => setConfirming(false))
  const setSelectedItem = useSelectionStore((state) => state.setSelectedItem)
  const clearSelectedItem = useSelectionStore((state) => state.clearSelectedItem)
  const loadSemanticDocuments = useCallback(
    async (ownerUid: string, definition: TypeDefinition, source: Record<string, unknown>) => {
      const textEntries = definition.fields
        .filter((field) => field.kind === 'text' || field.kind === 'multiline')
        .map((field) => ({
          fieldName: field.name,
          fallbackText: String(source[field.name] ?? field.defaultValue ?? '')
        }))
      const cellEntries =
        definition.type === 'resource_table'
          ? parseTableGrid(source.cells_json, Number(source.row_count) || 0, Number(source.column_count) || 0).flatMap(
              (row, rowIndex) =>
                row.map((fallbackText, columnIndex) => ({
                  fieldName: tableCellFieldName(rowIndex, columnIndex),
                  fallbackText
                }))
            )
          : []
      const results = await Promise.all(
        [...textEntries, ...cellEntries].map(async ({ fieldName, fallbackText }) => {
          const result = await invoke<SemanticDocument>('semantic.get', { ownerUid, fieldName, fallbackText })
          return [fieldName, result.ok ? result.result : null] as const
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
    setAdministrativeNotes(resource.administrativeNotes)
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
  const openLlmMergeDialog = async (): Promise<void> => {
    const result = await invoke<PreparedLlmRequest>('llm.prepareRequest', {
      operation: 'resource-merge',
      context: { targetType, sources: mergePayload() }
    })
    if (result.ok) {
      setLlmOperation('merge')
      setLlmRequest(result.result)
    } else notify('error', 'LLMマージの確認画面を開けません', result.error.message)
  }
  const llmMerge = async (messages: LlmRequestMessage[], promptTemplateUid?: string): Promise<void> => {
    setMerging(true)
    try {
      const enqueued = await invoke<{ jobId: string }>('llm.runConfirmed', {
        operation: 'resource-merge',
        context: { targetType, sources: mergePayload() },
        messages,
        promptTemplateUid
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
  const openDescriptionDialog = async (): Promise<void> => {
    const result = await invoke<PreparedLlmRequest>('llm.prepareRequest', {
      operation: 'resource-description',
      context: { resourceUid: data?.uid, resourceType: targetType, values }
    })
    if (!result.ok) return notify('error', '説明文生成の確認画面を開けません', result.error.message)
    setLlmOperation('description')
    setLlmRequest(result.result)
  }
  const generateDescription = async (messages: LlmRequestMessage[], promptTemplateUid?: string): Promise<void> => {
    const started = await invoke<{ jobId: string }>('llm.runConfirmed', {
      operation: 'resource-description',
      context: { resourceUid: data?.uid, resourceType: targetType, values },
      messages,
      promptTemplateUid
    })
    if (!started.ok) return notify('error', '説明文生成を開始できません', started.error.message)
    for (let index = 0; index < 240; index++) {
      const job = await invoke<{ status: string; output?: { content?: string }; error?: { message: string } }>(
        'job.get',
        { jobId: started.result.jobId }
      )
      if (job.ok && job.result.status === 'success') {
        try {
          const parsed = JSON.parse(job.result.output?.content ?? '{}') as { description?: unknown }
          if (typeof parsed.description !== 'string') throw new Error('description missing')
          setValues((current) => ({ ...current, description: parsed.description as string }))
          setSemanticDocuments((current) =>
            current.description
              ? { ...current, description: { ...current.description, displayText: parsed.description as string } }
              : current
          )
          notify('info', 'LLM説明文候補を編集欄へ反映しました。保存前に内容を確認してください')
        } catch {
          notify('error', 'LLM説明文候補のJSON形式を解釈できません')
        }
        return
      }
      if (job.ok && ['failed', 'aborted', 'partial'].includes(job.result.status)) {
        notify('error', '説明文生成に失敗しました', job.result.error?.message)
        return
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    notify('error', '説明文生成がタイムアウトしました')
  }
  const linkDerived = async (): Promise<void> => {
    if (!derivedValue.trim()) return notify('error', '派生Resourceの内容またはアドレスを入力してください')
    const result = await invoke<{ targetUid: string; created: boolean }>('resource.linkDerived', {
      sourceUid: currentUid,
      relationType: derivedRelation,
      ...(derivedMode === 'new' ? { newText: derivedValue } : { targetUid: derivedValue })
    })
    if (!result.ok) return notify('error', '派生Resourceを関連付けできません', result.error.message)
    notify('info', result.result.created ? '派生Resourceを新規追加しました' : '既存Resourceを関連付けました')
    setDerivedValue('')
  }
  const submit = async (): Promise<void> => {
    if (!data || !definition) return
    const textFieldNames = new Set(
      definition.fields
        .filter((field) => field.kind === 'text' || field.kind === 'multiline')
        .map((field) => field.name)
    )
    const documents = Object.values(semanticDocuments).map((document) =>
      textFieldNames.has(document.fieldName)
        ? { ...document, displayText: String(values[document.fieldName] ?? document.displayText) }
        : document
    )
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
      llmRunUid,
      administrativeNotes
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
          <span>{`resource://${data.uid}`}</span>
          <button
            type="button"
            className="d2d-btn small"
            title="当該Resourceアドレスをクリップボードへコピーします"
            data-testid="resource-copy-address"
            onClick={() => {
              void navigator.clipboard.writeText(`resource://${data.uid}`)
              notify('info', 'Resourceアドレスをコピーしました')
            }}
          >
            コピー
          </button>
          {embedded && (
            <button
              type="button"
              className="d2d-btn small"
              title="このResource編集画面をEditor Areaのタブとして開きます"
              data-testid="resource-integrate-editor"
              onClick={() => {
                openResource(`resource://${data.uid}`, `${data.code} ${data.title ?? data.typeLabel}`, {
                  preview: false
                })
                onIntegrated?.()
              }}
            >
              エディタへ統合
            </button>
          )}
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
                onClick={() => void openLlmMergeDialog()}
                data-testid="resource-llm-merge"
              >
                {merging ? 'LLMマージ中…' : 'LLMマージ'}
              </button>
            </div>
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
          {targetType === 'resource_figure' && data.type === 'resource_figure' && (
            <ResourceFigurePreview resourceUid={data.uid} />
          )}
          {targetType === 'resource_formula' && (
            <div className="resource-formula-preview" data-testid="resource-formula-preview">
              <b>TeXプレビュー</b>
              <MathJaxPreview tex={String(values.formula_text ?? '')} />
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
            onRequestDescription={
              ['resource_figure', 'resource_table', 'resource_code', 'resource_formula'].includes(targetType)
                ? () => void openDescriptionDialog()
                : undefined
            }
          />
          {['resource_figure', 'resource_formula', 'resource_table', 'resource_code'].includes(targetType) && (
            <section className="resource-derived-panel" data-testid="resource-derived-panel">
              <b>派生Resource</b>
              <label>
                登録方法
                <select
                  value={derivedMode}
                  onChange={(event) => setDerivedMode(event.target.value as 'new' | 'existing')}
                >
                  <option value="new">新規追加</option>
                  <option value="existing">既存を参照</option>
                </select>
              </label>
              <label>
                {derivedMode === 'new' ? '新規Resource内容' : '既存Resourceアドレス'}
                <input value={derivedValue} onChange={(event) => setDerivedValue(event.target.value)} />
              </label>
              <label>
                当Resourceとの関係
                <select
                  value={derivedRelation}
                  onChange={(event) => setDerivedRelation(event.target.value as typeof derivedRelation)}
                >
                  <option value="relates_to">relates_to</option>
                  <option value="contains">contains</option>
                  <option value="decomposes">decomposes</option>
                  <option value="uses">uses</option>
                </select>
              </label>
              <button type="button" className="d2d-btn" onClick={() => void linkDerived()}>
                関係を登録
              </button>
            </section>
          )}
          <label
            className="resource-administrative-notes"
            title="設計情報には利用しない管理専用情報です。設計上の特記事項は設計情報の各フィールドへ記載してください。"
          >
            <span>特記事項（管理用）</span>
            <textarea
              value={administrativeNotes}
              onChange={(event) => setAdministrativeNotes(event.target.value)}
              data-testid="resource-administrative-notes"
            />
          </label>
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
      {llmRequest && (
        <LlmRequestDialog
          request={llmRequest}
          screenId={llmOperation === 'merge' ? 'resource.merge' : `resource.${targetType}.description`}
          title={llmOperation === 'merge' ? 'Resource LLMマージ' : 'LLMから説明文を取得'}
          onClose={() => setLlmRequest(null)}
          onConfirmed={llmOperation === 'merge' ? llmMerge : generateDescription}
        />
      )}
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
