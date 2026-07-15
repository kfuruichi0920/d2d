/**
 * ④設計モデル管理（P8、MODEL-001〜009、srs §9）。
 *
 * - 設計要素: entity_registry（design_category 設定・分類 prefix 採番）+ resource_text
 *   （初期実装は全分類の本文を resource_text に格納する。STATE/IF/DATA 等の
 *   専用詳細テーブルへの展開は P10 の各編集機能で行う）
 * - 関係: trace_link（11 relation_type 限定）。relation_rule_master による許容関係・
 *   required_attr・重複を保存前に検査する
 * - 候補採用: 要素候補と関係候補を同一トランザクションで検査・反映する（MODEL-009）
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'
import { registerEntity } from '../store/entity-registry'
import { DESIGN_CATEGORIES, type DesignCategory } from '../store/entity-types'
import type { CandidateSet } from '../llm/candidate-validation'

function nowIso(): string {
  return new Date().toISOString()
}

// ---- P8-1: 設計要素 ----

export interface DesignElementInput {
  category: DesignCategory
  title: string
  description?: string
  ownerUid?: string
  createdBy?: string
}

export function createDesignElement(
  db: Database,
  projectUid: string,
  input: DesignElementInput
): { uid: string; code: string } {
  if (!DESIGN_CATEGORIES.includes(input.category)) {
    throw new BackendError('validation', `不正な設計分類です: ${input.category}`, '')
  }
  if (!input.title.trim()) {
    throw new BackendError('validation', 'タイトルは必須です', '')
  }
  const element = registerEntity(db, {
    projectUid,
    entityType: 'resource_text',
    designCategory: input.category,
    title: input.title,
    ownerUid: input.ownerUid,
    createdBy: input.createdBy ?? 'user'
  })
  db.prepare(`INSERT INTO resource_text (uid, text_body, text_role, language) VALUES (?, ?, 'description', 'ja')`).run(
    element.uid,
    input.description ?? input.title
  )
  return element
}

export interface DesignElementRow {
  uid: string
  code: string
  design_category: DesignCategory
  title: string | null
  status: string
  owner_uid: string | null
  description: string | null
  updated_at: string
  entity_type: string
  /** VERIF の検証条件・手順・期待結果（EDIT-042。resource_text.context_json） */
  verification_json: string | null
}

export function listDesignElements(
  db: Database,
  projectUid: string,
  filters?: { category?: DesignCategory; status?: string }
): DesignElementRow[] {
  const conditions = [`e.project_uid = ?`, `e.design_category IS NOT NULL`, `e.status <> 'deleted'`]
  const params: unknown[] = [projectUid]
  if (filters?.category) {
    conditions.push(`e.design_category = ?`)
    params.push(filters.category)
  }
  if (filters?.status) {
    conditions.push(`e.status = ?`)
    params.push(filters.status)
  }
  return db
    .prepare(
      `SELECT e.uid, e.code, e.design_category, e.title, e.status, e.owner_uid, e.updated_at, e.entity_type,
              t.text_body AS description, t.context_json AS verification_json
         FROM entity_registry e
         LEFT JOIN resource_text t ON t.uid = e.uid
        WHERE ${conditions.join(' AND ')}
        ORDER BY e.design_category, e.code`
    )
    .all(...params) as DesignElementRow[]
}

// ---- P10-5: 検証編集（EDIT-040〜042） ----

export interface VerificationDetail {
  condition: string
  procedure: string
  expected: string
}

/** VERIF 要素の検証条件・手順・期待結果を保存する（resource_text.context_json） */
export function setVerificationDetail(db: Database, uid: string, detail: VerificationDetail): void {
  const element = db
    .prepare(`SELECT design_category FROM entity_registry WHERE uid = ? AND status <> 'deleted'`)
    .get(uid) as { design_category: string | null } | undefined
  if (!element) {
    throw new BackendError('not_found', `設計要素が見つかりません: ${uid}`, '')
  }
  if (element.design_category !== 'VERIF') {
    throw new BackendError(
      'validation',
      '検証詳細は VERIF 分類の要素にのみ設定できます',
      `category=${element.design_category}`
    )
  }
  const result = db.prepare(`UPDATE resource_text SET context_json = ? WHERE uid = ?`).run(JSON.stringify(detail), uid)
  if (result.changes === 0) {
    throw new BackendError('not_found', `検証要素の本文リソースが見つかりません: ${uid}`, '')
  }
  db.prepare(`UPDATE entity_registry SET updated_at = ?, updated_by = 'user' WHERE uid = ?`).run(nowIso(), uid)
}

