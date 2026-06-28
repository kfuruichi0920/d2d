// T405: 種別別編集フォーム（Monaco なし・styled textarea で代替）

import React, { useState, useEffect, useCallback } from 'react'
import type { ResourceRow, ResourceEntityType } from '../../types/d2d-api'

interface Props {
  resource: ResourceRow
  onSaved?: () => void
}

// --- tiny helpers ---
function CodeArea({
  label,
  value,
  onChange,
  lang = '',
  rows = 10,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  lang?: string
  rows?: number
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={labelStyle}>{label}{lang && <span style={{ marginLeft: 6, opacity: 0.5, fontSize: 10 }}>{lang}</span>}</label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        spellCheck={false}
        style={{
          ...inputStyle,
          fontFamily: 'monospace',
          fontSize: 12,
          resize: 'vertical',
          lineHeight: 1.5,
        }}
      />
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
  multiline = false,
  placeholder = '',
}: {
  label: string
  value: string
  onChange: (v: string) => void
  multiline?: boolean
  placeholder?: string
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          placeholder={placeholder}
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          style={inputStyle}
        />
      )}
    </div>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: { value: string; label: string }[]
  onChange: (v: string) => void
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle}>
        <option value="">（未設定）</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

// --- 各リソースの extra fields 読み込み ---
async function fetchExtra(uid: string, entityType: ResourceEntityType): Promise<Record<string, unknown>> {
  const rows = await window.api.store.query(
    `SELECT * FROM ${entityType} WHERE uid = ?`,
    [uid]
  )
  return (rows[0] as Record<string, unknown>) ?? {}
}

