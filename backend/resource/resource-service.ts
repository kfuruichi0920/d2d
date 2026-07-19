/**
 * 共通Resource Editorサービス（P7-2/P7-3、MID-002/004/005、EDIT-004）。
 * resource_* 14種を定義駆動で参照・改訂し、正本を上書きせず新Resource + based_onを作る。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'
import { registerEntity } from '../store/entity-registry'
import { newUid } from '../store/uid'
import type { EntityType } from '../store/entity-types'

export type ResourceFieldKind = 'text' | 'multiline' | 'number' | 'json' | 'enum' | 'table'
export interface ResourceFieldDefinition {
  name: string
  label: string
  kind: ResourceFieldKind
  required?: boolean
  options?: string[]
  defaultValue?: string | number
  description: string
  language?: 'markdown' | 'latex'
  preview?: 'markdown' | 'image' | 'formula'
  hidden?: boolean
}
export interface ResourceTypeDefinition {
  type: string
  label: string
  fields: ResourceFieldDefinition[]
}

const f = (
  name: string,
  label: string,
  kind: ResourceFieldKind,
  extra: Partial<Omit<ResourceFieldDefinition, 'name' | 'label' | 'kind' | 'description'>> & {
    description?: string
  } = {}
): ResourceFieldDefinition => ({
  name,
  label,
  kind,
  description: extra.description ?? `${label}を設定します。`,
  ...extra
})
const enumField = (name: string, label: string, options: string[], defaultValue?: string): ResourceFieldDefinition =>
  f(name, label, 'enum', { options, defaultValue })
const jsonField = (name: string, label: string): ResourceFieldDefinition => f(name, label, 'json')

export const RESOURCE_TYPE_DEFINITIONS: ResourceTypeDefinition[] = [
  {
    type: 'resource_label',
    label: 'ラベル',
    fields: [
      f('label_text', 'ラベル文字列', 'multiline', { required: true }),
      enumField(
        'label_kind',
        'ラベル種別',
        ['document', 'chapter', 'section', 'item', 'figure', 'table', 'model', 'other'],
        'other'
      ),
      f('numbering', '番号表記', 'text'),
      f('level', '階層レベル', 'number'),
      f('target_resource_uid', '対象Resource UID', 'text')
    ]
  },
  {
    type: 'resource_text',
    label: 'テキスト',
    fields: [
      f('text_body', '本文', 'multiline', { required: true }),
      enumField(
        'text_role',
        'テキスト役割',
        ['body', 'description', 'note', 'remark', 'footnote', 'comment', 'other'],
        'body'
      ),
      f('language', '言語', 'text', { defaultValue: 'ja' }),
      f('target_resource_uid', 'リンク先Resourceアドレス', 'text', {
        description: 'note等が補足する対象Resourceのresource://アドレスまたはUIDを指定します。'
      })
    ]
  },
  {
    type: 'resource_list',
    label: 'リスト',
    fields: [
      enumField('list_kind', 'リスト種別', ['ordered', 'unordered', 'check', 'definition', 'other'], 'unordered'),
      f('item_count', '項目数', 'number', { defaultValue: 0 }),
      f('items_json', '項目(Markdown)', 'multiline', {
        description: 'リスト項目をMarkdownのリスト記法で記載します。',
        language: 'markdown',
        preview: 'markdown'
      }),
      f('max_level', '最大階層', 'number', { defaultValue: 0 })
    ]
  },
  {
    type: 'resource_figure',
    label: '図',
    fields: [
      f('image_uri', '画像URI', 'text', { required: true }),
      f('image_hash', '画像ハッシュ', 'text'),
      f('figure_number', '図番号', 'text'),
      f('caption', 'キャプション', 'multiline'),
      enumField('figure_kind', '図種別', ['architecture', 'flow', 'screen', 'state', 'layout', 'other'], 'other'),
      f('width', '幅', 'number'),
      f('height', '高さ', 'number'),
      f('byte_size', 'サイズ(byte)', 'number', { description: '抽出時に取得した画像ファイルのバイトサイズです。' }),
      f('image_format', '画像フォーマット', 'text', { description: 'PNG、JPEG等の抽出時画像形式です。' }),
      f('description', '説明', 'multiline', {
        description: '文書で図を説明する設計情報です。LLM支援の対象になります。',
        language: 'markdown'
      })
    ]
  },
  {
    type: 'resource_table',
    label: '表',
    fields: [
      f('table_title', 'キャプション', 'multiline'),
      f('row_count', '行数', 'number', { defaultValue: 0 }),
      f('column_count', '列数', 'number', { defaultValue: 0 }),
      enumField(
        'table_kind',
        '表種別',
        ['data', 'interface', 'state_transition', 'function_list', 'matrix', 'other'],
        'other'
      ),
      f('header_rows_json', 'ヘッダ行', 'json', { hidden: true }),
      f('header_columns_json', 'ヘッダ列', 'json', { hidden: true }),
      f('cells_json', '表セル', 'table', {
        description: 'スプレッドシート形式で編集します。各セルはセマンティック編集に対応します。'
      }),
      f('source_range', 'ソース範囲', 'text'),
      f('description', '説明', 'multiline', {
        description: '文書で表を説明する設計情報です。表全体を含むLLM支援の対象になります。',
        language: 'markdown'
      })
    ]
  },
  {
    type: 'resource_formula',
    label: '数式',
    fields: [
      f('formula_text', '数式本文(TeX)', 'multiline', {
        required: true,
        description: 'Markdown内でMathJaxが解釈できるTeX記法を使用します。',
        language: 'latex',
        preview: 'formula'
      }),
      enumField('formula_format', '数式形式', ['latex'], 'latex'),
      enumField(
        'formula_kind',
        '数式種別',
        ['calculation', 'condition', 'constraint', 'performance', 'other'],
        'other'
      ),
      f('description', '説明', 'multiline', {
        description: '文書で数式を説明する設計情報です。LLM支援の対象になります。',
        language: 'markdown'
      })
    ]
  },
  {
    type: 'resource_code',
    label: 'コード',
    fields: [
      f('code_text', 'コード本文', 'multiline', { required: true }),
      f('language', '言語', 'text'),
      enumField(
        'code_kind',
        'コード種別',
        ['source', 'pseudo', 'sql', 'config', 'command', 'idl', 'schema', 'other'],
        'other'
      ),
      f('line_count', '行数', 'number'),
      f('description', '説明', 'multiline', {
        description: '文書で疑似コードを説明する設計情報です。コード本文を含むLLM支援の対象になります。',
        language: 'markdown'
      })
    ]
  },
  {
    type: 'resource_model',
    label: 'モデル',
    fields: [
      f('model_name', 'モデル名', 'text'),
      enumField(
        'model_kind',
        'モデル種別',
        ['uml', 'sysml', 'er', 'dfd', 'bpmn', 'mermaid', 'plantuml', 'other'],
        'other'
      ),
      enumField('model_format', 'モデル形式', ['image', 'text', 'xmi', 'json', 'other'], 'text'),
      f('model_source', 'モデルソース', 'multiline'),
      jsonField('model_elements_json', 'モデル要素JSON'),
      jsonField('model_relations_json', 'モデル関係JSON'),
      jsonField('diagram_texts_json', '図中文字JSON'),
      enumField('parse_status', '解析状態', ['not_parsed', 'success', 'failed', 'partial'], 'not_parsed')
    ]
  },
  {
    type: 'resource_scenario',
    label: 'シナリオ',
    fields: [
      f('scenario_name', 'シナリオ名', 'text'),
      jsonField('actors_json', 'アクターJSON'),
      f('trigger_text', 'トリガー', 'multiline'),
      jsonField('preconditions_json', '事前条件JSON'),
      jsonField('steps_json', 'ステップJSON'),
      jsonField('postconditions_json', '事後条件JSON'),
      jsonField('source_resource_uids_json', '元Resource UID JSON')
    ]
  },
  {
    type: 'resource_interface',
    label: 'インターフェース',
    fields: [
      f('interface_name', 'インターフェース名', 'text'),
      enumField(
        'interface_kind',
        '種別',
        ['api', 'communication', 'file', 'db', 'screen', 'device', 'library', 'other'],
        'other'
      ),
      f('provider', '提供側', 'text'),
      f('consumer', '利用側', 'text'),
      f('protocol', 'プロトコル', 'text'),
      jsonField('operations_json', '操作JSON'),
      jsonField('inputs_json', '入力JSON'),
      jsonField('outputs_json', '出力JSON'),
      jsonField('errors_json', 'エラーJSON'),
      f('timing', 'タイミング', 'text'),
      jsonField('constraints_json', '制約JSON')
    ]
  },
  {
    type: 'resource_state_transition',
    label: '状態遷移',
    fields: [
      f('state_machine_name', '状態機械名', 'text'),
      jsonField('states_json', '状態JSON'),
      jsonField('events_json', 'イベントJSON'),
      jsonField('transitions_json', '遷移JSON'),
      f('initial_state', '初期状態', 'text'),
      jsonField('final_states_json', '終了状態JSON'),
      jsonField('source_resource_uids_json', '元Resource UID JSON')
    ]
  },
  {
    type: 'resource_data_structure',
    label: 'データ構造',
    fields: [
      f('data_structure_name', 'データ構造名', 'text'),
      enumField(
        'data_structure_kind',
        '種別',
        ['db_table', 'message', 'file', 'struct', 'record', 'screen_item', 'other'],
        'other'
      ),
      jsonField('fields_json', 'フィールドJSON'),
      jsonField('keys_json', 'キーJSON'),
      jsonField('relations_json', '関係JSON'),
      jsonField('constraints_json', '制約JSON'),
      jsonField('source_resource_uids_json', '元Resource UID JSON')
    ]
  },
  {
    type: 'resource_reference',
    label: '参照',
    fields: [
      f('reference_text', '参照文字列', 'multiline', { required: true }),
      enumField(
        'reference_kind',
        '参照種別',
        ['document', 'section', 'figure', 'table', 'url', 'id', 'footnote', 'other'],
        'other'
      ),
      f('source_resource_uid', '参照元Resource UID', 'text'),
      f('target_resource_uid', '参照先Resource UID', 'text'),
      f('target_document_uid', '参照先文書UID', 'text'),
      f('target_label_text', '参照先ラベル', 'text'),
      enumField('resolution_status', '解決状態', ['unresolved', 'candidate', 'resolved', 'ambiguous'], 'unresolved'),
      jsonField('candidate_targets_json', '候補参照先JSON'),
      f('relation_candidate', '関係候補', 'text')
    ]
  },
  {
    type: 'resource_metadata',
    label: 'メタデータ',
    fields: [
      enumField(
        'metadata_kind',
        'メタデータ種別',
        ['document', 'extraction', 'quality', 'review', 'version', 'diff', 'other'],
        'other'
      ),
      f('target_resource_uid', '対象Resource UID', 'text'),
      f('metadata_key', 'キー', 'text', { required: true }),
      f('metadata_value', '値', 'multiline'),
      enumField('value_type', '値種別', ['string', 'number', 'boolean', 'date', 'json'], 'string'),
      f('unit', '単位', 'text'),
      enumField('metadata_source', '情報源', ['file', 'parser', 'user', 'system', 'other'], 'user')
    ]
  }
]

function definitionOf(type: string): ResourceTypeDefinition {
  const definition = RESOURCE_TYPE_DEFINITIONS.find((candidate) => candidate.type === type)
  if (!definition) throw new BackendError('validation', `未対応のResource種別です: ${type}`, '')
  return definition
}

export interface ResourceOwnership {
  exclusiveIntermediate: boolean
  intermediateItemUid?: string
  protectionReasons: string[]
}

/**
 * Resourceの所有関係を判定する（MID-005）。
 * ③の単一intermediate_itemだけが保持し、②・他③・他Resource・受け側トレースから参照されない場合だけ専有とする。
 */