/**
 * 対象要素（REQ/CST/FUNC 等）に対する検証項目を作成し、verifies で紐づける（EDIT-040/041）。
 * 同一トランザクションで要素作成とリンクを行う。
 */
export function createVerificationFor(
  db: Database,
  projectUid: string,
  targetUid: string,
  title?: string
): { uid: string; code: string; linkUid: string } {
  const target = db
    .prepare(`SELECT code, title, design_category FROM entity_registry WHERE uid = ? AND status <> 'deleted'`)
    .get(targetUid) as { code: string; title: string | null; design_category: string | null } | undefined
  if (!target) {
    throw new BackendError('not_found', `検証対象が見つかりません: ${targetUid}`, '')
  }
  const txn = db.transaction(() => {
    const verif = createDesignElement(db, projectUid, {
      category: 'VERIF',
      title: title ?? `${target.title ?? target.code} の検証`,
      createdBy: 'user'
    })
    db.prepare(`UPDATE entity_registry SET status = 'approved', updated_at = ? WHERE uid = ?`).run(nowIso(), verif.uid)
    const link = createTraceLink(db, projectUid, {
      fromUid: verif.uid,
      toUid: targetUid,
      relationType: 'verifies',
      createdBy: 'human',
      reviewStatus: 'approved'
    })
    return { ...verif, linkUid: link.uid }
  })
  const result = txn()
  eventBus.emit('design_model.updated', { kind: 'verification-created', uid: result.uid })
  eventBus.emit('relation.updated', { count: 1 })
  return result
}

// ---- P8-2: 関係管理（relation_rule_master 検査） ----

export const RELATION_TYPES = [
  'based_on',
  'satisfies',
  'allocated_to',
  'verifies',
  'contains',
  'decomposes',
  'implements',
  'uses',
  'calls',
  'conflicts_with',
  'relates_to'
] as const
export type RelationType = (typeof RELATION_TYPES)[number]

export interface AllowedRelationRule {
  relationType: string
  sourceCategory: string
  targetCategory: string
}
export function listAllowedRelationRules(db: Database): AllowedRelationRule[] {
  return db
    .prepare(
      `SELECT relation_type AS relationType, source_category AS sourceCategory, target_category AS targetCategory FROM relation_rule_master WHERE allowed=1 ORDER BY relation_type,source_category,target_category`
    )
    .all() as AllowedRelationRule[]
}
export interface RelationCheckResult {
  allowed: boolean
  requiredAttr: string | null
  reason?: string
}

/** relation_rule_master による許容関係検査（ANY はワイルドカード） */
export function checkRelationAllowed(
  db: Database,
  relationType: string,
  sourceCategory: string | null,
  targetCategory: string | null
): RelationCheckResult {
  if (!RELATION_TYPES.includes(relationType as RelationType)) {
    return { allowed: false, requiredAttr: null, reason: `relation_type は11種類に限定されています: ${relationType}` }
  }
  const rule = db
    .prepare(
      `SELECT allowed, required_attr FROM relation_rule_master
        WHERE relation_type = ?
          AND (source_category = ? OR source_category = 'ANY')
          AND (target_category = ? OR target_category = 'ANY')
        ORDER BY CASE WHEN source_category = 'ANY' THEN 1 ELSE 0 END
        LIMIT 1`
    )
    .get(relationType, sourceCategory ?? 'ANY', targetCategory ?? 'ANY') as
    { allowed: number; required_attr: string | null } | undefined
  if (!rule || rule.allowed !== 1) {
    return {
      allowed: false,
      requiredAttr: null,
      reason: `許容されない関係です: ${sourceCategory ?? '?'} -[${relationType}]-> ${targetCategory ?? '?'}（relation_rule_master）`
    }
  }
  return { allowed: true, requiredAttr: rule.required_attr }
}

export interface TraceLinkAttributes {
  confidence?: number | null
  rationale?: string | null
  basisKind?: string | null
  evidenceSpan?: string | null
  transformNote?: string | null
  allocationKind?: string | null
  decompositionKind?: string | null
  usageKind?: string | null
  conflictStatus?: string | null
  contextUid?: string | null
}

export interface CreateTraceLinkInput {
  fromUid: string
  toUid: string
  relationType: RelationType
  attributes?: TraceLinkAttributes
  createdBy: 'human' | 'rule' | 'llm'
  reviewStatus?: 'draft' | 'review' | 'approved' | 'rejected' | 'provisional'
  llmRunUid?: string
}