export function ResourceEditForm({ resource, onSaved }: Props): React.JSX.Element {
  const [extra, setExtra] = useState<Record<string, unknown>>({})
  const [fields, setFields] = useState<Record<string, unknown>>({})
  const [title, setTitle] = useState(resource.title)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    fetchExtra(resource.uid, resource.entity_type as ResourceEntityType).then((e) => {
      setExtra(e)
      setFields({ ...e })
      setTitle(resource.title)
      setSavedAt(null)
    })
  }, [resource.uid, resource.entity_type, resource.title])

  const set = useCallback((key: string, val: unknown) => {
    setFields((prev) => ({ ...prev, [key]: val }))
  }, [])

  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      // title は entity_registry に
      if (title !== resource.title) {
        await window.api.store.execute(
          'UPDATE entity_registry SET title = ?, updated_at = strftime(\'%Y-%m-%dT%H:%M:%SZ\',\'now\') WHERE uid = ?',
          [title, resource.uid]
        )
      }
      // type-specific fields
      const changedFields: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(fields)) {
        if (k === 'uid') continue
        if (v !== extra[k]) changedFields[k] = v
      }
      if (Object.keys(changedFields).length > 0) {
        await window.api.design.updateField(resource.uid, resource.entity_type as ResourceEntityType, changedFields)
      }
      setSavedAt(new Date().toLocaleTimeString())
      onSaved?.()
    } finally {
      setSaving(false)
    }
  }, [fields, extra, title, resource.uid, resource.entity_type, resource.title, onSaved])

  const s = (key: string): string => String(fields[key] ?? '')
  const type = resource.entity_type

  return (
    <div>
      {/* 共通: タイトル */}
      <TextField label="タイトル" value={title} onChange={setTitle} />

      {/* ---- resource_label ---- */}
      {type === 'resource_label' && <>
        <TextField label="ラベルテキスト" value={s('label_text')} onChange={(v) => set('label_text', v)} />
        <SelectField label="種別" value={s('label_kind')} options={[
          { value: 'document', label: '文書' }, { value: 'chapter', label: '章' },
          { value: 'section', label: '節' }, { value: 'item', label: '項目' },
          { value: 'figure', label: '図' }, { value: 'table', label: '表' },
          { value: 'model', label: 'モデル' }, { value: 'other', label: 'その他' },
        ]} onChange={(v) => set('label_kind', v)} />
        <TextField label="採番" value={s('numbering')} onChange={(v) => set('numbering', v)} />
      </>}

      {/* ---- resource_text ---- */}
      {type === 'resource_text' && <>
        <SelectField label="役割" value={s('text_role')} options={[
          { value: 'body', label: '本文' }, { value: 'description', label: '説明' },
          { value: 'note', label: '注記' }, { value: 'remark', label: '備考' },
          { value: 'footnote', label: '脚注' }, { value: 'comment', label: 'コメント' },
          { value: 'other', label: 'その他' },
        ]} onChange={(v) => set('text_role', v)} />
        <TextField label="言語" value={s('language')} onChange={(v) => set('language', v)} placeholder="ja / en ..." />
        <CodeArea label="本文" value={s('text_body')} onChange={(v) => set('text_body', v)} rows={12} />
      </>}

      {/* ---- resource_list ---- */}
      {type === 'resource_list' && <>
        <SelectField label="リスト種別" value={s('list_kind')} options={[
          { value: 'ordered', label: '番号付き' }, { value: 'unordered', label: '箇条書き' },
          { value: 'check', label: 'チェックリスト' }, { value: 'definition', label: '定義リスト' },
          { value: 'other', label: 'その他' },
        ]} onChange={(v) => set('list_kind', v)} />
        <JsonArrayEditor
          label="アイテム"
          value={s('items_json')}
          onChange={(v) => set('items_json', v)}
          placeholder='[{"text":"項目1","level":0},{"text":"項目2","level":1}]'
        />
      </>}

      {/* ---- resource_code ---- */}
      {type === 'resource_code' && <>
        <SelectField label="種別" value={s('code_kind')} options={[
          { value: 'source', label: 'ソースコード' }, { value: 'pseudo', label: '擬似コード' },
          { value: 'sql', label: 'SQL' }, { value: 'config', label: '設定' },
          { value: 'command', label: 'コマンド' }, { value: 'idl', label: 'IDL' },
          { value: 'schema', label: 'スキーマ' }, { value: 'other', label: 'その他' },
        ]} onChange={(v) => set('code_kind', v)} />
        <TextField label="言語" value={s('language')} onChange={(v) => set('language', v)} placeholder="TypeScript / Python / SQL ..." />
        <CodeArea label="コード" value={s('code_text')} onChange={(v) => set('code_text', v)} lang={s('language')} rows={16} />
      </>}

      {/* ---- resource_model ---- */}
      {type === 'resource_model' && <>
        <TextField label="モデル名" value={s('model_name')} onChange={(v) => set('model_name', v)} />
        <SelectField label="記法" value={s('model_kind')} options={[
          { value: 'uml', label: 'UML' }, { value: 'sysml', label: 'SysML' },
          { value: 'er', label: 'ER図' }, { value: 'dfd', label: 'DFD' },
          { value: 'bpmn', label: 'BPMN' }, { value: 'mermaid', label: 'Mermaid' },
          { value: 'plantuml', label: 'PlantUML' }, { value: 'other', label: 'その他' },
        ]} onChange={(v) => set('model_kind', v)} />
        <SelectField label="フォーマット" value={s('model_format')} options={[
          { value: 'text', label: 'テキスト' }, { value: 'json', label: 'JSON' },
          { value: 'xmi', label: 'XMI' }, { value: 'image', label: '画像' },
          { value: 'other', label: 'その他' },
        ]} onChange={(v) => set('model_format', v)} />
        <CodeArea label="モデルソース" value={s('model_source')} onChange={(v) => set('model_source', v)} lang={s('model_kind')} rows={14} />
      </>}

      {/* ---- resource_scenario ---- */}
      {type === 'resource_scenario' && <>
        <TextField label="シナリオ名" value={s('scenario_name')} onChange={(v) => set('scenario_name', v)} />
        <TextField label="トリガー" value={s('trigger_text')} onChange={(v) => set('trigger_text', v)} multiline />
        <JsonArrayEditor label="アクター" value={s('actors_json')} onChange={(v) => set('actors_json', v)} placeholder='["ユーザー","システム"]' />
        <JsonStepsEditor value={s('steps_json')} onChange={(v) => set('steps_json', v)} />
        <TextField label="事前条件" value={s('preconditions_json')} onChange={(v) => set('preconditions_json', v)} multiline placeholder='["ログイン済み"]' />
        <TextField label="事後条件" value={s('postconditions_json')} onChange={(v) => set('postconditions_json', v)} multiline placeholder='["データが保存された"]' />
      </>}

      {/* ---- resource_interface ---- */}
      {type === 'resource_interface' && <>
        <TextField label="インターフェース名" value={s('interface_name')} onChange={(v) => set('interface_name', v)} />
        <SelectField label="種別" value={s('interface_kind')} options={[
          { value: 'api', label: 'API' }, { value: 'communication', label: '通信' },
          { value: 'file', label: 'ファイル' }, { value: 'db', label: 'DB' },
          { value: 'screen', label: '画面' }, { value: 'device', label: 'デバイス' },
          { value: 'library', label: 'ライブラリ' }, { value: 'other', label: 'その他' },
        ]} onChange={(v) => set('interface_kind', v)} />
        <TextField label="提供者" value={s('provider')} onChange={(v) => set('provider', v)} />
        <TextField label="利用者" value={s('consumer')} onChange={(v) => set('consumer', v)} />
        <TextField label="プロトコル" value={s('protocol')} onChange={(v) => set('protocol', v)} />
        <JsonArrayEditor label="操作一覧 (JSON)" value={s('operations_json')} onChange={(v) => set('operations_json', v)}
          placeholder='[{"name":"getUser","method":"GET","path":"/users/{id}"}]' />
      </>}

      {/* ---- resource_data_structure ---- */}
      {type === 'resource_data_structure' && <>
        <TextField label="データ構造名" value={s('data_structure_name')} onChange={(v) => set('data_structure_name', v)} />
        <SelectField label="種別" value={s('data_structure_kind')} options={[
          { value: 'db_table', label: 'DBテーブル' }, { value: 'message', label: 'メッセージ' },
          { value: 'file', label: 'ファイル' }, { value: 'struct', label: '構造体' },
          { value: 'record', label: 'レコード' }, { value: 'screen_item', label: '画面項目' },
          { value: 'other', label: 'その他' },
        ]} onChange={(v) => set('data_structure_kind', v)} />
        <FieldsEditor value={s('fields_json')} onChange={(v) => set('fields_json', v)} />
      </>}

      {/* ---- resource_formula ---- */}
      {type === 'resource_formula' && <>
        <SelectField label="種別" value={s('formula_kind')} options={[
          { value: 'calculation', label: '計算' }, { value: 'condition', label: '条件' },
          { value: 'constraint', label: '制約' }, { value: 'performance', label: '性能' },
          { value: 'other', label: 'その他' },
        ]} onChange={(v) => set('formula_kind', v)} />
        <SelectField label="フォーマット" value={s('formula_format')} options={[
          { value: 'latex', label: 'LaTeX' }, { value: 'mathml', label: 'MathML' },
          { value: 'excel', label: 'Excel' }, { value: 'plain', label: '平文' },
          { value: 'other', label: 'その他' },
        ]} onChange={(v) => set('formula_format', v)} />
        <CodeArea label="数式テキスト" value={s('formula_text')} onChange={(v) => set('formula_text', v)} rows={6} />
      </>}

      {/* フォールバック: 未対応種別はJSON直編集 */}
      {!['resource_label', 'resource_text', 'resource_list', 'resource_code', 'resource_model',
        'resource_scenario', 'resource_interface', 'resource_data_structure', 'resource_formula'].includes(type) && (
        <CodeArea label="生 JSON（上級者向け）" value={JSON.stringify(extra, null, 2)} onChange={() => {}} lang="json" rows={16} />
      )}

      {/* 保存ボタン */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 16 }}>
        <button
          onClick={handleSave}
          disabled={saving}
          style={{ padding: '6px 16px', background: 'var(--srd-color-primary, #2563eb)', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
        >
          {saving ? '保存中...' : '保存'}
        </button>
        {savedAt && <span style={{ fontSize: 12, color: '#22c55e' }}>✓ {savedAt} 保存済み</span>}
      </div>
    </div>
  )
}