export function inspectResourceOwnership(
  db: Database,
  resourceUid: string,
  expectedIntermediateItemUid?: string
): ResourceOwnership {
  const intermediateItems = db
    .prepare(`SELECT uid FROM intermediate_item WHERE resource_uid=? ORDER BY uid`)
    .all(resourceUid) as { uid: string }[]
  const currentItemUid =
    expectedIntermediateItemUid ?? (intermediateItems.length === 1 ? intermediateItems[0]!.uid : undefined)
  const reasons: string[] = []
  if (!currentItemUid || !intermediateItems.some((item) => item.uid === currentItemUid))
    reasons.push('単一の中間要素に所有されていません')
  const count = (sql: string, ...params: unknown[]): number =>
    (db.prepare(sql).get(...params) as { count: number }).count
  if (count(`SELECT COUNT(*) AS count FROM extracted_item WHERE resource_uid=?`, resourceUid) > 0)
    reasons.push('②抽出データから参照されています')
  if (
    count(
      `SELECT COUNT(*) AS count FROM intermediate_item WHERE resource_uid=? AND uid<>?`,
      resourceUid,
      currentItemUid ?? ''
    ) > 0
  )
    reasons.push('他の中間要素から参照されています')
  if (count(`SELECT COUNT(*) AS count FROM trace_link WHERE to_uid=? AND from_uid<>?`, resourceUid, resourceUid) > 0)
    reasons.push('他のトレースから参照されています')
  if (
    count(
      `SELECT COUNT(*) AS count FROM (
         SELECT uid FROM entity_registry WHERE owner_uid=?
         UNION ALL SELECT uid FROM resource_label WHERE target_resource_uid=?
         UNION ALL SELECT uid FROM resource_figure WHERE caption_uid=?
         UNION ALL SELECT uid FROM resource_reference WHERE source_resource_uid=? OR target_resource_uid=?
         UNION ALL SELECT uid FROM resource_metadata WHERE target_resource_uid=?
         UNION ALL SELECT uid FROM llm_run_ref WHERE input_ref_uid=?
       )`,
      resourceUid,
      resourceUid,
      resourceUid,
      resourceUid,
      resourceUid,
      resourceUid,
      resourceUid
    ) > 0
  )
    reasons.push('他のResourceまたは実行証跡から参照されています')
  return {
    exclusiveIntermediate: Boolean(currentItemUid) && reasons.length === 0,
    intermediateItemUid: currentItemUid,
    protectionReasons: reasons
  }
}
export function getResource(
  db: Database,
  uid: string
): {
  uid: string
  code: string
  title: string | null
  type: string
  typeLabel: string
  values: Record<string, unknown>
  definitions: ResourceTypeDefinition[]
  ownership: ResourceOwnership
  administrativeNotes: string
} {
  const entity = db
    .prepare(
      `SELECT uid, code, title, entity_type, administrative_notes FROM entity_registry WHERE uid=? AND status<>'deleted'`
    )
    .get(uid) as
    | { uid: string; code: string; title: string | null; entity_type: string; administrative_notes: string | null }
    | undefined
  if (!entity) throw new BackendError('not_found', `Resourceが見つかりません: ${uid}`, '')
  const definition = definitionOf(entity.entity_type)
  const row = db.prepare(`SELECT * FROM ${definition.type} WHERE uid=?`).get(uid) as Record<string, unknown> | undefined
  if (!row) throw new BackendError('not_found', `Resource詳細が見つかりません: ${uid}`, definition.type)
  const values = Object.fromEntries(definition.fields.map((field) => [field.name, row[field.name] ?? '']))
  return {
    uid,
    code: entity.code,
    title: entity.title,
    type: definition.type,
    typeLabel: definition.label,
    values,
    definitions: RESOURCE_TYPE_DEFINITIONS,
    ownership: inspectResourceOwnership(db, uid),
    administrativeNotes: entity.administrative_notes ?? ''
  }
}

