/**
 * 共通Resource Editor（P7-2/P7-3、MID-002/004/005、EDIT-004）。
 * 中間データ画面と resource:// URI の双方から再利用する定義駆動Editor。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'

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
}
interface ResourceContext {
  intermediateDocumentUid: string
  intermediateItemUid: string
  elementId: string
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
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const notify = useJobsStore((state) => state.notify)
  const load = useCallback(async () => {
    const result = await invoke<ResourceData>('resource.get', { uid: currentUid })
    if (!result.ok) {
      notify('error', 'Resourceを読み込めません', result.error.message)
      return
    }
    setData(result.result)
    setTargetType(result.result.type)
    const definition = result.result.definitions.find((candidate) => candidate.type === result.result.type)!
    setValues(initialValues(definition, result.result.values))
  }, [currentUid, notify])
  useEffect(() => {
    void load()
  }, [load])
  useEffect(() => {
    setCurrentUid(resourceUid)
  }, [resourceUid])
  const definition = useMemo(
    () => data?.definitions.find((candidate) => candidate.type === targetType),
    [data, targetType]
  )
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
    setValues(initialValues(next, type === data.type ? data.values : undefined))
    setConfirming(false)
  }
  const submit = async (): Promise<void> => {
    if (!data || !definition) return
    setSaving(true)
    const result = await invoke<{ uid: string; type: string }>('resource.revise', {
      resourceUid: data.uid,
      targetType,
      values,
      ...context
    })
    setSaving(false)
    setConfirming(false)
    if (!result.ok) {
      notify('error', 'Resourceを保存できません', result.error.message)
      return
    }
    notify('info', `${definition.label} Resourceを新しいIDで保存しました`)
    if (context && onSaved) onSaved(result.result)
    else {
      setCurrentUid(result.result.uid)
      onSaved?.(result.result)
    }
  }
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
          種別変更: {data.typeLabel} → {definition.label}。保存時に新Resourceを作成します。
        </div>
      )}
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
                onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                data-testid={`resource-field-${field.name}`}
              >
                <option value="">（未設定）</option>
                {field.options?.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : field.kind === 'multiline' || field.kind === 'json' ? (
              <textarea
                value={values[field.name] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                spellCheck={field.kind !== 'json'}
                data-testid={`resource-field-${field.name}`}
              />
            ) : (
              <input
                type={field.kind === 'number' ? 'number' : 'text'}
                value={values[field.name] ?? ''}
                onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
                data-testid={`resource-field-${field.name}`}
              />
            )}
          </label>
        ))}
      </div>
      <div className="resource-editor-actions">
        <button
          type="button"
          className="d2d-btn primary"
          disabled={saving}
          onClick={() => (targetType !== data.type && lostFields.length > 0 ? setConfirming(true) : void submit())}
          data-testid="resource-save"
        >
          {saving ? '保存中…' : '新Resourceとして保存'}
        </button>
      </div>
      {confirming && (
        <div className="resource-loss-confirm" role="dialog" aria-modal="true" data-testid="resource-loss-confirm">
          <h3>Resource種別を変更しますか？</h3>
          <p>{data.typeLabel}固有の次の情報は新Resourceへ引き継がれません。</p>
          <ul>
            {lostFields.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <p>元Resourceは由来として保持されますが、新しい{definition.label}では上記情報を利用できません。</p>
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