// --- JSON 配列 テキストエリア ---
function JsonArrayEditor({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [raw, setRaw] = useState(value)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setRaw(value) }, [value])

  const handleChange = (v: string) => {
    setRaw(v)
    try { JSON.parse(v); setError(null); onChange(v) } catch { setError('JSON が正しくありません') }
  }
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>{label}</label>
      <textarea value={raw} onChange={(e) => handleChange(e.target.value)} rows={4}
        placeholder={placeholder}
        style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }} />
      {error && <div style={{ color: '#dc2626', fontSize: 11, marginTop: 2 }}>{error}</div>}
    </div>
  )
}

// --- シナリオステップエディタ ---
interface Step { text: string; actor?: string; result?: string }

function JsonStepsEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [steps, setSteps] = useState<Step[]>([])

  useEffect(() => {
    try { setSteps(JSON.parse(value) as Step[]) } catch { setSteps([]) }
  }, [value])

  const update = (newSteps: Step[]) => {
    setSteps(newSteps)
    onChange(JSON.stringify(newSteps))
  }

  const addStep = () => update([...steps, { text: '' }])
  const removeStep = (i: number) => update(steps.filter((_, j) => j !== i))
  const setStepField = (i: number, key: keyof Step, val: string) => {
    const copy = steps.map((s, j) => j === i ? { ...s, [key]: val } : s)
    update(copy)
  }

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>ステップ</label>
      {steps.map((step, i) => (
        <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 6, alignItems: 'flex-start' }}>
          <span style={{ minWidth: 22, paddingTop: 6, fontSize: 11, color: '#888' }}>{i + 1}.</span>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <input value={step.text} onChange={(e) => setStepField(i, 'text', e.target.value)}
              placeholder="ステップの内容" style={{ ...inputStyle, flex: 1 }} />
            <div style={{ display: 'flex', gap: 4 }}>
              <input value={step.actor ?? ''} onChange={(e) => setStepField(i, 'actor', e.target.value)}
                placeholder="アクター" style={{ ...inputStyle, flex: 1, fontSize: 11 }} />
              <input value={step.result ?? ''} onChange={(e) => setStepField(i, 'result', e.target.value)}
                placeholder="結果" style={{ ...inputStyle, flex: 1, fontSize: 11 }} />
            </div>
          </div>
          <button onClick={() => removeStep(i)} style={iconBtnStyle}>×</button>
        </div>
      ))}
      <button onClick={addStep} style={{ ...iconBtnStyle, fontSize: 12, padding: '3px 10px' }}>＋ステップ追加</button>
    </div>
  )
}