/** LLM送信用に、Resourceが属する文書とアウトライン内の親子・前後位置を自動補完する（EDIT-078）。 */
export function getResourceOutlineContext(db: Database, resourceUid: string): Record<string, unknown> | null {
  const row = db
    .prepare(
      `SELECT i.intermediate_document_uid,d.structure_json,e.code,e.title
         FROM intermediate_item i
         JOIN intermediate_document d ON d.uid=i.intermediate_document_uid
         JOIN entity_registry e ON e.uid=d.uid
        WHERE i.resource_uid=? LIMIT 1`
    )
    .get(resourceUid) as
    { intermediate_document_uid: string; structure_json: string; code: string; title: string | null } | undefined
  if (!row) return null
  const base = { documentUid: row.intermediate_document_uid, documentCode: row.code, documentTitle: row.title }
  try {
    const elements = (JSON.parse(row.structure_json) as { elements?: Array<Record<string, unknown>> }).elements ?? []
    const index = elements.findIndex((element) => element.resource_uid === resourceUid)
    if (index < 0) return base
    const current = elements[index]!
    const level = Number(current.level ?? 0)
    let parent: Record<string, unknown> | null = null
    for (let cursor = index - 1; cursor >= 0; cursor--) {
      if (Number(elements[cursor]!.level ?? 0) < level) {
        parent = elements[cursor]!
        break
      }
    }
    return {
      ...base,
      outlineIndex: index,
      current,
      parent,
      previous: elements[index - 1] ?? null,
      next: elements[index + 1] ?? null
    }
  } catch {
    return base
  }
}

