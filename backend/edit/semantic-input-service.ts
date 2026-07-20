/**
 * セマンティック入力支援（P10-7、EDIT-057〜071）。
 * 表示文章、原文、構造化参照、正規化履歴を分離し、承認済み参照だけを trace_link へ確定する。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { checkRelationAllowed, createTraceLink, RELATION_TYPES, type RelationType } from '../design/design-service'
import { newUid } from '../store/uid'
import { extractTermCandidates, listTerms, normalizeTerm } from './glossary-service'

export const DISPLAY_MODES = ['link', 'string', 'id', 'uid'] as const
export type SemanticDisplayMode = (typeof DISPLAY_MODES)[number]
export type SemanticTargetKind = 'glossary' | 'model'
export type SemanticReferenceStatus = 'candidate' | 'approved' | 'rejected'
export interface SemanticInputPolicy {
  candidateKinds: Array<'glossary' | 'model' | 'recent'>
  relationTypes: RelationType[]
  dictionaryScopes: string[]
  minimumPrefixLength: number
  maximumCandidates: number
  automaticMechanicalNormalization: boolean
  defaultDisplayMode: SemanticDisplayMode
  defaultRelationType: RelationType
  requireApprovalForStrongRelations: boolean
}
export const DEFAULT_SEMANTIC_POLICY: SemanticInputPolicy = {
  candidateKinds: ['glossary', 'model', 'recent'],
  relationTypes: [...RELATION_TYPES],
  dictionaryScopes: ['project'],
  minimumPrefixLength: 2,
  maximumCandidates: 30,
  automaticMechanicalNormalization: false,
  defaultDisplayMode: 'link',
  defaultRelationType: 'relates_to',
  requireApprovalForStrongRelations: true
}
export interface SemanticReferenceInput {
  uid?: string
  startOffset: number
  endOffset: number
  surfaceText: string
  targetUid: string
  targetKind: SemanticTargetKind
  displayMode: SemanticDisplayMode
  relationType: RelationType
  status: SemanticReferenceStatus
  source: 'user' | 'dictionary' | 'morphology' | 'llm'
  confidence?: number | null
}
export interface SemanticTextDocument {
  uid?: string
  ownerUid: string
  fieldName: string
  originalText: string
  displayText: string
  policy: SemanticInputPolicy
  references: SemanticReferenceInput[]
  history: SemanticHistory[]
}
export interface SemanticHistory {
  uid: string
  beforeText: string
  afterText: string
  method: 'mechanical' | 'dictionary' | 'llm' | 'user'
  status: 'candidate' | 'approved' | 'rejected' | 'reverted'
  detail: Record<string, unknown>
  createdAt: string
  decidedAt: string | null
}
export interface SemanticCandidate {
  uid: string
  code: string
  title: string
  kind: SemanticTargetKind
  status: string
  definition: string | null
  category: string | null
  matchedText: string
  scope: string
  deprecated: number
  versionTag: string | null
  accessLevel: string
}

function parsePolicy(raw?: string): SemanticInputPolicy {
  try {
    return { ...DEFAULT_SEMANTIC_POLICY, ...(raw ? (JSON.parse(raw) as Partial<SemanticInputPolicy>) : {}) }
  } catch {
    return structuredClone(DEFAULT_SEMANTIC_POLICY)
  }
}
function ensureOwner(db: Database, projectUid: string, ownerUid: string): void {
  if (
    !db
      .prepare(`SELECT 1 FROM entity_registry WHERE uid=? AND project_uid=? AND status<>'deleted'`)
      .get(ownerUid, projectUid)
  )
    throw new BackendError('not_found', `参照元Resourceが見つかりません: ${ownerUid}`, '')
}
function targetRow(db: Database, projectUid: string, uid: string): { entity_type: string } {
  const row = db
    .prepare(`SELECT entity_type FROM entity_registry WHERE uid=? AND project_uid=? AND status<>'deleted'`)
    .get(uid, projectUid) as { entity_type: string } | undefined
  if (!row) throw new BackendError('validation', `参照先UIDが存在しません: ${uid}`, '')
  return row
}
export function validateSemanticDocument(
  db: Database,
  projectUid: string,
  document: Omit<SemanticTextDocument, 'history'>
): { valid: true } {
  ensureOwner(db, projectUid, document.ownerUid)
  if (!document.fieldName.trim()) throw new BackendError('validation', 'fieldName は必須です', '')
  let previousEnd = 0
  for (const ref of [...document.references].sort((a, b) => a.startOffset - b.startOffset)) {
    if (
      !Number.isInteger(ref.startOffset) ||
      !Number.isInteger(ref.endOffset) ||
      ref.startOffset < 0 ||
      ref.endOffset <= ref.startOffset ||
      ref.endOffset > document.displayText.length
    )
      throw new BackendError('validation', '構造化参照の文字範囲が不正です', JSON.stringify(ref))
    if (ref.startOffset < previousEnd)
      throw new BackendError('validation', '構造化参照の文字範囲が重複しています', JSON.stringify(ref))
    if (document.displayText.slice(ref.startOffset, ref.endOffset) !== ref.surfaceText)
      throw new BackendError('validation', 'surfaceText と表示文章の文字範囲が一致しません', JSON.stringify(ref))
    if (!DISPLAY_MODES.includes(ref.displayMode))
      throw new BackendError('validation', `未対応の表示方法です: ${ref.displayMode}`, '')
    if (!RELATION_TYPES.includes(ref.relationType))
      throw new BackendError('validation', `未対応の関係種別です: ${ref.relationType}`, '')
    const target = targetRow(db, projectUid, ref.targetUid)
    if (ref.targetKind === 'glossary' && target.entity_type !== 'resource_glossary')
      throw new BackendError('validation', '辞書参照のUIDが用語ではありません', ref.targetUid)
    if (ref.targetKind === 'model' && !target.entity_type.startsWith('model_'))
      throw new BackendError('validation', 'モデル参照のUIDが model_* ではありません', ref.targetUid)
    if (ref.status === 'approved' && !['based_on', 'relates_to', 'conflicts_with'].includes(ref.relationType)) {
      const source = targetRow(db, projectUid, document.ownerUid)
      const check = checkRelationAllowed(db, ref.relationType, source.entity_type, target.entity_type)
      if (!check.allowed) throw new BackendError('validation', check.reason ?? '許容されない関係です', '')
      if (check.requiredAttr)
        throw new BackendError(
          'validation',
          `${ref.relationType} には関係属性 ${check.requiredAttr} の指定が必要です`,
          ''
        )
    }
    previousEnd = ref.endOffset
  }
  return { valid: true }
}
export function getSemanticText(
  db: Database,
  projectUid: string,
  ownerUid: string,
  fieldName: string,
  fallbackText = ''
): SemanticTextDocument {
  ensureOwner(db, projectUid, ownerUid)
  const row = db
    .prepare(
      `SELECT uid,original_text,display_text,policy_json FROM semantic_text WHERE project_uid=? AND owner_uid=? AND field_name=?`
    )
    .get(projectUid, ownerUid, fieldName) as
    { uid: string; original_text: string; display_text: string; policy_json: string } | undefined
  if (!row) {
    // 承認済み辞書・モデルの完全一致は、意味の弱い relates_to 参照として初期表示する。
    // DBへの確定はResource保存時まで行わない。
    const recognized = analyzeSemanticText(db, projectUid, fallbackText).references.map((reference) => ({
      ...reference,
      status: 'approved' as const
    }))
    return {
      ownerUid,
      fieldName,
      originalText: fallbackText,
      displayText: fallbackText,
      policy: structuredClone(DEFAULT_SEMANTIC_POLICY),
      references: recognized,
      history: []
    }
  }
  const references = db
    .prepare(
      `SELECT uid,start_offset AS startOffset,end_offset AS endOffset,surface_text AS surfaceText,target_uid AS targetUid,target_kind AS targetKind,display_mode AS displayMode,relation_type AS relationType,status,source,confidence FROM semantic_reference WHERE semantic_text_uid=? ORDER BY start_offset,uid`
    )
    .all(row.uid) as SemanticReferenceInput[]
  const historyRows = db
    .prepare(
      `SELECT uid,before_text AS beforeText,after_text AS afterText,method,status,detail_json AS detailJson,created_at AS createdAt,decided_at AS decidedAt FROM semantic_normalization_history WHERE semantic_text_uid=? ORDER BY created_at DESC`
    )
    .all(row.uid) as Array<Omit<SemanticHistory, 'detail'> & { detailJson: string }>
  return {
    uid: row.uid,
    ownerUid,
    fieldName,
    originalText: row.original_text,
    displayText: row.display_text,
    policy: parsePolicy(row.policy_json),
    references,
    history: historyRows.map(({ detailJson, ...h }) => ({
      ...h,
      detail: JSON.parse(detailJson) as Record<string, unknown>
    }))
  }
}
export function saveSemanticText(
  db: Database,
  projectUid: string,
  input: Omit<SemanticTextDocument, 'history'> & {
    normalization?: {
      beforeText: string
      afterText: string
      method: SemanticHistory['method']
      status: SemanticHistory['status']
      detail?: Record<string, unknown>
    }
  }
): { uid: string; createdTraceLinks: string[] } {
  validateSemanticDocument(db, projectUid, input)
  const now = new Date().toISOString()
  return db.transaction(() => {
    const existing = db
      .prepare(`SELECT uid FROM semantic_text WHERE owner_uid=? AND field_name=?`)
      .get(input.ownerUid, input.fieldName) as { uid: string } | undefined
    const uid = existing?.uid ?? newUid()
    if (existing)
      db.prepare(`UPDATE semantic_text SET display_text=?,policy_json=?,updated_at=? WHERE uid=?`).run(
        input.displayText,
        JSON.stringify(input.policy),
        now,
        uid
      )
    else
      db.prepare(
        `INSERT INTO semantic_text (uid,project_uid,owner_uid,field_name,original_text,display_text,policy_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        uid,
        projectUid,
        input.ownerUid,
        input.fieldName,
        input.originalText,
        input.displayText,
        JSON.stringify(input.policy),
        now,
        now
      )
    db.prepare(`DELETE FROM semantic_reference WHERE semantic_text_uid=?`).run(uid)
    const insert = db.prepare(
      `INSERT INTO semantic_reference (uid,semantic_text_uid,start_offset,end_offset,surface_text,target_uid,target_kind,display_mode,relation_type,status,source,confidence,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
    )
    const createdTraceLinks: string[] = []
    for (const ref of input.references) {
      insert.run(
        ref.uid ?? newUid(),
        uid,
        ref.startOffset,
        ref.endOffset,
        ref.surfaceText,
        ref.targetUid,
        ref.targetKind,
        ref.displayMode,
        ref.relationType,
        ref.status,
        ref.source,
        ref.confidence ?? null,
        now,
        now
      )
      if (ref.status !== 'approved') continue
      if (ref.targetKind !== 'model') continue
      const owner = targetRow(db, projectUid, input.ownerUid)
      const ownerIsModel = owner.entity_type.startsWith('model_')
      // ②③Resourceから④モデルへの参照は、設計モデル→根拠Resourceのbased_onへ正規化する。
      const fromUid = ownerIsModel ? input.ownerUid : ref.targetUid
      const toUid = ownerIsModel ? ref.targetUid : input.ownerUid
      const relationType = ownerIsModel ? ref.relationType : 'based_on'
      const duplicate = db
        .prepare(
          `SELECT t.uid FROM trace_link t JOIN entity_registry e ON e.uid=t.uid WHERE t.from_uid=? AND t.to_uid=? AND t.relation_type=? AND e.status<>'deleted' LIMIT 1`
        )
        .get(fromUid, toUid, relationType) as { uid: string } | undefined
      if (!duplicate) {
        const link = createTraceLink(db, projectUid, {
          fromUid,
          toUid,
          relationType,
          createdBy: ref.source === 'llm' ? 'llm' : ref.source === 'user' ? 'human' : 'rule',
          reviewStatus: 'approved',
          attributes: {
            basisKind: relationType === 'based_on' ? 'human_approved' : undefined,
            rationale: `${input.fieldName} のセマンティック参照`,
            evidenceSpan: JSON.stringify({
              semanticTextUid: uid,
              startOffset: ref.startOffset,
              endOffset: ref.endOffset
            })
          }
        })
        createdTraceLinks.push(link.uid)
      }
    }
    if (input.normalization)
      db.prepare(
        `INSERT INTO semantic_normalization_history (uid,semantic_text_uid,before_text,after_text,method,status,detail_json,created_at,decided_at) VALUES (?,?,?,?,?,?,?,?,?)`
      ).run(
        newUid(),
        uid,
        input.normalization.beforeText,
        input.normalization.afterText,
        input.normalization.method,
        input.normalization.status,
        JSON.stringify(input.normalization.detail ?? {}),
        now,
        input.normalization.status === 'candidate' ? null : now
      )
    return { uid, createdTraceLinks }
  })()
}
function prefixLike(prefix: string): string {
  return `${prefix.replace(/[\\%_]/g, '\\$&')}%`
}
export function searchSemanticCandidates(
  db: Database,
  projectUid: string,
  prefix: string,
  policy: Partial<SemanticInputPolicy> = {}
): {
  query: string
  tooBroad: boolean
  groups: { recent: SemanticCandidate[]; glossary: SemanticCandidate[]; model: SemanticCandidate[] }
} {
  const resolved = { ...DEFAULT_SEMANTIC_POLICY, ...policy },
    query = prefix.trim()
  if (query.length < resolved.minimumPrefixLength)
    return { query, tooBroad: true, groups: { recent: [], glossary: [], model: [] } }
  const limit = Math.max(1, Math.min(100, resolved.maximumCandidates)),
    like = prefixLike(query)
  const glossary = resolved.candidateKinds.includes('glossary')
    ? (db
        .prepare(
          `SELECT e.uid,e.code,g.term_text AS title,'glossary' AS kind,e.status,g.definition,g.category,CASE WHEN g.term_text LIKE ? ESCAPE '\\' THEN g.term_text ELSE s.synonym_text END AS matchedText,g.dictionary_scope AS scope,g.is_deprecated AS deprecated,g.version_tag AS versionTag,g.access_level AS accessLevel FROM resource_glossary g JOIN entity_registry e ON e.uid=g.uid LEFT JOIN resource_glossary_synonym s ON s.glossary_uid=g.uid WHERE e.project_uid=? AND e.status='approved' AND g.is_deprecated=0 AND g.access_level<>'none' AND (g.term_text LIKE ? ESCAPE '\\' OR g.normalized_text LIKE ? ESCAPE '\\' OR s.synonym_text LIKE ? ESCAPE '\\') GROUP BY e.uid ORDER BY g.term_text LIMIT ?`
        )
        .all(like, projectUid, like, prefixLike(normalizeTerm(query)), like, limit) as SemanticCandidate[])
    : []
  const model = resolved.candidateKinds.includes('model')
    ? (db
        .prepare(
          `SELECT e.uid,e.code,coalesce(e.title,e.code) AS title,'model' AS kind,e.status,NULL AS definition,e.entity_type AS category,coalesce(e.title,e.code) AS matchedText,'project' AS scope,0 AS deprecated,NULL AS versionTag,'write' AS accessLevel FROM entity_registry e WHERE e.project_uid=? AND e.status='approved' AND e.entity_type LIKE 'model_%' AND (e.title LIKE ? ESCAPE '\\' OR e.code LIKE ? ESCAPE '\\') ORDER BY e.title,e.code LIMIT ?`
        )
        .all(projectUid, like, like, limit) as SemanticCandidate[])
    : []
  const recent = resolved.candidateKinds.includes('recent')
    ? (db
        .prepare(
          `SELECT e.uid,e.code,coalesce(g.term_text,e.title,e.code) AS title,CASE WHEN e.entity_type='resource_glossary' THEN 'glossary' ELSE 'model' END AS kind,e.status,g.definition,coalesce(g.category,e.entity_type) AS category,coalesce(g.term_text,e.title,e.code) AS matchedText,coalesce(g.dictionary_scope,'project') AS scope,coalesce(g.is_deprecated,0) AS deprecated,g.version_tag AS versionTag,coalesce(g.access_level,'write') AS accessLevel FROM semantic_reference r JOIN semantic_text st ON st.uid=r.semantic_text_uid JOIN entity_registry e ON e.uid=r.target_uid LEFT JOIN resource_glossary g ON g.uid=e.uid WHERE st.project_uid=? AND r.status='approved' AND e.status='approved' AND coalesce(g.is_deprecated,0)=0 AND coalesce(g.access_level,'write')<>'none' AND (coalesce(g.term_text,e.title,e.code) LIKE ? ESCAPE '\\' OR e.code LIKE ? ESCAPE '\\') GROUP BY e.uid ORDER BY max(r.updated_at) DESC LIMIT 8`
        )
        .all(projectUid, like, like) as SemanticCandidate[])
    : []
  return { query, tooBroad: false, groups: { recent, glossary, model } }
}
export function analyzeSemanticText(
  db: Database,
  projectUid: string,
  text: string,
  morphologyTokens: string[] = []
): {
  references: SemanticReferenceInput[]
  normalizations: Array<{ before: string; after: string; mechanical: boolean; targetUid: string }>
  unknownTerms: string[]
} {
  const references: SemanticReferenceInput[] = [],
    normalizations: Array<{ before: string; after: string; mechanical: boolean; targetUid: string }> = [],
    occupied: Array<[number, number]> = []
  const terms = listTerms(db, projectUid, { approvedOnly: true })
  const variants: Array<{ text: string; canonical: string; uid: string; kind: SemanticTargetKind }> = terms.flatMap(
    (term) => [
      { text: term.term_text, canonical: term.term_text, uid: term.uid, kind: 'glossary' as const },
      ...term.synonyms.map((s) => ({
        text: s.synonym_text,
        canonical: term.term_text,
        uid: term.uid,
        kind: 'glossary' as const
      }))
    ]
  )
  const models = db
    .prepare(
      `SELECT uid,title FROM entity_registry WHERE project_uid=? AND status='approved' AND entity_type LIKE 'model_%' AND title IS NOT NULL`
    )
    .all(projectUid) as { uid: string; title: string }[]
  variants.push(...models.map((m) => ({ text: m.title, canonical: m.title, uid: m.uid, kind: 'model' as const })))
  for (const item of variants.sort((a, b) => b.text.length - a.text.length)) {
    let start = text.indexOf(item.text)
    while (start >= 0) {
      const end = start + item.text.length
      if (!occupied.some(([a, b]) => start < b && end > a)) {
        references.push({
          startOffset: start,
          endOffset: end,
          surfaceText: item.text,
          targetUid: item.uid,
          targetKind: item.kind,
          displayMode: 'link',
          relationType: 'relates_to',
          status: 'candidate',
          source: 'dictionary',
          confidence: 1
        })
        occupied.push([start, end])
        if (item.text !== item.canonical)
          normalizations.push({
            before: item.text,
            after: item.canonical,
            mechanical: normalizeTerm(item.text) === normalizeTerm(item.canonical),
            targetUid: item.uid
          })
      }
      start = text.indexOf(item.text, end)
    }
  }
  const existing = new Set(
    terms.flatMap((term) => [term.normalized_text, ...term.synonyms.map((s) => normalizeTerm(s.synonym_text))])
  )
  const morphology = morphologyTokens
    .map((token) => token.trim())
    .filter((token) => token.length >= 2 && !/^[ぁ-ん]+$/.test(token) && !existing.has(normalizeTerm(token)))
  return {
    references: references.sort((a, b) => a.startOffset - b.startOffset),
    normalizations,
    unknownTerms: [...new Set([...extractTermCandidates(text, existing), ...morphology])]
  }
}
export function parseStructuredSemanticText(
  db: Database,
  projectUid: string,
  ownerUid: string,
  fieldName: string,
  json: string
): Omit<SemanticTextDocument, 'history'> {
  let value: Record<string, unknown>
  try {
    value = JSON.parse(json) as Record<string, unknown>
  } catch (error) {
    throw new BackendError('validation', '構造化データがJSONとして不正です', String(error))
  }
  if (value.schemaVersion !== 1) throw new BackendError('validation', 'schemaVersion は 1 を指定してください', '')
  if (typeof value.displayText !== 'string' || !Array.isArray(value.references))
    throw new BackendError('validation', 'displayText と references が必要です', '')
  const document = {
    ownerUid,
    fieldName,
    originalText: typeof value.originalText === 'string' ? value.originalText : value.displayText,
    displayText: value.displayText,
    policy: { ...DEFAULT_SEMANTIC_POLICY, ...((value.policy as Partial<SemanticInputPolicy>) ?? {}) },
    references: value.references as SemanticReferenceInput[]
  }
  validateSemanticDocument(db, projectUid, document)
  return document
}
