import { getDatabase } from '../db/database'
import { createEntityEntry } from '../store/entity-registry'
import { withTransaction } from '../store/store-access'

// 16 種の設計リソーステーブル名マッピング
export const RESOURCE_TABLES = [
  'resource_label',
  'resource_text',
  'resource_list',
  'resource_figure',
  'resource_table',
  'resource_formula',
  'resource_code',
  'resource_model',
  'resource_scenario',
  'resource_interface',
  'resource_state_transition',
  'resource_data_structure',
  'resource_reference',
  'resource_metadata',
  'resource_glossary',
  'resource_glossary_synonym',
] as const

export type ResourceEntityType = (typeof RESOURCE_TABLES)[number]

// ---- type-specific create helpers ----

export interface CreateLabelOptions {
  labelText: string
  labelKind?: 'document' | 'chapter' | 'section' | 'item' | 'figure' | 'table' | 'model' | 'other'
  numbering?: string
  level?: number
  styleName?: string
  targetResourceUid?: string
}

export interface CreateTextOptions {
  textBody: string
  textRole?: 'body' | 'description' | 'note' | 'remark' | 'footnote' | 'comment' | 'other'
  language?: string
}

export interface CreateListOptions {
  listKind?: 'ordered' | 'unordered' | 'check' | 'definition' | 'other'
  itemsJson?: unknown[]
}

export interface CreateTableOptions {
  tableTitle?: string
  tableKind?: 'data' | 'interface' | 'state_transition' | 'function_list' | 'matrix' | 'other'
  rowCount?: number
  columnCount?: number
  headerRowsJson?: unknown
  headerColumnsJson?: unknown
  cellsJson?: unknown
}

export interface CreateCodeOptions {
  codeText: string
  language?: string
  codeKind?: 'source' | 'pseudo' | 'sql' | 'config' | 'command' | 'idl' | 'schema' | 'other'
}

export interface CreateModelOptions {
  modelName?: string
  modelKind?: 'uml' | 'sysml' | 'er' | 'dfd' | 'bpmn' | 'mermaid' | 'plantuml' | 'other'
  modelFormat?: 'image' | 'text' | 'xmi' | 'json' | 'other'
  modelSource?: string
}

export interface CreateScenarioOptions {
  scenarioName?: string
  triggerText?: string
  stepsJson?: unknown[]
  actorsJson?: unknown[]
}

export interface CreateInterfaceOptions {
  interfaceName?: string
  interfaceKind?: 'api' | 'communication' | 'file' | 'db' | 'screen' | 'device' | 'library' | 'other'
  provider?: string
  consumer?: string
  protocol?: string
  operationsJson?: unknown[]
}

export interface CreateStateTransitionOptions {
  stateMachineName?: string
  statesJson?: unknown[]
  eventsJson?: unknown[]
  transitionsJson?: unknown[]
  initialState?: string
}

export interface CreateDataStructureOptions {
  dataStructureName?: string
  dataStructureKind?: 'db_table' | 'message' | 'file' | 'struct' | 'record' | 'screen_item' | 'other'
  fieldsJson?: unknown[]
  keysJson?: unknown[]
}

// ---- shared row type ----

export interface ResourceRow {
  uid: string
  code: string
  title: string
  status: string
  entity_type: string
  created_at: string
  updated_at: string
  [key: string]: unknown
}

// ---- generic list / get ----

export function listResources(entityType: ResourceEntityType, limit = 200): ResourceRow[] {
  return getDatabase()
    .prepare(
      `SELECT r.*, er.code, er.title, er.status, er.entity_type, er.created_at, er.updated_at
       FROM ${entityType} r
       JOIN entity_registry er ON er.uid = r.uid
       ORDER BY er.created_at DESC
       LIMIT ?`
    )
    .all(limit) as ResourceRow[]
}

export function getResource(uid: string): ResourceRow | undefined {
  const er = getDatabase()
    .prepare(`SELECT entity_type FROM entity_registry WHERE uid = ?`)
    .get(uid) as { entity_type: string } | undefined
  if (!er) return undefined

  return getDatabase()
    .prepare(
      `SELECT r.*, era.code, era.title, era.status, era.entity_type, era.created_at, era.updated_at
       FROM ${er.entity_type} r
       JOIN entity_registry era ON era.uid = r.uid
       WHERE r.uid = ?`
    )
    .get(uid) as ResourceRow | undefined
}