export interface ResourceMergeSource {
  resourceUid: string
  sourceKind: 'extracted' | 'intermediate'
  sourceLabel: string
  readonly: boolean
  type: string
  typeLabel: string
  values: Record<string, unknown>
}

/** 中間要素のResource編集で表示する由来Resource。②由来は読取専用、新規③は編集可能とする。 */
export function getResourceMergeContext(
  db: Database,
  intermediateDocumentUid: string,
  intermediateItemUid: string,
  resourceUid: string
): { sources: ResourceMergeSource[] } {
  const item = db
    .prepare(`SELECT resource_uid FROM intermediate_item WHERE uid=? AND intermediate_document_uid=?`)
    .get(intermediateItemUid, intermediateDocumentUid) as { resource_uid: string } | undefined
  if (!item || item.resource_uid !== resourceUid)
    throw new BackendError('conflict', '中間要素のResourceが更新されています', '再読込してください。')
  const origins = db
    .prepare(
      `SELECT DISTINCT x.resource_uid,e.code,e.title
         FROM trace_link t
         JOIN extracted_item x ON x.uid=t.to_uid
         JOIN entity_registry e ON e.uid=x.uid
        WHERE t.from_uid=? AND t.relation_type='based_on'
        ORDER BY e.code`
    )
    .all(intermediateItemUid) as { resource_uid: string; code: string; title: string | null }[]
  if (origins.length === 0) {
    const current = getResource(db, resourceUid)
    return {
      sources: [
        {
          resourceUid,
          sourceKind: 'intermediate',
          sourceLabel: `新規作成した中間要素 ${current.code}`,
          readonly: false,
          type: current.type,
          typeLabel: current.typeLabel,
          values: current.values
        }
      ]
    }
  }
  return {
    sources: origins.map((origin) => {
      const resource = getResource(db, origin.resource_uid)
      return {
        resourceUid: origin.resource_uid,
        sourceKind: 'extracted' as const,
        sourceLabel: `抽出元 ${origin.code}${origin.title ? ` ${origin.title}` : ''}`,
        readonly: true,
        type: resource.type,
        typeLabel: resource.typeLabel,
        values: resource.values
      }
    })
  }
}

function plainText(type: string, values: Record<string, unknown>): string {
  if (type === 'resource_list' && values.items_json) {
    try {
      return (JSON.parse(String(values.items_json)) as Array<{ text?: string }>)
        .map((item) => item.text ?? '')
        .join('\n')
    } catch {
      // 構造不正時は下の汎用文字列表現へフォールバックする
    }
  }
  if (type === 'resource_table' && values.cells_json) {
    try {
      return (JSON.parse(String(values.cells_json)) as Array<Array<{ text?: string }>>)
        .map((row) => row.map((cell) => cell.text ?? '').join(' | '))
        .join('\n')
    } catch {
      // 構造不正時は下の汎用文字列表現へフォールバックする
    }
  }
  const preferred: Record<string, string[]> = {
    resource_text: ['text_body'],
    resource_label: ['label_text'],
    resource_list: ['items_json'],
    resource_formula: ['formula_text'],
    resource_code: ['code_text'],
    resource_model: ['model_source', 'model_name'],
    resource_scenario: ['steps_json', 'scenario_name'],
    resource_interface: ['interface_name', 'operations_json'],
    resource_state_transition: ['transitions_json', 'state_machine_name'],
    resource_data_structure: ['fields_json', 'data_structure_name'],
    resource_reference: ['reference_text', 'uri'],
    resource_metadata: ['metadata_value', 'metadata_key'],
    resource_table: ['cells_json', 'table_title'],
    resource_figure: ['description', 'image_uri']
  }
  return (preferred[type] ?? [])
    .map((field) => values[field])
    .filter((value) => value !== null && value !== undefined && String(value).trim())
    .map(String)
    .join('\n')
}

