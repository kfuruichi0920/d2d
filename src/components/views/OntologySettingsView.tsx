/** 現在採用中の設計モデル設定管理（MODEL-019〜029）。 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
interface FieldDef {
  key: string
  label: string
  type: 'text' | 'multiline' | 'json' | 'select'
  description: string
  options?: string[]
  is_enabled?: number
}
interface ModelDef {
  model_type: string
  code_prefix: string
  label: string
  layer: string
  definition: string
  field_schema_json: string
  is_enabled: number
  is_builtin: number
}
interface RelationDef {
  relation_type: string
  label: string
  definition: string
  required_attr: string | null
  icon_color: string
  icon_text: string
  is_enabled: number
  is_builtin: number
}
interface Allowance {
  relation_type: string
  source_model_type: string
  target_model_type: string
  allowed: number
}
interface Snapshot {
  version: string
  models: ModelDef[]
  relations: RelationDef[]
  allowances: Allowance[]
}
export function OntologySettingsSection(): React.JSX.Element {
  const [data, setData] = useState<Snapshot | null>(null),
    [relation, setRelation] = useState('satisfies'),
    [newModel, setNewModel] = useState({
      modelType: 'model_',
      codePrefix: '',
      label: '',
      layer: '',
      definition: '',
      fieldSchemaJson: '[]'
    }),
    [newRelation, setNewRelation] = useState({
      relationType: '',
      label: '',
      definition: '',
      requiredAttr: '',
      iconColor: '#9099a8',
      iconText: '?'
    })
  const notify = useJobsStore((s) => s.notify)
  const load = useCallback(async () => {
    const r = await invoke<Snapshot>('ontology.get')
    if (r.ok) setData(r.result)
  }, [])
  useEffect(() => {
    void load()
  }, [load])
  const allowed = useMemo(
    () =>
      new Set(
        (data?.allowances ?? [])
          .filter((x) => x.relation_type === relation && x.allowed === 1)
          .map((x) => `${x.source_model_type}|${x.target_model_type}`)
      ),
    [data, relation]
  )
  if (!data)
    return (
      <section>
        <h2>設計モデル設定</h2>
        <p>プロジェクトを開くと設定できます。</p>
      </section>
    )
  const saveModel = async (m: ModelDef): Promise<void> => {
    const r = await invoke<Snapshot>('ontology.saveModel', {
      modelType: m.model_type,
      codePrefix: m.code_prefix,
      label: m.label,
      layer: m.layer,
      definition: m.definition,
      fieldSchemaJson: m.field_schema_json,
      enabled: m.is_enabled === 1
    })
    if (r.ok) {
      setData(r.result)
      notify('info', `${m.model_type} の定義を保存しました`)
    } else notify('error', 'モデル定義を保存できませんでした', r.error.message)
  }
  const saveRelation = async (x: RelationDef): Promise<void> => {
    const r = await invoke<Snapshot>('ontology.saveRelation', {
      relationType: x.relation_type,
      label: x.label,
      definition: x.definition,
      requiredAttr: x.required_attr ?? '',
      iconColor: x.icon_color,
      iconText: x.icon_text,
      enabled: x.is_enabled === 1
    })
    if (r.ok) {
      setData(r.result)
      notify('info', `${x.relation_type} の定義を保存しました`)
    } else notify('error', '関係定義を保存できませんでした', r.error.message)
  }
  const toggle = async (s: string, t: string): Promise<void> => {
    const key = `${s}|${t}`,
      next = !allowed.has(key)
    const r = await invoke('ontology.setAllowance', {
      relationType: relation,
      sourceModelType: s,
      targetModelType: t,
      allowed: next
    })
    if (r.ok) await load()
    else notify('error', '許可マトリクスを保存できませんでした', r.error.message)
  }
  return (
    <section style={{ marginTop: 24 }} data-testid="ontology-settings">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h2 style={{ fontSize: 14, margin: 0 }}>設計モデル・関係設定</h2>
        <span className="d2d-badge status-success">v{data.version}</span>
        <button
          className="d2d-btn primary small"
          onClick={() =>
            void invoke<{ version: string }>('ontology.confirm').then((r) => {
              if (r.ok) {
                notify('info', `オントロジー v${r.result.version} を確定しました`)
                void load()
              }
            })
          }
        >
          設定を確定して版更新
        </button>
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: 'var(--d2d-fg-muted)',
          border: '1px solid var(--d2d-border)',
          padding: 10,
          marginTop: 10
        }}
        data-testid="ontology-setting-guide"
      >
        <b>設定方法</b>
        <ol style={{ margin: '6px 0 0', paddingLeft: 20 }}>
          <li>設計モデルの日本語定義と属性定義を編集し、モデルごとの「保存」を押します。</li>
          <li>属性は追加・無効化・削除できます。無効化した属性は既存データを残したまま編集画面から除外されます。</li>
          <li>関係定義と許可マトリクスを調整し、内容が確定したら「設定を確定して版更新」を押します。</li>
        </ol>
        定義は③中間データから④設計モデルと関係を導出する際の入力です。モデル自体は削除せず無効化します。
      </div>
      <details open>
        <summary>
          <b>設計モデル定義（{data.models.length}）</b>
        </summary>
        {data.models.map((m, i) => (
          <div
            key={m.model_type}
            style={{ border: '1px solid var(--d2d-border)', padding: 8, margin: '6px 0', borderRadius: 4 }}
          >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code>{m.model_type}</code>
              <input
                value={m.label}
                aria-label={`${m.model_type} 表示名`}
                onChange={(e) =>
                  setData(
                    (d) =>
                      d && { ...d, models: d.models.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }
                  )
                }
              />
              <input
                value={m.layer}
                aria-label={`${m.model_type} 層`}
                onChange={(e) =>
                  setData(
                    (d) =>
                      d && { ...d, models: d.models.map((x, j) => (j === i ? { ...x, layer: e.target.value } : x)) }
                  )
                }
              />
              <label>
                <input
                  type="checkbox"
                  checked={m.is_enabled === 1}
                  onChange={(e) =>
                    setData(
                      (d) =>
                        d && {
                          ...d,
                          models: d.models.map((x, j) => (j === i ? { ...x, is_enabled: e.target.checked ? 1 : 0 } : x))
                        }
                    )
                  }
                />
                有効
              </label>
              <button className="d2d-btn small" onClick={() => void saveModel(m)}>
                保存
              </button>
            </div>
            <textarea
              value={m.definition}
              aria-label={`${m.model_type} 日本語定義`}
              onChange={(e) =>
                setData(
                  (d) =>
                    d && { ...d, models: d.models.map((x, j) => (j === i ? { ...x, definition: e.target.value } : x)) }
                )
              }
              style={{ width: '100%', minHeight: 55, marginTop: 6 }}
            />{' '}
            <AttributeDefinitionEditor
              value={m.field_schema_json}
              label={`${m.model_type} 属性定義`}
              onChange={(value) =>
                setData(
                  (d) =>
                    d && { ...d, models: d.models.map((x, j) => (j === i ? { ...x, field_schema_json: value } : x)) }
                )
              }
            />
          </div>
        ))}
        <div
          style={{
            border: '1px dashed var(--d2d-border)',
            padding: 8,
            display: 'grid',
            gridTemplateColumns: '1fr 100px 1fr 1fr auto',
            gap: 6
          }}
        >
          <input
            value={newModel.modelType}
            onChange={(e) => setNewModel((v) => ({ ...v, modelType: e.target.value }))}
            placeholder="model_xxx"
          />
          <input
            value={newModel.codePrefix}
            onChange={(e) => setNewModel((v) => ({ ...v, codePrefix: e.target.value.toUpperCase() }))}
            placeholder="PREFIX"
          />
          <input
            value={newModel.label}
            onChange={(e) => setNewModel((v) => ({ ...v, label: e.target.value }))}
            placeholder="表示名"
          />
          <input
            value={newModel.layer}
            onChange={(e) => setNewModel((v) => ({ ...v, layer: e.target.value }))}
            placeholder="層"
          />
          <button
            className="d2d-btn"
            onClick={() =>
              void invoke<Snapshot>('ontology.saveModel', { ...newModel, enabled: true }).then((r) => {
                if (r.ok) {
                  setData(r.result)
                  setNewModel({
                    modelType: 'model_',
                    codePrefix: '',
                    label: '',
                    layer: '',
                    definition: '',
                    fieldSchemaJson: '[]'
                  })
                } else notify('error', 'モデルを追加できませんでした', r.error.message)
              })
            }
          >
            model_*を追加
          </button>
          <textarea
            value={newModel.definition}
            onChange={(e) => setNewModel((v) => ({ ...v, definition: e.target.value }))}
            placeholder="日本語定義"
            style={{ gridColumn: '1 / -1', minHeight: 50 }}
          />{' '}
          <div style={{ gridColumn: '1 / -1' }}>
            <AttributeDefinitionEditor
              value={newModel.fieldSchemaJson}
              label="追加するモデルの属性定義"
              onChange={(value) => setNewModel((v) => ({ ...v, fieldSchemaJson: value }))}
            />
          </div>
        </div>
      </details>
      <details open style={{ marginTop: 12 }}>
        <summary>
          <b>設計モデル関係定義（{data.relations.length}）</b>
        </summary>
        {data.relations.map((r, i) => (
          <div
            key={r.relation_type}
            style={{
              display: 'grid',
              gridTemplateColumns: '130px 120px minmax(240px,1fr) 150px 70px 70px auto auto',
              gap: 6,
              margin: '6px 0',
              alignItems: 'start'
            }}
          >
            <code>{r.relation_type}</code>
            <input
              value={r.label}
              onChange={(e) =>
                setData(
                  (d) =>
                    d && { ...d, relations: d.relations.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) }
                )
              }
            />
            <textarea
              value={r.definition}
              onChange={(e) =>
                setData(
                  (d) =>
                    d && {
                      ...d,
                      relations: d.relations.map((x, j) => (j === i ? { ...x, definition: e.target.value } : x))
                    }
                )
              }
            />{' '}
            <input
              value={r.required_attr ?? ''}
              placeholder="必須属性（任意）"
              aria-label={`${r.relation_type} 必須属性`}
              onChange={(e) =>
                setData(
                  (d) =>
                    d && {
                      ...d,
                      relations: d.relations.map((x, j) =>
                        j === i ? { ...x, required_attr: e.target.value || null } : x
                      )
                    }
                )
              }
            />
            <input
              type="color"
              value={r.icon_color}
              aria-label={`${r.relation_type} アイコン背景色`}
              onChange={(e) =>
                setData(
                  (d) =>
                    d && {
                      ...d,
                      relations: d.relations.map((x, j) => (j === i ? { ...x, icon_color: e.target.value } : x))
                    }
                )
              }
            />
            <input
              value={r.icon_text}
              maxLength={8}
              placeholder="表示文字"
              aria-label={`${r.relation_type} アイコン文字`}
              onChange={(e) =>
                setData(
                  (d) =>
                    d && {
                      ...d,
                      relations: d.relations.map((x, j) => (j === i ? { ...x, icon_text: e.target.value } : x))
                    }
                )
              }
            />
            <label>
              <input
                type="checkbox"
                checked={r.is_enabled === 1}
                onChange={(e) =>
                  setData(
                    (d) =>
                      d && {
                        ...d,
                        relations: d.relations.map((x, j) =>
                          j === i ? { ...x, is_enabled: e.target.checked ? 1 : 0 } : x
                        )
                      }
                  )
                }
              />
              有効
            </label>
            <button className="d2d-btn small" onClick={() => void saveRelation(r)}>
              保存
            </button>
          </div>
        ))}
        <div
          style={{ display: 'grid', gridTemplateColumns: '130px 120px minmax(240px,1fr) 150px 70px 70px auto', gap: 6 }}
        >
          <input
            value={newRelation.relationType}
            onChange={(e) => setNewRelation((v) => ({ ...v, relationType: e.target.value }))}
            placeholder="relation_type"
          />
          <input
            value={newRelation.label}
            onChange={(e) => setNewRelation((v) => ({ ...v, label: e.target.value }))}
            placeholder="表示名"
          />
          <textarea
            value={newRelation.definition}
            onChange={(e) => setNewRelation((v) => ({ ...v, definition: e.target.value }))}
            placeholder="日本語定義"
          />{' '}
          <input
            value={newRelation.requiredAttr}
            onChange={(e) => setNewRelation((v) => ({ ...v, requiredAttr: e.target.value }))}
            placeholder="必須属性（任意）"
          />
          <input
            type="color"
            value={newRelation.iconColor}
            aria-label="追加する関係のアイコン背景色"
            onChange={(e) => setNewRelation((v) => ({ ...v, iconColor: e.target.value }))}
          />
          <input
            value={newRelation.iconText}
            maxLength={8}
            placeholder="表示文字"
            aria-label="追加する関係のアイコン文字"
            onChange={(e) => setNewRelation((v) => ({ ...v, iconText: e.target.value }))}
          />
          <button
            className="d2d-btn"
            onClick={() =>
              void invoke<Snapshot>('ontology.saveRelation', { ...newRelation, enabled: true }).then((r) => {
                if (r.ok) {
                  setData(r.result)
                  setNewRelation({
                    relationType: '',
                    label: '',
                    definition: '',
                    requiredAttr: '',
                    iconColor: '#9099a8',
                    iconText: '?'
                  })
                } else notify('error', '関係を追加できませんでした', r.error.message)
              })
            }
          >
            関係を追加
          </button>
        </div>
      </details>
      <details open style={{ marginTop: 12 }}>
        <summary>
          <b>関係許可マトリクス</b>
        </summary>
        <label>
          関係種別{' '}
          <select value={relation} onChange={(e) => setRelation(e.target.value)}>
            {data.relations.map((r) => (
              <option key={r.relation_type} value={r.relation_type}>
                {r.relation_type} — {r.label}
              </option>
            ))}
          </select>
        </label>
        {relation === 'based_on' ? (
          <p style={{ fontSize: 12 }}>
            based_on は model_* → ②③Resource に固定し、設計モデル間マトリクスの対象外です。
          </p>
        ) : (
          <div style={{ overflow: 'auto', maxHeight: 520, marginTop: 8 }}>
            <table className="d2d-table" style={{ fontSize: 10 }}>
              <thead>
                <tr>
                  <th>Source＼Target</th>
                  {data.models.map((m) => (
                    <th
                      key={m.model_type}
                      title={`${m.label}${m.is_enabled === 1 ? '' : '（無効）'}`}
                      style={{ writingMode: 'vertical-rl', opacity: m.is_enabled === 1 ? 1 : 0.45 }}
                    >
                      {m.model_type}
                      {m.is_enabled === 1 ? '' : '（無効）'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.models.map((s) => (
                  <tr key={s.model_type}>
                    <th style={{ opacity: s.is_enabled === 1 ? 1 : 0.45 }}>
                      {s.model_type}
                      {s.is_enabled === 1 ? '' : '（無効）'}
                    </th>
                    {data.models.map((t) => {
                      const on = allowed.has(`${s.model_type}|${t.model_type}`)
                      return (
                        <td
                          key={t.model_type}
                          style={{
                            textAlign: 'center',
                            background: on ? 'color-mix(in srgb, var(--d2d-accent) 20%, transparent)' : undefined
                          }}
                        >
                          <input
                            type="checkbox"
                            aria-label={`${relation} ${s.model_type} to ${t.model_type}`}
                            checked={on}
                            onChange={() => void toggle(s.model_type, t.model_type)}
                          />
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </details>
    </section>
  )
}

function AttributeDefinitionEditor({
  value,
  label,
  onChange
}: {
  value: string
  label: string
  onChange: (value: string) => void
}): React.JSX.Element {
  let fields: FieldDef[] = []
  try {
    fields = JSON.parse(value) as FieldDef[]
  } catch {
    fields = []
  }
  const update = (next: FieldDef[]): void => onChange(JSON.stringify(next))
  const patch = (index: number, changes: Partial<FieldDef>): void =>
    update(fields.map((field, i) => (i === index ? { ...field, ...changes } : field)))
  return (
    <fieldset
      style={{ marginTop: 8, border: '1px solid var(--d2d-border)' }}
      data-testid={`attribute-definitions-${label}`}
    >
      <legend>{label}</legend>
      {fields.map((field, index) => (
        <div
          key={`${field.key}-${index}`}
          style={{
            display: 'grid',
            gridTemplateColumns: '120px 140px 100px minmax(180px,1fr) auto auto',
            gap: 6,
            marginBottom: 6,
            opacity: field.is_enabled === 0 ? 0.55 : 1
          }}
        >
          <input
            value={field.key}
            aria-label={`${label} キー ${index + 1}`}
            onChange={(event) => patch(index, { key: event.target.value })}
          />
          <input
            value={field.label}
            aria-label={`${label} 表示名 ${index + 1}`}
            onChange={(event) => patch(index, { label: event.target.value })}
          />
          <select
            value={field.type}
            aria-label={`${label} 型 ${index + 1}`}
            onChange={(event) =>
              patch(index, {
                type: event.target.value as FieldDef['type'],
                options: event.target.value === 'select' ? (field.options ?? ['選択肢']) : undefined
              })
            }
          >
            {['text', 'multiline', 'json', 'select'].map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
          <input
            value={field.description}
            aria-label={`${label} 説明 ${index + 1}`}
            onChange={(event) => patch(index, { description: event.target.value })}
          />
          <button
            type="button"
            className="d2d-btn small"
            onClick={() => patch(index, { is_enabled: field.is_enabled === 0 ? 1 : 0 })}
          >
            {field.is_enabled === 0 ? '有効化' : '無効化'}
          </button>
          <button
            type="button"
            className="d2d-btn small danger"
            onClick={() => update(fields.filter((_, i) => i !== index))}
          >
            削除
          </button>
          {field.type === 'select' && (
            <input
              style={{ gridColumn: '1 / -1' }}
              value={(field.options ?? []).join(',')}
              aria-label={`${label} 選択肢 ${index + 1}`}
              onChange={(event) =>
                patch(index, {
                  options: event.target.value
                    .split(',')
                    .map((item) => item.trim())
                    .filter(Boolean)
                })
              }
              placeholder="選択肢（カンマ区切り）"
            />
          )}
        </div>
      ))}
      <button
        type="button"
        className="d2d-btn small"
        onClick={() =>
          update([
            ...fields,
            {
              key: `field_${fields.length + 1}`,
              label: '新しい属性',
              type: 'text',
              description: '属性の説明',
              is_enabled: 1
            }
          ])
        }
        data-testid={`add-attribute-${label}`}
      >
        + 属性を追加
      </button>
    </fieldset>
  )
}