export function deleteResource(uid: string): void {
  withTransaction(() => {
    const er = getDatabase()
      .prepare(`SELECT entity_type FROM entity_registry WHERE uid = ?`)
      .get(uid) as { entity_type: string } | undefined
    if (!er) return
    const db = getDatabase()
    db.prepare(`DELETE FROM ${er.entity_type} WHERE uid = ?`).run(uid)
    db.prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(uid)
  })
}

export function updateResourceStatus(uid: string, status: 'active' | 'archived' | 'deleted'): void {
  getDatabase()
    .prepare(`UPDATE entity_registry SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid = ?`)
    .run(status, uid)
}

// ---- auto-code ----

function nextCode(entityType: string): string {
  const prefix: Record<string, string> = {
    resource_label: 'LBL',
    resource_text: 'TXT',
    resource_list: 'LST',
    resource_figure: 'FIG',
    resource_table: 'TBL',
    resource_formula: 'FML',
    resource_code: 'COD',
    resource_model: 'MDL',
    resource_scenario: 'SCN',
    resource_interface: 'IFC',
    resource_state_transition: 'STT',
    resource_data_structure: 'DST',
    resource_reference: 'REF',
    resource_metadata: 'MTD',
    resource_glossary: 'GLO',
    resource_glossary_synonym: 'SYN',
  }
  const p = prefix[entityType] ?? 'RES'
  const cnt = (
    getDatabase()
      .prepare(`SELECT COUNT(*) AS cnt FROM ${entityType}`)
      .get() as { cnt: number }
  ).cnt
  return `${p}-${String(cnt + 1).padStart(4, '0')}`
}

// ---- type-specific creators ----