/** 左ペインの値から右フォーム用候補を作る。DBは変更しない（MID-005）。 */
export function mergeResourceValues(
  targetType: string,
  sources: Array<{ type: string; values: Record<string, unknown> }>
): { values: Record<string, string | number>; warnings: string[] } {
  if (sources.length === 0) throw new BackendError('validation', 'マージ元Resourceがありません', '')
  const definition = definitionOf(targetType)
  if (targetType === 'resource_text' && sources.some((source) => source.type !== 'resource_text')) {
    return {
      values: {
        text_body: sources
          .map((source) => plainText(source.type, source.values))
          .filter(Boolean)
          .join('\n'),
        text_role: 'body',
        language: 'ja',
        sentences_json: '',
        context_json: ''
      },
      warnings: ['異なるResource種別をテキスト表現へマージしました。元の固有情報はbased_onから参照できます。']
    }
  }
  const values: Record<string, string | number> = {}
  const warnings: string[] = []
  let mapped = 0
  for (const field of definition.fields) {
    const candidates = sources
      .map((source) => source.values[field.name])
      .filter((value) => value !== null && value !== undefined && String(value).trim() !== '')
    if (candidates.length === 0) {
      values[field.name] = field.defaultValue ?? ''
      continue
    }
    mapped++
    if (field.kind === 'multiline' || (field.kind === 'text' && field.required)) {
      values[field.name] = [...new Set(candidates.map(String))].join('\n')
    } else if (field.kind === 'json') {
      const parsed = candidates.map((candidate) => {
        try {
          return JSON.parse(String(candidate)) as unknown
        } catch {
          return candidate
        }
      })
      if (parsed.every(Array.isArray)) values[field.name] = JSON.stringify(parsed.flat(), null, 2)
      else if (parsed.every((value) => value && typeof value === 'object' && !Array.isArray(value)))
        values[field.name] = JSON.stringify(Object.assign({}, ...parsed), null, 2)
      else {
        values[field.name] = String(candidates[0])
        if (candidates.length > 1) warnings.push(`${field.label}は安全に統合できないため先頭値を使用しました。`)
      }
    } else {
      values[field.name] = field.kind === 'number' ? Number(candidates[0]) : String(candidates[0])
      if (new Set(candidates.map(String)).size > 1)
        warnings.push(`${field.label}は複数値を持つため先頭値を使用しました。`)
    }
  }
  if (mapped === 0) {
    const text = sources
      .map((source) => plainText(source.type, source.values))
      .filter(Boolean)
      .join('\n')
    const target = definition.fields.find(
      (field) => field.required && (field.kind === 'text' || field.kind === 'multiline')
    )
    if (target && text) {
      values[target.name] = text
      warnings.push(`異なるResource種別から${target.label}へテキストとしてマージしました。内容を確認してください。`)
    } else {
      warnings.push(
        'このResource種別はルールベースで安全にマージできません。手動編集またはLLMマージを使用してください。'
      )
    }
  }
  return { values, warnings }
}

/** LLMが返したJSONを定義済みフィールドだけの保存前候補へ正規化する。 */
export function parseLlmMergeCandidate(targetType: string, content: string): Record<string, string | number> {
  const definition = definitionOf(targetType)
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) throw new BackendError('llm', 'LLMマージ結果にJSONオブジェクトがありません', content.slice(0, 300))
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(match[0]) as Record<string, unknown>
  } catch {
    throw new BackendError('llm', 'LLMマージ結果のJSONを解析できません', content.slice(0, 300))
  }
  return Object.fromEntries(
    definition.fields.map((field) => [
      field.name,
      field.kind === 'number' ? Number(parsed[field.name] ?? field.defaultValue ?? 0) : String(parsed[field.name] ?? '')
    ])
  )
}
function normalizedValues(
  definition: ResourceTypeDefinition,
  input: Record<string, unknown>
): Record<string, string | number | null> {
  const result: Record<string, string | number | null> = {}
  for (const field of definition.fields) {
    const raw = input[field.name]
    if (field.kind === 'number') {
      if (raw === '' || raw === null || raw === undefined)
        result[field.name] = field.defaultValue === undefined ? null : Number(field.defaultValue)
      else if (!Number.isFinite(Number(raw)))
        throw new BackendError('validation', `${field.label}は数値で入力してください`, '')
      else result[field.name] = Number(raw)
      continue
    }
    const value = raw === null || raw === undefined ? '' : String(raw)
    if (field.required && !value.trim()) throw new BackendError('validation', `${field.label}は必須です`, '')
    if (field.kind === 'json' && value.trim()) {
      try {
        JSON.parse(value)
      } catch {
        throw new BackendError('validation', `${field.label}は正しいJSONで入力してください`, '')
      }
    }
    const normalized = field.name === 'target_resource_uid' ? value.trim().replace(/^resource:\/\//, '') : value
    result[field.name] = normalized.trim()
      ? normalized
      : field.defaultValue === undefined
        ? null
        : String(field.defaultValue)
  }
  return result
}

function addBasedOn(
  db: Database,
  projectUid: string,
  fromUid: string,
  toUid: string,
  transformNote: string,
  llmRunUid?: string
): void {
  const existing = db
    .prepare(
      `SELECT 1 FROM trace_link WHERE from_uid=? AND to_uid=? AND relation_type='based_on' AND COALESCE(transform_note,'')=? LIMIT 1`
    )
    .get(fromUid, toUid, transformNote)
  if (existing) return
  const createdBy = llmRunUid ? 'llm' : 'human'
  const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy })
  db.prepare(
    `INSERT INTO trace_link (uid,from_uid,to_uid,relation_type,basis_kind,transform_note,created_by,review_status,llm_run_uid) VALUES (?,?,?,'based_on',?,?,?,'approved',?)`
  ).run(
    link.uid,
    fromUid,
    toUid,
    llmRunUid ? 'normalized' : 'human_approved',
    transformNote,
    createdBy,
    llmRunUid ?? null
  )
}

