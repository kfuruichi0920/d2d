/** オントロジー設定のDB正本（MODEL-019〜028 / schema 2.0.0）。 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'

export interface OntologyFieldDefinition {
  key: string
  label: string
  type: 'text' | 'multiline' | 'json' | 'select'
  description: string
  options?: string[]
  is_enabled?: number
}
export interface OntologyModelDefinition {
  model_type: string
  code_prefix: string
  label: string
  layer: string
  definition: string
  field_schema_json: string
  is_enabled: number
  is_builtin: number
  sort_order: number
}
export interface OntologyRelationDefinition {
  relation_type: string
  label: string
  definition: string
  required_attr: string | null
  is_enabled: number
  is_builtin: number
  sort_order: number
}
export interface OntologyAllowance {
  relation_type: string
  source_model_type: string
  target_model_type: string
  allowed: number
}
export interface OntologySnapshot {
  version: string
  models: OntologyModelDefinition[]
  relations: OntologyRelationDefinition[]
  allowances: OntologyAllowance[]
}

const f = (
  key: string,
  label: string,
  type: OntologyFieldDefinition['type'],
  description: string,
  options?: string[]
): OntologyFieldDefinition => ({ key, label, type, description, ...(options ? { options } : {}) })
const MODELS: Array<
  Omit<OntologyModelDefinition, 'field_schema_json' | 'is_enabled' | 'is_builtin'> & {
    fields: OntologyFieldDefinition[]
  }
> = [
  {
    model_type: 'model_src',
    code_prefix: 'SRC',
    label: '一次情報',
    layer: '根拠',
    definition: '原本文書、章、節、段落、図、表、数式、注記など、設計判断の一次根拠を表す。',
    sort_order: 10,
    fields: [
      f('source_kind', '一次情報種別', 'text', '文書、章、節、図、表などの種別'),
      f('locator', '所在', 'text', '原本内の位置'),
      f('excerpt', '根拠抜粋', 'multiline', '根拠となる原文')
    ]
  },
  {
    model_type: 'model_std',
    code_prefix: 'STD',
    label: '規範',
    layer: '根拠',
    definition: '法律、規則、規約、業務規則、社内標準、外部標準など、設計が従う規範を表す。',
    sort_order: 20,
    fields: [
      f('standard_id', '規範ID', 'text', '規格番号や規則ID'),
      f('clause', '条項', 'text', '適用条項'),
      f('authority', '制定主体', 'text', '規範を定めた主体')
    ]
  },
  {
    model_type: 'model_req',
    code_prefix: 'REQ',
    label: '要求',
    layer: '要求',
    definition: '上位要求、派生要求、機能要求、非機能要求など、実現すべき内容を表す。',
    sort_order: 30,
    fields: [
      f('requirement_kind', '要求種別', 'text', '上位、派生、機能、非機能など'),
      f('priority', '優先度', 'text', '要求の優先度'),
      f('acceptance_criteria', '受入基準', 'multiline', '要求を満たしたと判断する基準')
    ]
  },
  {
    model_type: 'model_cst',
    code_prefix: 'CST',
    label: '制約',
    layer: '要求',
    definition: '法規、性能、安全、運用、実装など、設計上守るべき制限を表す。',
    sort_order: 40,
    fields: [
      f('constraint_kind', '制約種別', 'text', '法規、性能、安全、運用、実装など'),
      f('condition', '適用条件', 'multiline', '制約が適用される条件'),
      f('limit', '制限値', 'text', '上限、下限、禁止条件など')
    ]
  },
  {
    model_type: 'model_func',
    code_prefix: 'FUNC',
    label: '機能',
    layer: '論理設計',
    definition: '機能、サブ機能、機能責務など、システムが提供する論理的な働きを表す。',
    sort_order: 50,
    fields: [
      f('responsibility', '責務', 'multiline', '機能が担う責務'),
      f('inputs', '入力', 'json', '機能への入力'),
      f('outputs', '出力', 'json', '機能からの出力')
    ]
  },
  {
    model_type: 'model_struct',
    code_prefix: 'STRUCT',
    label: '構造',
    layer: '論理設計',
    definition:
      'システム、装置、ソフトウェア、サービス、コンポーネント、モジュール、プロセス、タスク等の構造要素を表す。物理構造に限定しない。',
    sort_order: 60,
    fields: [
      f('structure_kind', '構造種別', 'select', '構造要素の下位種別', [
        'system',
        'subsystem',
        'device',
        'software',
        'service',
        'component',
        'module',
        'process',
        'task',
        'physical'
      ]),
      f('responsibility', '責務', 'multiline', '構造要素が担う責務')
    ]
  },
  {
    model_type: 'model_action',
    code_prefix: 'ACTION',
    label: '振舞',
    layer: '論理設計',
    definition: 'シナリオ、処理手順、イベント、アクションなど、時間順序を持つ振舞を表す。',
    sort_order: 70,
    fields: [
      f('trigger', 'トリガー', 'text', '振舞を開始する契機'),
      f('preconditions', '事前条件', 'json', '開始前に成立すべき条件'),
      f('steps', '処理手順', 'json', '順序、条件分岐を含む処理'),
      f('postconditions', '事後条件', 'json', '完了後に成立する条件')
    ]
  },
  {
    model_type: 'model_state',
    code_prefix: 'STATE',
    label: '状態',
    layer: '論理設計',
    definition: '状態モデル、状態、状態遷移、遷移条件を表す。遷移はモデル内部で管理する。',
    sort_order: 80,
    fields: [
      f('initial_state', '初期状態', 'text', '開始時の状態'),
      f('states', '状態一覧', 'json', '状態の定義'),
      f('transitions', '遷移一覧', 'json', 'イベント、条件、アクションを含む遷移')
    ]
  },
  {
    model_type: 'model_data',
    code_prefix: 'DATA',
    label: 'データモデル',
    layer: '情報・契約',
    definition: 'データ項目、データ構造、メッセージ、ER、表定義など、情報の構造を表す。',
    sort_order: 90,
    fields: [
      f('data_kind', 'データ種別', 'text', '項目、構造、メッセージ、ER、表など'),
      f('fields', '項目定義', 'json', '名称、型、必須性等の項目'),
      f('constraints', 'データ制約', 'json', 'キー、範囲、整合性等の制約')
    ]
  },
  {
    model_type: 'model_if',
    code_prefix: 'IF',
    label: 'インタフェース',
    layer: '情報・契約',
    definition: '外部IF、内部IF、API、通信、信号、入出力など、要素間の契約を表す。',
    sort_order: 100,
    fields: [
      f('interface_kind', 'IF種別', 'text', 'API、通信、ファイル、DB、画面、装置等'),
      f('provider', '提供側', 'text', 'インタフェース提供主体'),
      f('consumer', '利用側', 'text', 'インタフェース利用主体'),
      f('protocol', 'プロトコル', 'text', '通信・交換規約'),
      f('operations', '操作・入出力', 'json', '操作、引数、戻り値、エラー等')
    ]
  },
  {
    model_type: 'model_verif',
    code_prefix: 'VERIF',
    label: '検証情報',
    layer: '評価',
    definition: '試験項目、確認観点、検証条件、手順、期待結果など、設計を評価する情報を表す。',
    sort_order: 110,
    fields: [
      f('verification_kind', '検証種別', 'text', '試験、解析、レビュー等'),
      f('condition', '検証条件', 'multiline', '検証を実施する条件'),
      f('procedure', '手順', 'multiline', '検証手順'),
      f('expected_result', '期待結果', 'multiline', '合格と判断する結果')
    ]
  },
  {
    model_type: 'model_impl',
    code_prefix: 'IMPL',
    label: '実装',
    layer: '実現',
    definition: 'ソースコード、設定、DDL、ビルド定義、実装関数、API実装など、設計の実現物を表す。',
    sort_order: 120,
    fields: [
      f('implementation_kind', '実装種別', 'text', 'コード、設定、DDL、ビルド、関数等'),
      f('location', '実装位置', 'text', 'ファイル、URI、リポジトリ等'),
      f('symbol', 'シンボル', 'text', '関数、型、テーブル等の識別子')
    ]
  },
  {
    model_type: 'model_mgmt',
    code_prefix: 'MGMT',
    label: '知識・管理',
    layer: '知識・管理',
    definition: '設計判断、根拠、仮定、未決、リスク、課題、変更要求など、設計知識と管理情報を表す。',
    sort_order: 130,
    fields: [
      f('management_kind', '管理種別', 'text', '判断、根拠、仮定、課題、変更等'),
      f('decision', '判断内容', 'multiline', '確定した判断'),
      f('rationale', '判断根拠', 'multiline', '判断理由'),
      f('assumption', '仮定', 'multiline', '成立を仮定している事項'),
      f('issue', '課題', 'multiline', '未解決事項'),
      f('change', '変更', 'multiline', '変更内容と理由')
    ]
  }
]

const RELATIONS: OntologyRelationDefinition[] = [
  {
    relation_type: 'based_on',
    label: '根拠',
    definition:
      '設計モデルが②抽出データまたは③中間データのどの一次情報に基づくかを表す。設計モデル間の意味関係には使用しない。',
    required_attr: 'basis_kind',
    is_enabled: 1,
    is_builtin: 1,
    sort_order: 10
  },
  {
    relation_type: 'satisfies',
    label: '充足',
    definition: '設計要素が規範、要求または制約を満たすことを表す。',
    required_attr: null,
    is_enabled: 1,
    is_builtin: 1,
    sort_order: 20
  },
  {
    relation_type: 'allocated_to',
    label: '割当',
    definition: '機能または責務を構造、振舞、状態へ割り当てる。',
    required_attr: 'allocation_kind',
    is_enabled: 1,
    is_builtin: 1,
    sort_order: 30
  },
  {
    relation_type: 'verifies',
    label: '検証',
    definition: '検証情報が対象の規範、要求、制約または設計要素を確認することを表す。',
    required_attr: null,
    is_enabled: 1,
    is_builtin: 1,
    sort_order: 40
  },
  {
    relation_type: 'contains',
    label: '包含',
    definition: '同一設計モデル種別内の階層的包含を表す。自己包含と循環包含を許可しない。',
    required_attr: null,
    is_enabled: 1,
    is_builtin: 1,
    sort_order: 50
  },
  {
    relation_type: 'implements',
    label: '実装',
    definition: '実装要素が設計モデルを実現することを表す。',
    required_attr: null,
    is_enabled: 1,
    is_builtin: 1,
    sort_order: 60
  },
  {
    relation_type: 'uses',
    label: '利用',
    definition: '設計要素が機能、状態、インタフェースまたはデータを利用することを表す。',
    required_attr: 'usage_kind',
    is_enabled: 1,
    is_builtin: 1,
    sort_order: 70
  },
  {
    relation_type: 'calls',
    label: '呼出',
    definition: '実装要素が別の実装要素を呼び出すことを表す。',
    required_attr: null,
    is_enabled: 1,
    is_builtin: 1,
    sort_order: 80
  },
  {
    relation_type: 'conflicts_with',
    label: '競合',
    definition: '二つの設計モデルが同時に成立しない、矛盾する、または競合する可能性を表す。',
    required_attr: 'conflict_status',
    is_enabled: 1,
    is_builtin: 1,
    sort_order: 90
  },
  {
    relation_type: 'relates_to',
    label: '暫定関連',
    definition: '適切な意味関係が未確定な場合だけ使用する暫定関係。レビュー後に具体的な関係へ置換する。',
    required_attr: 'review_status',
    is_enabled: 1,
    is_builtin: 1,
    sort_order: 100
  }
]
const mt = (short: string): string =>
  (
    ({
      SRC: 'model_src',
      STD: 'model_std',
      REQ: 'model_req',
      CST: 'model_cst',
      FUNC: 'model_func',
      STRUCT: 'model_struct',
      ACTION: 'model_action',
      STATE: 'model_state',
      DATA: 'model_data',
      IF: 'model_if',
      VERIF: 'model_verif',
      IMPL: 'model_impl',
      MGMT: 'model_mgmt'
    }) as Record<string, string>
  )[short]!
const cross = (relation_type: string, sources: string[], targets: string[]): OntologyAllowance[] =>
  sources.flatMap((source_model_type) =>
    targets.map((target_model_type) => ({
      relation_type,
      source_model_type: mt(source_model_type),
      target_model_type: mt(target_model_type),
      allowed: 1
    }))
  )
function initialAllowances(): OntologyAllowance[] {
  const all = ['SRC', 'STD', 'REQ', 'CST', 'FUNC', 'STRUCT', 'ACTION', 'STATE', 'DATA', 'IF', 'VERIF', 'IMPL', 'MGMT']
  return [
    ...cross('satisfies', ['FUNC', 'STRUCT', 'ACTION', 'STATE', 'IF', 'DATA', 'IMPL'], ['STD', 'REQ', 'CST']),
    ...cross('allocated_to', ['FUNC'], ['STRUCT', 'ACTION', 'STATE']),
    ...cross('allocated_to', ['STRUCT'], ['ACTION']),
    ...cross('allocated_to', ['ACTION'], ['STATE']),
    ...cross(
      'verifies',
      ['VERIF'],
      ['STD', 'REQ', 'CST', 'FUNC', 'STRUCT', 'ACTION', 'STATE', 'IF', 'DATA', 'MGMT', 'IMPL']
    ),
    ...all.map((x) => ({ relation_type: 'contains', source_model_type: mt(x), target_model_type: mt(x), allowed: 1 })),
    ...cross('implements', ['IMPL'], ['FUNC', 'STRUCT', 'ACTION', 'STATE', 'IF', 'DATA']),
    ...cross('uses', ['FUNC'], ['FUNC', 'IF', 'DATA']),
    ...cross('uses', ['STRUCT'], ['ACTION', 'DATA']),
    ...cross('uses', ['ACTION'], ['ACTION', 'STATE', 'IF', 'DATA']),
    ...cross('uses', ['STATE'], ['ACTION', 'STATE', 'IF', 'DATA']),
    ...cross('uses', ['IF'], ['DATA']),
    ...cross('calls', ['IMPL'], ['IMPL']),
    ...cross('conflicts_with', all, all),
    ...cross('relates_to', all, all)
  ]
}

export function seedOntology(db: Database): void {
  db.prepare(`INSERT OR IGNORE INTO ontology_version(singleton,version) VALUES(1,'0.1.0')`).run()
  const im = db.prepare(
    `INSERT OR IGNORE INTO ontology_model_definition(model_type,code_prefix,label,layer,definition,field_schema_json,is_enabled,is_builtin,sort_order) VALUES(?,?,?,?,?,?,1,1,?)`
  )
  for (const m of MODELS)
    im.run(m.model_type, m.code_prefix, m.label, m.layer, m.definition, JSON.stringify(m.fields), m.sort_order)
  const ir = db.prepare(
    `INSERT OR IGNORE INTO ontology_relation_definition(relation_type,label,definition,required_attr,is_enabled,is_builtin,sort_order) VALUES(?,?,?,?,1,1,?)`
  )
  for (const r of RELATIONS) ir.run(r.relation_type, r.label, r.definition, r.required_attr, r.sort_order)
  const ia = db.prepare(
    `INSERT OR IGNORE INTO ontology_relation_allowance(relation_type,source_model_type,target_model_type,allowed) VALUES(?,?,?,?)`
  )
  for (const a of initialAllowances()) ia.run(a.relation_type, a.source_model_type, a.target_model_type, a.allowed)
}

export function getOntology(db: Database): OntologySnapshot {
  const version = (db.prepare(`SELECT version FROM ontology_version WHERE singleton=1`).get() as { version: string })
    .version
  return {
    version,
    models: db
      .prepare(`SELECT * FROM ontology_model_definition ORDER BY sort_order,model_type`)
      .all() as OntologyModelDefinition[],
    relations: db
      .prepare(`SELECT * FROM ontology_relation_definition ORDER BY sort_order,relation_type`)
      .all() as OntologyRelationDefinition[],
    allowances: db
      .prepare(
        `SELECT * FROM ontology_relation_allowance WHERE allowed=1 ORDER BY relation_type,source_model_type,target_model_type`
      )
      .all() as OntologyAllowance[]
  }
}
const assertModelType = (value: string): void => {
  if (!/^model_[a-z][a-z0-9_]{0,47}$/.test(value))
    throw new BackendError('validation', 'model_type は model_ で始まる英小文字・数字・_ の名前にしてください', value)
}
const assertRelationType = (value: string): void => {
  if (!/^[a-z][a-z0-9_]{0,47}$/.test(value))
    throw new BackendError('validation', 'relation_type は英小文字・数字・_ の名前にしてください', value)
}
const FIELD_TYPES = new Set<OntologyFieldDefinition['type']>(['text', 'multiline', 'json', 'select'])

export const parseFieldSchema = (json: string): OntologyFieldDefinition[] => {
  try {
    const value = JSON.parse(json) as unknown
    if (!Array.isArray(value)) throw new Error('配列が必要です')
    if (value.length > 100) throw new Error('独自項目は100件以下にしてください')
    const keys = new Set<string>()
    return value.map((candidate, index) => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate))
        throw new Error(`[${index}] はオブジェクトにしてください`)
      const item = candidate as Record<string, unknown>
      const key = typeof item.key === 'string' ? item.key.trim() : ''
      const label = typeof item.label === 'string' ? item.label.trim() : ''
      const type = item.type
      const description = typeof item.description === 'string' ? item.description.trim() : ''
      if (!/^[a-z][a-z0-9_]{0,63}$/.test(key))
        throw new Error(`[${index}].key は英小文字で始まる英小文字・数字・_ にしてください`)
      if (keys.has(key)) throw new Error(`key が重複しています: ${key}`)
      keys.add(key)
      if (!label) throw new Error(`[${index}].label は必須です`)
      if (typeof type !== 'string' || !FIELD_TYPES.has(type as OntologyFieldDefinition['type']))
        throw new Error(`[${index}].type は text / multiline / json / select のいずれかにしてください`)
      if (!description) throw new Error(`[${index}].description は必須です`)
      let options: string[] | undefined
      if (type === 'select') {
        if (!Array.isArray(item.options) || item.options.length === 0)
          throw new Error(`[${index}].options は1件以上の文字列配列にしてください`)
        options = item.options.map((option, optionIndex) => {
          if (typeof option !== 'string' || !option.trim())
            throw new Error(`[${index}].options[${optionIndex}] は空でない文字列にしてください`)
          return option
        })
        if (new Set(options).size !== options.length) throw new Error(`[${index}].options に重複があります`)
      } else if (item.options !== undefined) {
        throw new Error(`[${index}].options は select の場合だけ指定できます`)
      }
      const isEnabled = item.is_enabled === undefined || item.is_enabled === 1 || item.is_enabled === true ? 1 : 0
      return {
        key,
        label,
        type: type as OntologyFieldDefinition['type'],
        description,
        ...(options ? { options } : {}),
        is_enabled: isEnabled
      }
    })
  } catch (e) {
    if (e instanceof BackendError) throw e
    throw new BackendError(
      'validation',
      'field_schema_json の形式が不正です',
      e instanceof Error ? e.message : String(e)
    )
  }
}

export function validateModelDetail(db: Database, modelType: string, detail: Record<string, unknown>): void {
  const row = db
    .prepare(`SELECT field_schema_json FROM ontology_model_definition WHERE model_type=?`)
    .get(modelType) as { field_schema_json: string } | undefined
  if (!row) throw new BackendError('validation', `未定義の設計モデルです: ${modelType}`, '')
  for (const field of parseFieldSchema(row.field_schema_json)) {
    if (field.is_enabled === 0) continue
    const value = detail[field.key]
    if (value === undefined || value === null || value === '') continue
    if ((field.type === 'text' || field.type === 'multiline') && typeof value !== 'string')
      throw new BackendError('validation', `${field.label} は文字列で入力してください`, field.key)
    if (field.type === 'json' && typeof value === 'string')
      throw new BackendError('validation', `${field.label} は有効なJSONとして入力してください`, field.key)
    if (field.type === 'select' && (typeof value !== 'string' || !field.options?.includes(value)))
      throw new BackendError('validation', `${field.label} は定義済みの選択肢から選んでください`, field.key)
  }
}

export function saveModelDefinition(
  db: Database,
  input: {
    modelType: string
    codePrefix?: string
    label: string
    layer: string
    definition: string
    fieldSchemaJson: string
    enabled: boolean
  }
): void {
  assertModelType(input.modelType)
  parseFieldSchema(input.fieldSchemaJson)
  const exists = db.prepare(`SELECT model_type FROM ontology_model_definition WHERE model_type=?`).get(input.modelType)
  if (!exists) {
    const prefix = (input.codePrefix ?? input.modelType.slice(6)).toUpperCase()
    if (!/^[A-Z][A-Z0-9_]{0,15}$/.test(prefix)) throw new BackendError('validation', 'code_prefix が不正です', prefix)
    db.transaction(() => {
      db.exec(
        `CREATE TABLE "${input.modelType}" (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE)`
      )
      db.prepare(
        `INSERT INTO ontology_model_definition(model_type,code_prefix,label,layer,definition,field_schema_json,is_enabled,is_builtin,sort_order) VALUES(?,?,?,?,?,?,?,0,(SELECT COALESCE(MAX(sort_order),0)+10 FROM ontology_model_definition))`
      ).run(
        input.modelType,
        prefix,
        input.label,
        input.layer,
        input.definition,
        input.fieldSchemaJson,
        input.enabled ? 1 : 0
      )
    })()
  } else
    db.prepare(
      `UPDATE ontology_model_definition SET label=?,layer=?,definition=?,field_schema_json=?,is_enabled=?,updated_at=CURRENT_TIMESTAMP WHERE model_type=?`
    ).run(input.label, input.layer, input.definition, input.fieldSchemaJson, input.enabled ? 1 : 0, input.modelType)
  eventBus.emit('ontology.updated', { kind: exists ? 'model-updated' : 'model-added', modelType: input.modelType })
}
export function saveRelationDefinition(
  db: Database,
  input: { relationType: string; label: string; definition: string; requiredAttr?: string | null; enabled: boolean }
): void {
  assertRelationType(input.relationType)
  const requiredAttr = input.requiredAttr?.trim() || null
  if (requiredAttr && !/^[a-z][a-z0-9_]{0,63}$/.test(requiredAttr))
    throw new BackendError('validation', 'required_attr が不正です', requiredAttr)
  db.prepare(
    `INSERT INTO ontology_relation_definition(relation_type,label,definition,required_attr,is_enabled,is_builtin,sort_order) VALUES(?,?,?,?,?,0,(SELECT COALESCE(MAX(sort_order),0)+10 FROM ontology_relation_definition)) ON CONFLICT(relation_type) DO UPDATE SET label=excluded.label,definition=excluded.definition,required_attr=excluded.required_attr,is_enabled=excluded.is_enabled,updated_at=CURRENT_TIMESTAMP`
  ).run(input.relationType, input.label, input.definition, requiredAttr, input.enabled ? 1 : 0)
  eventBus.emit('ontology.updated', { kind: 'relation-saved', relationType: input.relationType })
}
export function setAllowance(
  db: Database,
  input: { relationType: string; sourceModelType: string; targetModelType: string; allowed: boolean }
): void {
  assertRelationType(input.relationType)
  assertModelType(input.sourceModelType)
  assertModelType(input.targetModelType)
  if (input.relationType === 'based_on')
    throw new BackendError('validation', 'based_on は設計モデル間マトリクスでは設定できません', '')
  const relationExists = db
    .prepare(`SELECT 1 FROM ontology_relation_definition WHERE relation_type=?`)
    .get(input.relationType)
  const sourceExists = db
    .prepare(`SELECT 1 FROM ontology_model_definition WHERE model_type=?`)
    .get(input.sourceModelType)
  const targetExists = db
    .prepare(`SELECT 1 FROM ontology_model_definition WHERE model_type=?`)
    .get(input.targetModelType)
  if (!relationExists || !sourceExists || !targetExists)
    throw new BackendError('validation', '関係または設計モデルの定義が存在しません', '')
  db.prepare(
    `INSERT INTO ontology_relation_allowance(relation_type,source_model_type,target_model_type,allowed) VALUES(?,?,?,?) ON CONFLICT(relation_type,source_model_type,target_model_type) DO UPDATE SET allowed=excluded.allowed`
  ).run(input.relationType, input.sourceModelType, input.targetModelType, input.allowed ? 1 : 0)
  eventBus.emit('ontology.updated', {
    kind: 'allowance-saved',
    relationType: input.relationType,
    sourceModelType: input.sourceModelType,
    targetModelType: input.targetModelType
  })
}
export function confirmOntology(db: Database, confirmedBy = 'user'): string {
  const current = (db.prepare(`SELECT version FROM ontology_version WHERE singleton=1`).get() as { version: string })
    .version
  const p = current.split('.').map(Number)
  const next = `${p[0] ?? 0}.${p[1] ?? 1}.${(p[2] ?? 0) + 1}`
  db.prepare(
    `UPDATE ontology_version SET version=?,confirmed_at=CURRENT_TIMESTAMP,confirmed_by=? WHERE singleton=1`
  ).run(next, confirmedBy)
  eventBus.emit('ontology.updated', { kind: 'confirmed', version: next })
  return next
}