function getDesignCategory(db: Database, uid: string): { category: string | null; exists: boolean } {
  const row = db
    .prepare(`SELECT design_category FROM entity_registry WHERE uid = ? AND status <> 'deleted'`)
    .get(uid) as { design_category: string | null } | undefined
  return { category: row?.design_category ?? null, exists: !!row }
}

/** 検査済み trace_link の作成（P8-2）。検査 NG は validation/conflict エラー */
export function createTraceLink(
  db: Database,
  projectUid: string,
  input: CreateTraceLinkInput
): { uid: string; code: string } {
  const from = getDesignCategory(db, input.fromUid)
  const to = getDesignCategory(db, input.toUid)
  if (!from.exists || !to.exists) {
    throw new BackendError(
      'validation',
      '関係の起点または終点が存在しません',
      `from=${input.fromUid} to=${input.toUid}`
    )
  }

  // based_on は根拠関係専用で、SRC・②③リソース等（design_category なし）を終点にできる
  const categorySensitive = !['based_on', 'relates_to', 'conflicts_with'].includes(input.relationType)
  if (categorySensitive) {
    const check = checkRelationAllowed(db, input.relationType, from.category, to.category)
    if (!check.allowed) {
      throw new BackendError('validation', check.reason ?? '許容されない関係です', '')
    }
    // required_attr 検査（srs §9.4）
    if (check.requiredAttr) {
      const attrValue = {
        basis_kind: input.attributes?.basisKind,
        allocation_kind: input.attributes?.allocationKind,
        decomposition_kind: input.attributes?.decompositionKind,
        usage_kind: input.attributes?.usageKind,
        conflict_status: input.attributes?.conflictStatus,
        review_status: input.reviewStatus ?? 'draft'
      }[check.requiredAttr]
      if (!attrValue) {
        throw new BackendError(
          'validation',
          `関係属性 ${check.requiredAttr} は必須です`,
          `relation_type=${input.relationType}`
        )
      }
    }
  }

  // 重複検査（同一 from/to/type。conflicts_with は context_uid 差分を許容）（§2.6）
  const dup = db
    .prepare(
      `SELECT COUNT(*) AS n FROM trace_link t JOIN entity_registry e ON e.uid = t.uid
        WHERE t.from_uid = ? AND t.to_uid = ? AND t.relation_type = ? AND e.status <> 'deleted'
          AND (t.relation_type <> 'conflicts_with' OR ifnull(t.context_uid, '') = ifnull(?, ''))`
    )
    .get(input.fromUid, input.toUid, input.relationType, input.attributes?.contextUid ?? null) as { n: number }
  if (dup.n > 0) {
    throw new BackendError(
      'conflict',
      '同一の関係が既に存在します',
      `${input.fromUid} -[${input.relationType}]-> ${input.toUid}`
    )
  }

  const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: input.createdBy })
  db.prepare(
    `INSERT INTO trace_link
       (uid, from_uid, to_uid, relation_type, rationale, confidence, created_by, review_status,
        basis_kind, evidence_span, transform_note, allocation_kind, decomposition_kind, usage_kind,
        conflict_status, context_uid, llm_run_uid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    input.attributes?.decompositionKind ?? null,
    input.attributes?.usageKind ?? null,
    input.attributes?.conflictStatus ?? null,
    input.attributes?.contextUid ?? null,
    input.llmRunUid ?? null
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
  const conditions = [`e.project_uid = ?`, `e.status <> 'deleted'`]
  const params: unknown[] = [projectUid]
  if (filters?.uid) {
    conditions.push(`(t.from_uid = ? OR t.to_uid = ?)`)
    params.push(filters.uid, filters.uid)
  }
  if (filters?.relationType) {
    conditions.push(`t.relation_type = ?`)
    params.push(filters.relationType)
  }
  return db
    .prepare(
      `SELECT e.uid, e.code, t.from_uid, t.to_uid, t.relation_type, t.review_status, t.rationale, t.confidence, t.created_by,
              ef.title AS from_title, ef.code AS from_code, et.title AS to_title, et.code AS to_code
         FROM trace_link t
         JOIN entity_registry e ON e.uid = t.uid
         JOIN entity_registry ef ON ef.uid = t.from_uid
         JOIN entity_registry et ON et.uid = t.to_uid
        WHERE ${conditions.join(' AND ')}
        ORDER BY e.code`
    )
    .all(...params) as TraceLinkRow[]
}

// ---- P8-5: 候補セット採用トランザクション（MODEL-006〜009） ----

export interface AdoptCandidatesInput {
  candidateSet: CandidateSet
  /** 根拠となる③中間文書（based_on の対象。MODEL-009 の根拠リンク） */
  intermediateDocumentUid: string
  llmRunUid?: string
}

export interface AdoptCandidatesResult {
  elements: { tempId: string; uid: string; code: string }[]
  relationCount: number
  basedOnCount: number
}

export function adoptCandidates(db: Database, projectUid: string, input: AdoptCandidatesInput): AdoptCandidatesResult {
  const { candidateSet } = input
  if (candidateSet.elements.length === 0) {
    throw new BackendError('validation', '採用する要素候補がありません', '')
  }
  // 根拠リンク不足の検査（MODEL-009）
  const intermediate = db
    .prepare(`SELECT uid FROM intermediate_document WHERE uid = ?`)
    .get(input.intermediateDocumentUid) as { uid: string } | undefined
  if (!intermediate) {
    throw new BackendError(
      'validation',
      '根拠となる③中間文書が存在しません（根拠リンク不足）',
      input.intermediateDocumentUid
    )
  }

  const txn = db.transaction((): AdoptCandidatesResult => {
    // 1) 要素候補 → 一時ID→UUIDv7 変換して正本登録
    const uidByTempId = new Map<string, { uid: string; code: string; category: string }>()
    for (const element of candidateSet.elements) {
      if (uidByTempId.has(element.temp_id)) {
        throw new BackendError('validation', `一時IDが重複しています: ${element.temp_id}`, '')
      }
      const created = createDesignElement(db, projectUid, {
        category: element.category as DesignCategory,
        title: element.title,
        description: element.description ?? undefined,
        createdBy: 'llm'
      })
      // 採用済み = 正本（approved）
      db.prepare(
        `UPDATE entity_registry SET status = 'approved', updated_by = 'user', updated_at = ? WHERE uid = ?`
      ).run(nowIso(), created.uid)
      uidByTempId.set(element.temp_id, { ...created, category: element.category })
    }

    // 2) 根拠リンク: 要素 → ③中間文書（based_on、basis_kind=inferred、llm_run 参照）
    let basedOnCount = 0
    for (const [tempId, element] of uidByTempId) {
      const evidence = candidateSet.elements.find((e) => e.temp_id === tempId)?.evidence ?? null
      createTraceLink(db, projectUid, {
        fromUid: element.uid,
        toUid: input.intermediateDocumentUid,
        relationType: 'based_on',
        attributes: { basisKind: 'inferred', evidenceSpan: evidence },
        createdBy: 'llm',
        reviewStatus: 'approved',
        llmRunUid: input.llmRunUid
      })
      basedOnCount++
    }

    // 3) 関係候補 → 未解決参照・許容関係・重複を検査して登録（NG があれば全体 ROLLBACK）
    let relationCount = 0
    for (const relation of candidateSet.relations) {
      const from = uidByTempId.get(relation.from_temp_id)
      const to = uidByTempId.get(relation.to_temp_id)
      if (!from || !to) {
        throw new BackendError(
          'validation',
          `関係候補の参照が未解決です: ${relation.from_temp_id} -> ${relation.to_temp_id}`,
          '要素候補に含まれない一時IDです（MODEL-009）'
        )
      }
      createTraceLink(db, projectUid, {
        fromUid: from.uid,
        toUid: to.uid,
        relationType: relation.relation_type as RelationType,
        attributes: {
          rationale: relation.rationale ?? null,
          confidence: relation.confidence ?? null,
          ...(relation.attributes as TraceLinkAttributes | undefined)
        },
        createdBy: 'llm',
        reviewStatus: 'approved',
        llmRunUid: input.llmRunUid
      })
      relationCount++
    }

    return {
      elements: [...uidByTempId.entries()].map(([tempId, e]) => ({ tempId, uid: e.uid, code: e.code })),
      relationCount,
      basedOnCount
    }
  })

  const result = txn()
  eventBus.emit('design_model.updated', {
    elementCount: result.elements.length,
    relationCount: result.relationCount,
    llmRunUid: input.llmRunUid ?? null
  })
  eventBus.emit('relation.updated', { count: result.relationCount + result.basedOnCount })
  return result
}