function syncTableCells(db: Database, tableUid: string, values: Record<string, string | number | null>): void {
  let rows: Array<Array<string | { text?: unknown; colspan?: unknown }>>
  let headerRows: number[]
  let headerColumns: number[]
  try {
    const parsedRows = JSON.parse(String(values.cells_json ?? '[]')) as unknown
    rows = Array.isArray(parsedRows) ? (parsedRows as typeof rows) : []
    const parsedHeaderRows = JSON.parse(String(values.header_rows_json ?? '[]')) as unknown
    const parsedHeaderColumns = JSON.parse(String(values.header_columns_json ?? '[]')) as unknown
    headerRows = Array.isArray(parsedHeaderRows) ? parsedHeaderRows.map(Number) : []
    headerColumns = Array.isArray(parsedHeaderColumns) ? parsedHeaderColumns.map(Number) : []
  } catch {
    throw new BackendError('validation', '表セルまたはヘッダ指定のJSONが正しくありません', '')
  }
  const existing = db
    .prepare(`SELECT uid,row_no,col_no FROM resource_table_cell WHERE table_uid=?`)
    .all(tableUid) as Array<{ uid: string; row_no: number; col_no: number }>
  const uidByCoordinate = new Map(existing.map((cell) => [`${cell.row_no}:${cell.col_no}`, cell.uid]))
  db.prepare(`DELETE FROM resource_table_cell WHERE table_uid=?`).run(tableUid)
  const insert = db.prepare(
    `INSERT INTO resource_table_cell (uid,table_uid,row_no,col_no,cell_text,colspan,is_header) VALUES (?,?,?,?,?,?,?)`
  )
  rows.forEach((row, rowNo) => {
    if (!Array.isArray(row)) return
    row.forEach((cell, colNo) => {
      const objectCell = typeof cell === 'object' && cell !== null ? cell : undefined
      insert.run(
        uidByCoordinate.get(`${rowNo}:${colNo}`) ?? newUid(),
        tableUid,
        rowNo,
        colNo,
        typeof cell === 'string' ? cell : String(objectCell?.text ?? ''),
        Math.max(1, Number(objectCell?.colspan) || 1),
        headerRows.includes(rowNo) || headerColumns.includes(colNo) ? 1 : 0
      )
    })
  })
}

export function summaryFor(
  type: string,
  values: Record<string, string | number | null>
): Partial<{ type: string; text: string; image: string; rows: { text: string }[][]; level: number }> {
  switch (type) {
    case 'resource_label':
      return {
        type: values.label_kind === 'figure' || values.label_kind === 'table' ? 'caption' : 'heading',
        text: String(values.label_text ?? ''),
        level: Number(values.level ?? 1)
      }
    case 'resource_list': {
      const markdown = String(values.items_json ?? '')
      try {
        const items = JSON.parse(markdown) as Array<{ text?: string }>
        return { type: 'list_item', text: items.map((item) => item.text ?? '').join('\n') }
      } catch {
        return { type: 'list_item', text: markdown }
      }
    }
    case 'resource_figure':
      return { type: 'figure', image: String(values.image_uri ?? '') }
    case 'resource_table': {
      const rows = values.cells_json ? (JSON.parse(String(values.cells_json)) as { text: string }[][]) : []
      return { type: 'table', rows }
    }
    case 'resource_formula':
      return { type: 'paragraph', text: String(values.formula_text ?? '') }
    case 'resource_code':
      return { type: 'paragraph', text: String(values.code_text ?? '') }
    case 'resource_model':
      return { type: 'paragraph', text: String(values.model_name ?? values.model_source ?? '') }
    case 'resource_scenario':
      return { type: 'paragraph', text: String(values.scenario_name ?? values.trigger_text ?? '') }
    case 'resource_interface':
      return { type: 'paragraph', text: String(values.interface_name ?? '') }
    case 'resource_state_transition':
      return { type: 'paragraph', text: String(values.state_machine_name ?? '') }
    case 'resource_data_structure':
      return { type: 'paragraph', text: String(values.data_structure_name ?? '') }
    case 'resource_reference':
      return { type: 'paragraph', text: String(values.reference_text ?? '') }
    case 'resource_metadata':
      return { type: 'paragraph', text: `${values.metadata_key ?? ''}: ${values.metadata_value ?? ''}` }
    default:
      return { type: 'paragraph', text: String(values.text_body ?? '') }
  }
}