export function createLabel(opts: CreateLabelOptions & { title?: string }): string {
  return withTransaction(() => {
    const code = nextCode('resource_label')
    const uid = createEntityEntry({ entityType: 'resource_label', code, title: opts.title ?? opts.labelText })
    getDatabase()
      .prepare(
        `INSERT INTO resource_label (uid, label_text, label_kind, numbering, level, style_name, target_resource_uid)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(uid, opts.labelText, opts.labelKind ?? null, opts.numbering ?? null, opts.level ?? null, opts.styleName ?? null, opts.targetResourceUid ?? null)
    return uid
  })
}

export function createText(opts: CreateTextOptions & { title?: string }): string {
  return withTransaction(() => {
    const code = nextCode('resource_text')
    const uid = createEntityEntry({ entityType: 'resource_text', code, title: opts.title ?? opts.textBody.slice(0, 60) })
    getDatabase()
      .prepare(
        `INSERT INTO resource_text (uid, text_body, text_role, language) VALUES (?, ?, ?, ?)`
      )
      .run(uid, opts.textBody, opts.textRole ?? null, opts.language ?? null)
    return uid
  })
}

export function createList(opts: CreateListOptions & { title: string }): string {
  return withTransaction(() => {
    const code = nextCode('resource_list')
    const uid = createEntityEntry({ entityType: 'resource_list', code, title: opts.title })
    const items = opts.itemsJson ?? []
    getDatabase()
      .prepare(
        `INSERT INTO resource_list (uid, list_kind, item_count, items_json) VALUES (?, ?, ?, ?)`
      )
      .run(uid, opts.listKind ?? null, items.length, JSON.stringify(items))
    return uid
  })
}

export function createTable(opts: CreateTableOptions & { title: string }): string {
  return withTransaction(() => {
    const code = nextCode('resource_table')
    const uid = createEntityEntry({ entityType: 'resource_table', code, title: opts.title })
    getDatabase()
      .prepare(
        `INSERT INTO resource_table
         (uid, table_title, table_kind, row_count, column_count, header_rows_json, header_columns_json, cells_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        uid,
        opts.tableTitle ?? opts.title,
        opts.tableKind ?? null,
        opts.rowCount ?? 0,
        opts.columnCount ?? 0,
        opts.headerRowsJson ? JSON.stringify(opts.headerRowsJson) : null,
        opts.headerColumnsJson ? JSON.stringify(opts.headerColumnsJson) : null,
        opts.cellsJson ? JSON.stringify(opts.cellsJson) : null
      )
    return uid
  })
}

export function createCode(opts: CreateCodeOptions & { title?: string }): string {
  return withTransaction(() => {
    const code = nextCode('resource_code')
    const lines = opts.codeText.split('\n').length
    const uid = createEntityEntry({ entityType: 'resource_code', code, title: opts.title ?? `${opts.language ?? 'code'} snippet` })
    getDatabase()
      .prepare(
        `INSERT INTO resource_code (uid, code_text, language, code_kind, line_count) VALUES (?, ?, ?, ?, ?)`
      )
      .run(uid, opts.codeText, opts.language ?? null, opts.codeKind ?? null, lines)
    return uid
  })
}

export function createModel(opts: CreateModelOptions & { title: string }): string {
  return withTransaction(() => {
    const code = nextCode('resource_model')
    const uid = createEntityEntry({ entityType: 'resource_model', code, title: opts.title })
    getDatabase()
      .prepare(
        `INSERT INTO resource_model (uid, model_name, model_kind, model_format, model_source)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(uid, opts.modelName ?? null, opts.modelKind ?? null, opts.modelFormat ?? null, opts.modelSource ?? null)
    return uid
  })
}

export function createScenario(opts: CreateScenarioOptions & { title: string }): string {
  return withTransaction(() => {
    const code = nextCode('resource_scenario')
    const uid = createEntityEntry({ entityType: 'resource_scenario', code, title: opts.title })
    getDatabase()
      .prepare(
        `INSERT INTO resource_scenario (uid, scenario_name, trigger_text, actors_json, steps_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        uid,
        opts.scenarioName ?? null,
        opts.triggerText ?? null,
        opts.actorsJson ? JSON.stringify(opts.actorsJson) : null,
        opts.stepsJson ? JSON.stringify(opts.stepsJson) : null
      )
    return uid
  })
}

export function createInterface(opts: CreateInterfaceOptions & { title: string }): string {
  return withTransaction(() => {
    const code = nextCode('resource_interface')
    const uid = createEntityEntry({ entityType: 'resource_interface', code, title: opts.title })
    getDatabase()
      .prepare(
        `INSERT INTO resource_interface (uid, interface_name, interface_kind, provider, consumer, protocol, operations_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        uid,
        opts.interfaceName ?? null,
        opts.interfaceKind ?? null,
        opts.provider ?? null,
        opts.consumer ?? null,
        opts.protocol ?? null,
        opts.operationsJson ? JSON.stringify(opts.operationsJson) : null
      )
    return uid
  })
}

export function createStateTransition(opts: CreateStateTransitionOptions & { title: string }): string {
  return withTransaction(() => {
    const code = nextCode('resource_state_transition')
    const uid = createEntityEntry({ entityType: 'resource_state_transition', code, title: opts.title })
    getDatabase()
      .prepare(
        `INSERT INTO resource_state_transition
         (uid, state_machine_name, states_json, events_json, transitions_json, initial_state)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        uid,
        opts.stateMachineName ?? null,
        opts.statesJson ? JSON.stringify(opts.statesJson) : null,
        opts.eventsJson ? JSON.stringify(opts.eventsJson) : null,
        opts.transitionsJson ? JSON.stringify(opts.transitionsJson) : null,
        opts.initialState ?? null
      )
    return uid
  })
}

export function createDataStructure(opts: CreateDataStructureOptions & { title: string }): string {
  return withTransaction(() => {
    const code = nextCode('resource_data_structure')
    const uid = createEntityEntry({ entityType: 'resource_data_structure', code, title: opts.title })
    getDatabase()
      .prepare(
        `INSERT INTO resource_data_structure (uid, data_structure_name, data_structure_kind, fields_json, keys_json)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        uid,
        opts.dataStructureName ?? null,
        opts.dataStructureKind ?? null,
        opts.fieldsJson ? JSON.stringify(opts.fieldsJson) : null,
        opts.keysJson ? JSON.stringify(opts.keysJson) : null
      )
    return uid
  })
}

export function updateResourceField(uid: string, entityType: ResourceEntityType, fields: Record<string, unknown>): void {
  const db = getDatabase()
  for (const [col, val] of Object.entries(fields)) {
    const safeVal = typeof val === 'object' && val !== null ? JSON.stringify(val) : val
    db.prepare(`UPDATE ${entityType} SET ${col} = ? WHERE uid = ?`).run(safeVal, uid)
  }
  db.prepare(`UPDATE entity_registry SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid = ?`).run(uid)
}
