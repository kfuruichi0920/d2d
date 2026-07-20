/** ④モデル一覧から設計モデル間の関係を登録するダイアログ（MODEL-032 / UI-046）。 */
import { useMemo, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import type { DesignElementRow } from '../views/DesignModelViews'
import { useEscapeToClose } from '../common/useEscapeToClose'

export interface DesignRelationRule {
  relationType: string
  sourceModelType: string
  targetModelType: string
  requiredAttr: string | null
}

const ATTRIBUTE_OPTIONS: Record<string, string[]> = {
  basis_kind: ['original', 'extracted', 'normalized', 'inferred', 'human_approved'],
  allocation_kind: ['structure', 'behavior', 'state', 'interface', 'data'],
  usage_kind: ['input', 'output', 'read', 'write', 'update', 'publish', 'subscribe'],
  conflict_status: ['suspected', 'confirmed', 'resolved', 'dismissed']
}

const ATTRIBUTE_NAMES: Record<string, string> = {
  basis_kind: 'basisKind',
  allocation_kind: 'allocationKind',
  usage_kind: 'usageKind',
  conflict_status: 'conflictStatus'
}

export function DesignRelationDialog({
  source,
  models,
  rules,
  onClose,
  onSaved
}: {
  source: DesignElementRow
  models: DesignElementRow[]
  rules: DesignRelationRule[]
  onClose: () => void
  onSaved: () => void
}): React.JSX.Element {
  const targets = models.filter((model) => model.uid !== source.uid)
  const [targetUid, setTargetUid] = useState(targets[0]?.uid ?? '')
  const target = targets.find((model) => model.uid === targetUid)
  const available = useMemo(
    () =>
      rules.filter((rule) => rule.sourceModelType === source.model_type && rule.targetModelType === target?.model_type),
    [rules, source.model_type, target?.model_type]
  )
  const [relationType, setRelationType] = useState('')
  const [requiredValue, setRequiredValue] = useState('')
  const [rationale, setRationale] = useState('')
  const selectedRule = available.find((rule) => rule.relationType === relationType) ?? available[0]
  const editableRequiredAttr = selectedRule?.requiredAttr === 'review_status' ? null : selectedRule?.requiredAttr
  const notify = useJobsStore((state) => state.notify)
  useEscapeToClose(true, onClose)

  const save = async (): Promise<void> => {
    if (!target || !selectedRule) return
    const attributes: Record<string, unknown> = { rationale }
    if (editableRequiredAttr) {
      const key = ATTRIBUTE_NAMES[editableRequiredAttr]
      if (key) attributes[key] = requiredValue
    }
    const result = await invoke('design.createRelation', {
      fromUid: source.uid,
      toUid: target.uid,
      relationType: selectedRule.relationType,
      attributes
    })
    if (result.ok) {
      notify('info', `${source.code} から ${target.code} への関係を登録しました`)
      onSaved()
      onClose()
    } else notify('error', 'モデル間関係を登録できませんでした', result.error.message)
  }

  return (
    <div
      className="d2d-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className="d2d-modal"
        role="dialog"
        aria-modal="true"
        aria-label="設計モデル関係を登録"
        data-testid="design-relation-dialog"
      >
        <h2>設計モデル関係を登録</h2>
        <p>
          <code>{source.code}</code> {source.title} から他モデルへの関係を登録します。
        </p>
        <label>
          相手モデル
          <select
            value={targetUid}
            onChange={(event) => {
              setTargetUid(event.target.value)
              setRelationType('')
              setRequiredValue('')
            }}
            data-testid="relation-target"
          >
            {targets.map((model) => (
              <option key={model.uid} value={model.uid}>
                {model.code} — {model.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          関係種別
          <select
            value={selectedRule?.relationType ?? ''}
            onChange={(event) => {
              setRelationType(event.target.value)
              setRequiredValue('')
            }}
            data-testid="relation-type"
          >
            {available.map((rule) => (
              <option key={rule.relationType} value={rule.relationType}>
                {rule.relationType}
              </option>
            ))}
          </select>
        </label>
        {editableRequiredAttr && (
          <label>
            {editableRequiredAttr}（未設定時は仮設定・作成中）
            <select
              value={requiredValue}
              onChange={(event) => setRequiredValue(event.target.value)}
              data-testid="relation-required-attribute"
            >
              <option value="">仮設定（作成中）</option>
              {(ATTRIBUTE_OPTIONS[editableRequiredAttr] ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          根拠
          <textarea value={rationale} onChange={(event) => setRationale(event.target.value)} />
        </label>
        {target && available.length === 0 && (
          <p className="d2d-error">このモデル種別間で許可された関係はありません。</p>
        )}
        <div className="d2d-modal-actions">
          <button type="button" className="d2d-btn" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="d2d-btn primary"
            disabled={!target || !selectedRule}
            onClick={() => void save()}
            data-testid="relation-save"
          >
            登録
          </button>
        </div>
      </div>
    </div>
  )
}