/** 複数Resourceを同種またはresource_textへ統合し、全元Resourceへのbased_onを持つ新Resourceを作る。 */
export function createMergedResource(
  db: Database,
  projectUid: string,
  targetType: string,
  sources: Array<{ uid: string; type: string; values: Record<string, unknown> }>
): {
  uid: string
  type: string
  summary: ReturnType<typeof summaryFor>
  warnings: string[]
} {
  const definition = definitionOf(targetType)
  const candidate = mergeResourceValues(targetType, sources)
  const values = normalizedValues(definition, candidate.values)
  const primary = definition.fields.find((field) => field.required)?.name ?? definition.fields[0]?.name
  const transaction = db.transaction(() => {
    const resource = registerEntity(db, {
      projectUid,
      entityType: definition.type as EntityType,
      title: String(primary ? (values[primary] ?? definition.label) : definition.label).slice(0, 80),
      createdBy: 'user'
    })
    const columns = definition.fields.map((field) => field.name)
    db.prepare(
      `INSERT INTO ${definition.type} (uid,${columns.join(',')}) VALUES (?${columns.map(() => ',?').join('')})`
    ).run(resource.uid, ...columns.map((column) => values[column]))
    if (definition.type === 'resource_table') syncTableCells(db, resource.uid, values)
    for (const source of sources) addBasedOn(db, projectUid, resource.uid, source.uid, 'merge')
    return {
      uid: resource.uid,
      type: definition.type,
      summary: summaryFor(definition.type, values),
      warnings: candidate.warnings
    }
  })
  return transaction()
}
export function linkDerivedResource(
  db: Database,
  projectUid: string,
  input: {
    sourceUid: string
    relationType: 'contains' | 'decomposes' | 'uses' | 'relates_to'
    targetUid?: string
    newText?: string
  }
): { targetUid: string; linkUid: string; created: boolean } {
  getResource(db, input.sourceUid)
  const transaction = db.transaction(() => {
    let targetUid = input.targetUid
    let created = false
    if (!targetUid) {
      if (!input.newText?.trim()) throw new BackendError('validation', '新規Resourceの内容は必須です', '')
      const target = registerEntity(db, {
        projectUid,
        entityType: 'resource_text',
        title: input.newText.trim().slice(0, 80),
        createdBy: 'user'
      })
      db.prepare(`INSERT INTO resource_text (uid,text_body,text_role,language) VALUES (?,?,'note','ja')`).run(
        target.uid,
        input.newText.trim()
      )
      targetUid = target.uid
      created = true
    } else {
      getResource(db, targetUid)
    }
    const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'user' })
    db.prepare(
      `INSERT INTO trace_link (uid,from_uid,to_uid,relation_type,direction,created_by,review_status,basis_kind)
       VALUES (?,?,?,?,'forward','human','approved','human_approved')`
    ).run(link.uid, input.sourceUid, targetUid, input.relationType)
    return { targetUid, linkUid: link.uid, created }
  })
  return transaction()
}

export type ResourceSaveMode = 'updated' | 'created-replaced' | 'created-protected'

/**
 * Resourceを保存する（MID-005）。
 * - ③専有 + 同種: 同じResource行を上書き
 * - ③専有 + 異種: 新Resourceへ差し替え後、旧Resourceを物理削除
 * - ②由来/他参照あり: 旧Resourceを保護し、新Resource + based_onへ差し替え
 */
