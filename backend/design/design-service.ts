/** ④設計モデル管理（P8 / MODEL-001〜028 / schema 2.0.0）。 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'
import { registerEntity } from '../store/entity-registry'
import type { CandidateSet } from '../llm/candidate-validation'
import { validateModelDetail } from '../ontology/ontology-service'

const nowIso = (): string => new Date().toISOString()
export const RELATION_TYPES: readonly string[] = [
  'based_on',
  'satisfies',
  'allocated_to',
  'verifies',
  'contains',
  'implements',
  'uses',
  'calls',
  'conflicts_with',
  'relates_to'
] as const
export type RelationType = string

export interface DesignElementInput {
  modelType: string
  title: string
  summary?: string
  detail?: Record<string, unknown>
  ownerUid?: string
  createdBy?: string
}
export interface DesignElementRow {
  uid: string
  code: string
  model_type: string
  model_label: string
  layer: string
  title: string | null
  status: string
  owner_uid: string | null
  summary: string
  detail_json: string
  created_at: string
  updated_at: string
  entity_type: string
}
function modelDefinition(
  db: Database,
  modelType: string
): { model_type: string; code_prefix: string; label: string; layer: string; is_enabled: number } | undefined {
  return db
    .prepare(`SELECT model_type,code_prefix,label,layer,is_enabled FROM ontology_model_definition WHERE model_type=?`)
    .get(modelType) as
    { model_type: string; code_prefix: string; label: string; layer: string; is_enabled: number } | undefined
}
function safeModelType(value: string): void {
  if (!/^model_[a-z][a-z0-9_]{0,47}$/.test(value)) throw new BackendError('validation', '不正なmodel_typeです', value)
}
export function createDesignElement(
  db: Database,
  projectUid: string,
  input: DesignElementInput
): { uid: string; code: string } {
  safeModelType(input.modelType)
  const def = modelDefinition(db, input.modelType)
  if (!def) throw new BackendError('validation', `未定義の設計モデルです: ${input.modelType}`, '')
  if (def.is_enabled !== 1)
    throw new BackendError('validation', `無効な設計モデルには追加できません: ${input.modelType}`, '')
  if (!input.title.trim()) throw new BackendError('validation', 'タイトルは必須です', '')
  const detail = input.detail ?? {}
  validateModelDetail(db, input.modelType, detail)
  return db.transaction(() => {
    const element = registerEntity(db, {
      projectUid,
      entityType: input.modelType as never,
      codePrefix: def.code_prefix,
      title: input.title,
      ownerUid: input.ownerUid,
      createdBy: input.createdBy ?? 'user'
    })
    db.prepare(`INSERT INTO "${input.modelType}"(uid,summary,detail_json) VALUES(?,?,?)`).run(
      element.uid,
      input.summary ?? input.title,
      JSON.stringify(detail)
    )
    return element
  })()
}
export function updateDesignElement(
  db: Database,
  uid: string,
  input: { title: string; summary: string; detail: Record<string, unknown>; status?: string }
): void {
  const row = db.prepare(`SELECT entity_type FROM entity_registry WHERE uid=? AND status<>'deleted'`).get(uid) as
    { entity_type: string } | undefined
  if (!row || !row.entity_type.startsWith('model_'))
    throw new BackendError('not_found', `設計モデルが見つかりません: ${uid}`, '')
  safeModelType(row.entity_type)
  validateModelDetail(db, row.entity_type, input.detail)
  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE entity_registry SET title=?,status=COALESCE(?,status),updated_by='user',updated_at=? WHERE uid=?`
    ).run(input.title, input.status ?? null, nowIso(), uid)
    db.prepare(`UPDATE "${row.entity_type}" SET summary=?,detail_json=?,model_version=model_version+1 WHERE uid=?`).run(
      input.summary,
      JSON.stringify(input.detail),
      uid
    )
  })
  txn()
  eventBus.emit('design_model.updated', { kind: 'updated', uid })
}
export function listDesignElements(
  db: Database,
  projectUid: string,
  filters?: { modelType?: string; status?: string }
): DesignElementRow[] {
  const where = [`e.project_uid=?`, `e.entity_type LIKE 'model_%'`, `e.status<>'deleted'`]
  const params: unknown[] = [projectUid]
  if (filters?.modelType) {
    where.push(`e.entity_type=?`)
    params.push(filters.modelType)
  }
  if (filters?.status) {
    where.push(`e.status=?`)
    params.push(filters.status)
  }
  const base = db
    .prepare(
      `SELECT e.uid,e.code,e.entity_type AS model_type,e.entity_type,e.title,e.status,e.owner_uid,e.created_at,e.updated_at,d.label AS model_label,d.layer FROM entity_registry e JOIN ontology_model_definition d ON d.model_type=e.entity_type WHERE ${where.join(' AND ')} ORDER BY d.sort_order,e.code`
    )
    .all(...params) as Array<Omit<DesignElementRow, 'summary' | 'detail_json'>>
  return base.map((row) => {
    safeModelType(row.model_type)
    const detail = db.prepare(`SELECT summary,detail_json FROM "${row.model_type}" WHERE uid=?`).get(row.uid) as {
      summary: string
      detail_json: string
    }
    return { ...row, ...detail }
  })
}
export interface VerificationDetail {
  condition: string
  procedure: string
  expected: string
}
export function setVerificationDetail(db: Database, uid: string, detail: VerificationDetail): void {
  const row = db.prepare(`SELECT entity_type FROM entity_registry WHERE uid=? AND status<>'deleted'`).get(uid) as
    { entity_type: string } | undefined
  if (row?.entity_type !== 'model_verif')
    throw new BackendError('validation', '検証詳細は model_verif にのみ設定できます', '')
  const current = db.prepare(`SELECT detail_json FROM model_verif WHERE uid=?`).get(uid) as
    { detail_json: string } | undefined
  if (!current) throw new BackendError('not_found', `検証モデルが見つかりません: ${uid}`, '')
  const merged = {
    ...JSON.parse(current.detail_json),
    condition: detail.condition,
    procedure: detail.procedure,
    expected_result: detail.expected
  }
  db.prepare(`UPDATE model_verif SET detail_json=?,model_version=model_version+1 WHERE uid=?`).run(
    JSON.stringify(merged),
    uid
  )
  db.prepare(`UPDATE entity_registry SET updated_at=?,updated_by='user' WHERE uid=?`).run(nowIso(), uid)
}
export function createVerificationFor(
  db: Database,
  projectUid: string,
  targetUid: string,
  title?: string
): { uid: string; code: string; linkUid: string } {
  const target = db
    .prepare(`SELECT code,title,entity_type FROM entity_registry WHERE uid=? AND status<>'deleted'`)
    .get(targetUid) as { code: string; title: string | null; entity_type: string } | undefined
  if (!target?.entity_type.startsWith('model_'))
    throw new BackendError('not_found', `検証対象が見つかりません: ${targetUid}`, '')
  const txn = db.transaction(() => {
    const v = createDesignElement(db, projectUid, {
      modelType: 'model_verif',
      title: title ?? `${target.title ?? target.code} の検証`
    })
    db.prepare(`UPDATE entity_registry SET status='approved',updated_at=? WHERE uid=?`).run(nowIso(), v.uid)
    const l = createTraceLink(db, projectUid, {
      fromUid: v.uid,
      toUid: targetUid,
      relationType: 'verifies',
      createdBy: 'human',
      reviewStatus: 'approved'
    })
    return { ...v, linkUid: l.uid }
  })
  const result = txn()
  eventBus.emit('design_model.updated', { kind: 'verification-created', uid: result.uid })
  eventBus.emit('relation.updated', { count: 1 })
  return result
}
export interface AllowedRelationRule {
  relationType: string
  sourceModelType: string
  targetModelType: string
  requiredAttr: string | null
}
export function listAllowedRelationRules(db: Database): AllowedRelationRule[] {
  return db
    .prepare(
      `SELECT a.relation_type AS relationType,a.source_model_type AS sourceModelType,a.target_model_type AS targetModelType,r.required_attr AS requiredAttr FROM ontology_relation_allowance a JOIN ontology_relation_definition r ON r.relation_type=a.relation_type AND r.is_enabled=1 JOIN ontology_model_definition s ON s.model_type=a.source_model_type AND s.is_enabled=1 JOIN ontology_model_definition t ON t.model_type=a.target_model_type AND t.is_enabled=1 WHERE a.allowed=1 ORDER BY a.relation_type,a.source_model_type,a.target_model_type`
    )
    .all() as AllowedRelationRule[]
}
export interface RelationCheckResult {
  allowed: boolean
  requiredAttr: string | null
  reason?: string
}
export function checkRelationAllowed(
  db: Database,
  relationType: string,
  sourceModelType: string | null,
  targetModelType: string | null
): RelationCheckResult {
  const relation = db
    .prepare(`SELECT required_attr,is_enabled FROM ontology_relation_definition WHERE relation_type=?`)
    .get(relationType) as { required_attr: string | null; is_enabled: number } | undefined
  if (!relation || relation.is_enabled !== 1)
    return { allowed: false, requiredAttr: null, reason: `未定義または無効な関係です: ${relationType}` }
  if (relationType === 'based_on') {
    const ok = Boolean(sourceModelType?.startsWith('model_')) && !targetModelType?.startsWith('model_')
    return ok
      ? { allowed: true, requiredAttr: relation.required_attr }
      : {
          allowed: false,
          requiredAttr: null,
          reason: 'based_on は設計モデルから②③の根拠Resourceへの関係に限定されます'
        }
  }
  if (!sourceModelType?.startsWith('model_') || !targetModelType?.startsWith('model_'))
    return { allowed: false, requiredAttr: null, reason: '設計モデル間関係の両端は model_* である必要があります' }
  const row = db
    .prepare(
      `SELECT allowed FROM ontology_relation_allowance WHERE relation_type=? AND source_model_type=? AND target_model_type=?`
    )
    .get(relationType, sourceModelType, targetModelType) as { allowed: number } | undefined
  return row?.allowed === 1
    ? { allowed: true, requiredAttr: relation.required_attr }
    : {
        allowed: false,
        requiredAttr: null,
        reason: `許容されない関係です: ${sourceModelType} -[${relationType}]-> ${targetModelType}`
      }
}
export interface TraceLinkAttributes {
  confidence?: number | null
  rationale?: string | null
  basisKind?: string | null
  evidenceSpan?: string | null
  transformNote?: string | null
  allocationKind?: string | null
  usageKind?: string | null
  conflictStatus?: string | null
  contextUid?: string | null
}
export interface CreateTraceLinkInput {
  fromUid: string
  toUid: string
  relationType: string
  attributes?: TraceLinkAttributes
  createdBy: 'human' | 'rule' | 'llm'
  reviewStatus?: 'creating' | 'draft' | 'review' | 'approved' | 'rejected' | 'provisional'
  llmRunUid?: string
}

export const REQUIRED_RELATION_ATTRIBUTE_OPTIONS: Record<string, readonly string[]> = {
  basis_kind: ['original', 'extracted', 'normalized', 'inferred', 'human_approved'],
  allocation_kind: ['structure', 'behavior', 'state', 'interface', 'data'],
  usage_kind: ['input', 'output', 'read', 'write', 'update', 'publish', 'subscribe'],
  conflict_status: ['suspected', 'confirmed', 'resolved', 'dismissed'],
  review_status: ['creating', 'draft', 'review', 'approved', 'rejected', 'provisional']
}
const REQUIRED_RELATION_ATTRIBUTE_DEFAULTS: Record<string, string> = {
  basis_kind: 'inferred',
  allocation_kind: 'behavior',
  usage_kind: 'read',
  conflict_status: 'suspected'
}
const REQUIRED_RELATION_ATTRIBUTE_KEYS: Record<string, keyof TraceLinkAttributes> = {
  basis_kind: 'basisKind',
  allocation_kind: 'allocationKind',
  usage_kind: 'usageKind',
  conflict_status: 'conflictStatus'
}

/** 未入力の必須属性を仮値で補い、レビュー状態を「作成中」にする。 */
export function prepareRelationDraft(
  requiredAttr: string | null,
  attributes: TraceLinkAttributes = {},
  requestedStatus: CreateTraceLinkInput['reviewStatus'] = 'approved'
): { attributes: TraceLinkAttributes; reviewStatus: CreateTraceLinkInput['reviewStatus'] } {
  if (!requiredAttr) return { attributes, reviewStatus: requestedStatus }
  if (requiredAttr === 'review_status') {
    return { attributes, reviewStatus: requestedStatus === 'approved' ? 'creating' : requestedStatus }
  }
  const key = REQUIRED_RELATION_ATTRIBUTE_KEYS[requiredAttr]
  if (!key || attributes[key]) return { attributes, reviewStatus: requestedStatus }
  return {
    attributes: { ...attributes, [key]: REQUIRED_RELATION_ATTRIBUTE_DEFAULTS[requiredAttr] ?? 'temporary' },
    reviewStatus: 'creating'
  }
}
function endpoint(db: Database, uid: string): { entity_type: string; exists: boolean } {
  const r = db.prepare(`SELECT entity_type FROM entity_registry WHERE uid=? AND status<>'deleted'`).get(uid) as
    { entity_type: string } | undefined
  return { entity_type: r?.entity_type ?? '', exists: !!r }
}
export function createTraceLink(
  db: Database,
  projectUid: string,
  input: CreateTraceLinkInput
): { uid: string; code: string } {
  const from = endpoint(db, input.fromUid),
    to = endpoint(db, input.toUid)
  if (!from.exists || !to.exists)
    throw new BackendError(
      'validation',
      '関係の起点または終点が存在しません',
      `from=${input.fromUid} to=${input.toUid}`
    )
  const check = checkRelationAllowed(db, input.relationType, from.entity_type, to.entity_type)
  if (!check.allowed) throw new BackendError('validation', check.reason ?? '許容されない関係です', '')
  if (check.requiredAttr) {
    const value = (
      {
        basis_kind: input.attributes?.basisKind,
        allocation_kind: input.attributes?.allocationKind,
        usage_kind: input.attributes?.usageKind,
        conflict_status: input.attributes?.conflictStatus,
        review_status: input.reviewStatus ?? 'draft'
      } as Record<string, unknown>
    )[check.requiredAttr]
    if (!value)
      throw new BackendError(
        'validation',
        `関係属性 ${check.requiredAttr} は必須です`,
        `relation_type=${input.relationType}`
      )
  }
  const dup = db
    .prepare(
      `SELECT COUNT(*) AS n FROM trace_link t JOIN entity_registry e ON e.uid=t.uid WHERE t.from_uid=? AND t.to_uid=? AND t.relation_type=? AND e.status<>'deleted' AND (t.relation_type<>'conflicts_with' OR ifnull(t.context_uid,'')=ifnull(?,''))`
    )
    .get(input.fromUid, input.toUid, input.relationType, input.attributes?.contextUid ?? null) as { n: number }
  if (dup.n > 0)
    throw new BackendError(
      'conflict',
      '同一の関係が既に存在します',
      `${input.fromUid} -[${input.relationType}]-> ${input.toUid}`
    )
  if (input.relationType === 'contains') {
    if (input.fromUid === input.toUid) throw new BackendError('validation', '自己包含は禁止されています', '')
    const cycle = db
      .prepare(
        `WITH RECURSIVE p(uid) AS (SELECT ? UNION SELECT t.to_uid FROM trace_link t JOIN p ON t.from_uid=p.uid JOIN entity_registry e ON e.uid=t.uid AND e.status<>'deleted' WHERE t.relation_type='contains') SELECT 1 AS found FROM p WHERE uid=? LIMIT 1`
      )
      .get(input.toUid, input.fromUid)
    if (cycle) throw new BackendError('validation', 'contains の循環は禁止されています', '')
  }
  const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: input.createdBy })
  db.prepare(
    `INSERT INTO trace_link(uid,from_uid,to_uid,relation_type,rationale,confidence,created_by,review_status,basis_kind,evidence_span,transform_note,allocation_kind,usage_kind,conflict_status,context_uid,llm_run_uid,direction) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    link.uid,
    input.fromUid,
    input.toUid,
    input.relationType,
    input.attributes?.rationale ?? null,
    input.attributes?.confidence ?? null,
    input.createdBy,
    input.reviewStatus ?? 'draft',
    input.attributes?.basisKind ?? null,
    input.attributes?.evidenceSpan ?? null,
    input.attributes?.transformNote ?? null,
    input.attributes?.allocationKind ?? null,
    input.attributes?.usageKind ?? null,
    input.attributes?.conflictStatus ?? null,
    input.attributes?.contextUid ?? null,
    input.llmRunUid ?? null,
    input.relationType === 'conflicts_with' ? 'bidirectional' : 'forward'
  )
  return link
}
export interface TraceLinkRow {
  uid: string
  code: string
  from_uid: string
  to_uid: string
  relation_type: string
  review_status: string | null
  rationale: string | null
  confidence: number | null
  created_by: string | null
  from_title: string | null
  from_code: string
  to_title: string | null
  to_code: string
}
export function listTraceLinks(
  db: Database,
  projectUid: string,
  filters?: { uid?: string; relationType?: string }
): TraceLinkRow[] {
  const c = [`e.project_uid=?`, `e.status<>'deleted'`],
    p: unknown[] = [projectUid]
  if (filters?.uid) {
    c.push(`(t.from_uid=? OR t.to_uid=?)`)
    p.push(filters.uid, filters.uid)
  }
  if (filters?.relationType) {
    c.push(`t.relation_type=?`)
    p.push(filters.relationType)
  }
  return db
    .prepare(
      `SELECT e.uid,e.code,t.from_uid,t.to_uid,t.relation_type,t.review_status,t.rationale,t.confidence,t.created_by,ef.title AS from_title,ef.code AS from_code,et.title AS to_title,et.code AS to_code FROM trace_link t JOIN entity_registry e ON e.uid=t.uid JOIN entity_registry ef ON ef.uid=t.from_uid JOIN entity_registry et ON et.uid=t.to_uid WHERE ${c.join(' AND ')} ORDER BY e.code`
    )
    .all(...p) as TraceLinkRow[]
}
export interface AdoptCandidatesInput {
  candidateSet: CandidateSet
  intermediateDocumentUid: string
  llmRunUid?: string
  chunkUid?: string
}
export interface AdoptCandidatesResult {
  elements: { tempId: string; uid: string; code: string }[]
  relationCount: number
  basedOnCount: number
}
export function adoptCandidates(db: Database, projectUid: string, input: AdoptCandidatesInput): AdoptCandidatesResult {
  if (input.candidateSet.elements.length === 0) throw new BackendError('validation', '採用する要素候補がありません', '')
  if (!db.prepare(`SELECT uid FROM intermediate_document WHERE uid=?`).get(input.intermediateDocumentUid))
    throw new BackendError('validation', '根拠となる③中間文書が存在しません', input.intermediateDocumentUid)
  const evidenceUid = input.chunkUid ?? input.intermediateDocumentUid
  const txn = db.transaction(() => {
    const map = new Map<string, { uid: string; code: string; modelType: string }>()
    for (const el of input.candidateSet.elements) {
      if (map.has(el.temp_id)) throw new BackendError('validation', `一時IDが重複しています: ${el.temp_id}`, '')
      const created = createDesignElement(db, projectUid, {
        modelType: el.category,
        title: el.title,
        summary: el.description ?? undefined,
        createdBy: 'llm'
      })
      db.prepare(`UPDATE entity_registry SET status='approved',updated_by='user',updated_at=? WHERE uid=?`).run(
        nowIso(),
        created.uid
      )
      map.set(el.temp_id, { ...created, modelType: el.category })
    }
    let basedOnCount = 0
    for (const [id, e] of map) {
      createTraceLink(db, projectUid, {
        fromUid: e.uid,
        toUid: evidenceUid,
        relationType: 'based_on',
        attributes: {
          basisKind: 'inferred',
          evidenceSpan: input.candidateSet.elements.find((x) => x.temp_id === id)?.evidence ?? null
        },
        createdBy: 'llm',
        reviewStatus: 'approved',
        llmRunUid: input.llmRunUid
      })
      basedOnCount++
    }
    let relationCount = 0
    for (const rel of input.candidateSet.relations) {
      const from = map.get(rel.from_temp_id),
        to = map.get(rel.to_temp_id)
      if (!from || !to)
        throw new BackendError('validation', `関係候補の参照が未解決です: ${rel.from_temp_id} -> ${rel.to_temp_id}`, '')
      const attributes = {
        rationale: rel.rationale ?? null,
        confidence: rel.confidence ?? null,
        ...(rel.attributes as TraceLinkAttributes | undefined)
      }
      const requiredAttr = checkRelationAllowed(db, rel.relation_type, from.modelType, to.modelType).requiredAttr
      const prepared = prepareRelationDraft(requiredAttr, attributes)
      createTraceLink(db, projectUid, {
        fromUid: from.uid,
        toUid: to.uid,
        relationType: rel.relation_type,
        attributes: prepared.attributes,
        createdBy: 'llm',
        reviewStatus: prepared.reviewStatus,
        llmRunUid: input.llmRunUid
      })
      relationCount++
    }
    return {
      elements: [...map].map(([tempId, e]) => ({ tempId, uid: e.uid, code: e.code })),
      relationCount,
      basedOnCount
    }
  })
  const result = txn()
  eventBus.emit('design_model.updated', result)
  eventBus.emit('relation.updated', { count: result.relationCount + result.basedOnCount })
  return result
}