// --- データ構造フィールドエディタ ---
interface FieldDef { name: string; type?: string; required?: boolean; description?: string }

function FieldsEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [fields, setFields] = useState<FieldDef[]>([])

  useEffect(() => {
    try { setFields(JSON.parse(value) as FieldDef[]) } catch { setFields([]) }
  }, [value])

  const update = (f: FieldDef[]) => { setFields(f); onChange(JSON.stringify(f)) }
  const addField = () => update([...fields, { name: '' }])
  const remove = (i: number) => update(fields.filter((_, j) => j !== i))
  const setF = (i: number, key: keyof FieldDef, val: unknown) =>
    update(fields.map((f, j) => j === i ? { ...f, [key]: val } : f))

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={labelStyle}>フィールド定義</label>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginBottom: 6 }}>
        <thead>
          <tr style={{ background: 'var(--srd-color-surface-variant)' }}>
            {['フィールド名', '型', '必須', '説明', ''].map((h) => (
              <th key={h} style={{ padding: '3px 6px', textAlign: 'left', fontSize: 11, border: '1px solid var(--srd-color-border)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fields.map((f, i) => (
            <tr key={i}>
              <td style={tdStyle}><input value={f.name} onChange={(e) => setF(i, 'name', e.target.value)} style={{ ...inputStyle, width: '100%', padding: '2px 4px' }} /></td>
              <td style={tdStyle}><input value={f.type ?? ''} onChange={(e) => setF(i, 'type', e.target.value)} style={{ ...inputStyle, width: '100%', padding: '2px 4px' }} placeholder="string" /></td>
              <td style={{ ...tdStyle, textAlign: 'center', width: 40 }}><input type="checkbox" checked={!!f.required} onChange={(e) => setF(i, 'required', e.target.checked)} /></td>
              <td style={tdStyle}><input value={f.description ?? ''} onChange={(e) => setF(i, 'description', e.target.value)} style={{ ...inputStyle, width: '100%', padding: '2px 4px' }} /></td>
              <td style={{ ...tdStyle, width: 24 }}><button onClick={() => remove(i)} style={iconBtnStyle}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={addField} style={{ ...iconBtnStyle, fontSize: 12, padding: '3px 10px' }}>＋フィールド追加</button>
    </div>
  )
}

// --- styles ---
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 11, fontWeight: 600,
  color: 'var(--srd-color-on-surface-variant)', marginBottom: 4,
}
const inputStyle: React.CSSProperties = {
  display: 'block', width: '100%', boxSizing: 'border-box',
  padding: '5px 8px',
  background: 'var(--srd-color-surface)',
  color: 'var(--srd-color-on-surface)',
  border: '1px solid var(--srd-color-border)',
  borderRadius: 4, fontSize: 13,
}
const iconBtnStyle: React.CSSProperties = {
  padding: '3px 6px', background: 'var(--srd-color-surface-variant)',
  color: 'var(--srd-color-on-surface)', border: '1px solid var(--srd-color-border)',
  borderRadius: 4, cursor: 'pointer', fontSize: 12,
}
const tdStyle: React.CSSProperties = {
  padding: 2, border: '1px solid var(--srd-color-border)',
}