export function reviseResource(
  db: Database,
  projectUid: string,
  input: {
    resourceUid: string
    targetType: string
    values: Record<string, unknown>
    intermediateDocumentUid?: string
    intermediateItemUid?: string
    elementId?: string
    basedOnResourceUids?: string[]
    transformNote?: 'edit-resource' | 'merge' | 'llm-merge'
    llmRunUid?: string
    administrativeNotes?: string
  }
): {
  uid: string
  code: string
  type: string
  saveMode: ResourceSaveMode
  protectionReasons: string[]
} {
  const original = getResource(db, input.resourceUid)
  const definition = definitionOf(input.targetType)
  const values = normalizedValues(definition, input.values)
  const ownership = inspectResourceOwnership(db, input.resourceUid, input.intermediateItemUid)
  const sameType = original.type === definition.type
  const primary = definition.fields.find((field) => field.required)?.name ?? definition.fields[0]?.name
  const title = String(primary ? (values[primary] ?? definition.label) : definition.label).slice(0, 80)
  const columns = definition.fields.map((field) => field.name)
  const transformNote = input.transformNote ?? 'edit-resource'

  const transaction = db.transaction(() => {
    let result: { uid: string; code: string; type: string; saveMode: ResourceSaveMode }
    if (ownership.exclusiveIntermediate && sameType) {
      db.prepare(`UPDATE ${definition.type} SET ${columns.map((column) => `${column}=?`).join(',')} WHERE uid=?`).run(
        ...columns.map((column) => values[column]),
        original.uid
      )
      if (definition.type === 'resource_table') syncTableCells(db, original.uid, values)
      db.prepare(`UPDATE entity_registry SET administrative_notes=? WHERE uid=?`).run(
        input.administrativeNotes ?? '',
        original.uid
      )
      db.prepare(`UPDATE entity_registry SET title=?,updated_at=?,updated_by=? WHERE uid=?`).run(
        title,
        new Date().toISOString(),
        input.llmRunUid ? 'llm' : 'user',
        original.uid
      )
      for (const sourceUid of [...new Set(input.basedOnResourceUids ?? [])].filter(
        (sourceUid) => sourceUid !== original.uid
      ))
        addBasedOn(db, projectUid, original.uid, sourceUid, transformNote, input.llmRunUid)
      if (input.llmRunUid && !(input.basedOnResourceUids ?? []).some((uid) => uid !== original.uid))
        addBasedOn(db, projectUid, original.uid, input.llmRunUid, transformNote, input.llmRunUid)
      result = { uid: original.uid, code: original.code, type: definition.type, saveMode: 'updated' }
    } else {
      const resource = registerEntity(db, {
        projectUid,
        entityType: definition.type as EntityType,
        title,
        createdBy: input.llmRunUid ? 'llm' : 'user'
      })
      db.prepare(`UPDATE entity_registry SET administrative_notes=? WHERE uid=?`).run(
        input.administrativeNotes ?? '',
        resource.uid
      )
      db.prepare(
        `INSERT INTO ${definition.type} (uid,${columns.join(',')}) VALUES (?${columns.map(() => ',?').join('')})`
      ).run(resource.uid, ...columns.map((column) => values[column]))
      if (definition.type === 'resource_table') syncTableCells(db, resource.uid, values)
      const sourceUids = ownership.exclusiveIntermediate
        ? [...new Set(input.basedOnResourceUids ?? [])].filter((uid) => uid !== original.uid)
        : [...new Set([original.uid, ...(input.basedOnResourceUids ?? [])])]
      for (const sourceUid of sourceUids)
        addBasedOn(db, projectUid, resource.uid, sourceUid, transformNote, input.llmRunUid)
      if (input.llmRunUid && sourceUids.length === 0)
        addBasedOn(db, projectUid, resource.uid, input.llmRunUid, transformNote, input.llmRunUid)
      result = {
        uid: resource.uid,
        code: resource.code,
        type: definition.type,
        saveMode: ownership.exclusiveIntermediate ? 'created-replaced' : 'created-protected'
      }
    }

    const itemUid = input.intermediateItemUid ?? ownership.intermediateItemUid
    if (itemUid) {
      const item = db
        .prepare(`SELECT intermediate_document_uid,resource_uid FROM intermediate_item WHERE uid=?`)
        .get(itemUid) as { intermediate_document_uid: string; resource_uid: string } | undefined
      if (!item || item.resource_uid !== original.uid)
        throw new BackendError('conflict', '中間要素のResourceが更新されています', '再読込してください。')
      if (input.intermediateDocumentUid && item.intermediate_document_uid !== input.intermediateDocumentUid)
        throw new BackendError('validation', '中間要素の編集コンテキストが一致しません', '')
      db.prepare(`UPDATE intermediate_item SET item_type=?,resource_uid=? WHERE uid=?`).run(
        definition.type,
        result.uid,
        itemUid
      )
      const row = db
        .prepare(`SELECT structure_json FROM intermediate_document WHERE uid=?`)
        .get(item.intermediate_document_uid) as { structure_json: string } | undefined
      if (!row) throw new BackendError('not_found', '中間文書が見つかりません', item.intermediate_document_uid)
      const structure = JSON.parse(row.structure_json) as { elements: Array<Record<string, unknown>> }
      const element = input.elementId
        ? structure.elements.find((candidate) => candidate.id === input.elementId)
        : structure.elements.find((candidate) => candidate.resource_uid === original.uid)
      if (!element) throw new BackendError('not_found', '中間要素が見つかりません', input.elementId ?? original.uid)
      delete element.type
      delete element.text
      delete element.rows
      delete element.image
      Object.assign(element, summaryFor(definition.type, values), { resource_uid: result.uid })
      db.prepare(`UPDATE intermediate_document SET structure_json=? WHERE uid=?`).run(
        JSON.stringify(structure),
        item.intermediate_document_uid
      )
    } else if (input.intermediateDocumentUid || input.elementId) {
      throw new BackendError('validation', '中間要素の編集コンテキストが不完全です', '')
    }

    if (result.saveMode === 'created-replaced') {
      // 旧Resourceの由来は新Resourceへ移管し、物理削除後もトレースを維持する。
      db.prepare(`UPDATE trace_link SET from_uid=? WHERE from_uid=?`).run(result.uid, original.uid)
      db.prepare(`DELETE FROM entity_registry WHERE uid=?`).run(original.uid)
    }
    return { ...result, protectionReasons: ownership.protectionReasons }
  })
  const result = transaction()
  eventBus.emit('intermediate.updated', {
    kind: result.saveMode === 'updated' ? 'resource-overwritten' : 'resource-revised',
    resourceUid: result.uid,
    intermediateDocumentUid: input.intermediateDocumentUid
  })
  return result
}
