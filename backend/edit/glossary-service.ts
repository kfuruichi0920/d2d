/**
 * 用語集（P10-6、EDIT-050〜056、sdd_data_structure §10.2）。
 * 用語は entity_registry + resource_glossary で管理し、状態は entity_registry.status
 * （draft=候補 / approved=承認済）。設計要素とのリンクは trace_link（relates_to）。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { registerEntity } from '../store/entity-registry'

/** 表記正規化: NFKC + 小文字 + 長音・中点・空白除去（揺れ検出・重複判定用） */
export function normalizeTerm(term: string): string {
  return term
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ー\-・\s]/g, '')
}

export interface GlossaryTerm {
  uid: string
  code: string
  status: string
  term_text: string
  normalized_text: string
  definition: string | null
  abbreviation: string | null
  category: string | null
  is_prohibited: number
  synonyms: { uid: string; synonym_text: string; synonym_kind: string }[]
}

export interface AddTermInput {
  term: string
  definition?: string
  abbreviation?: string
  category?: string
  prohibited?: boolean
  /** true なら承認済みとして登録（既定は候補 draft） */
  approved?: boolean
  createdBy?: string
}

export function addTerm(db: Database, projectUid: string, input: AddTermInput): { uid: string; code: string } {
  if (!input.term.trim()) {
    throw new BackendError('validation', '用語は必須です', '')
  }
  const normalized = normalizeTerm(input.term)
  const element = registerEntity(db, {
    projectUid,
    entityType: 'resource_glossary',
    title: input.term,
    status: input.approved ? 'approved' : 'draft',
    createdBy: input.createdBy ?? 'user'
  })
  try {
    db.prepare(
      `INSERT INTO resource_glossary (uid, term_text, normalized_text, definition, abbreviation, category, is_prohibited)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      element.uid,
      input.term,
      normalized,
      input.definition ?? null,
      input.abbreviation ?? null,
      input.category ?? null,
      input.prohibited ? 1 : 0
    )
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      throw new BackendError('conflict', `同一表記の用語が既に存在します: ${input.term}`, `normalized=${normalized}`)
    }
    throw err
  }
  return element
}

export function addSynonym(
  db: Database,
  projectUid: string,
  glossaryUid: string,
  synonymText: string,
  kind: 'synonym' | 'variant' | 'abbreviation' = 'synonym'
): { uid: string } {
  const element = registerEntity(db, {
    projectUid,
    entityType: 'resource_glossary_synonym',
    title: synonymText,
    createdBy: 'user'
  })
  try {
    db.prepare(
      `INSERT INTO resource_glossary_synonym (uid, glossary_uid, synonym_text, synonym_kind) VALUES (?, ?, ?, ?)`
    ).run(element.uid, glossaryUid, synonymText, kind)
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      throw new BackendError('conflict', `同一の同義語が既に存在します: ${synonymText}`, '')
    }
    if (err instanceof Error && /FOREIGN KEY/.test(err.message)) {
      throw new BackendError('not_found', `用語が見つかりません: ${glossaryUid}`, '')
    }
    throw err
  }
  return element
}

export function listTerms(db: Database, projectUid: string, options?: { approvedOnly?: boolean }): GlossaryTerm[] {
  const terms = db
    .prepare(
      `SELECT e.uid, e.code, e.status, g.term_text, g.normalized_text, g.definition, g.abbreviation, g.category, g.is_prohibited
         FROM resource_glossary g JOIN entity_registry e ON e.uid = g.uid
        WHERE e.project_uid = ? AND e.status <> 'deleted' ${options?.approvedOnly ? `AND e.status = 'approved'` : ''}
        ORDER BY g.term_text`
    )
    .all(projectUid) as Omit<GlossaryTerm, 'synonyms'>[]
  const synonymsStmt = db.prepare(
    `SELECT s.uid, s.synonym_text, s.synonym_kind FROM resource_glossary_synonym s
       JOIN entity_registry e ON e.uid = s.uid AND e.status <> 'deleted'
      WHERE s.glossary_uid = ?`
  )
  return terms.map((term) => ({
    ...term,
    synonyms: synonymsStmt.all(term.uid) as GlossaryTerm['synonyms']
  }))
}

export function setTermStatus(db: Database, uid: string, status: 'draft' | 'approved' | 'rejected' | 'deleted'): void {
  const result = db
    .prepare(`UPDATE entity_registry SET status = ?, updated_by = 'user', updated_at = ? WHERE uid = ?`)
    .run(status, new Date().toISOString(), uid)
  if (result.changes === 0) {
    throw new BackendError('not_found', `用語が見つかりません: ${uid}`, '')
  }
  if (status === 'approved') {
    db.prepare(`UPDATE resource_glossary SET confirmed_at = ? WHERE uid = ?`).run(new Date().toISOString(), uid)
  }
}

/** 用語と文書・設計要素のリンク（EDIT-053。trace_link relates_to を使う。§10.2） */
export function linkTermToElement(
  db: Database,
  projectUid: string,
  termUid: string,
  elementUid: string
): { uid: string } {
  const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'human' })
  db.prepare(
    `INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, created_by, review_status, rationale)
     VALUES (?, ?, ?, 'relates_to', 'human', 'approved', '用語リンク')`
  ).run(link.uid, termUid, elementUid)
  return link
}

// ---- 用語候補抽出（EDIT-051、ルールベース。LLM 候補は P6 経由で別途） ----

const CANDIDATE_PATTERNS = [
  /[ァ-ヶー]{3,}/g, // カタカナ語（3文字以上）
  /[A-Z]{2,}[0-9]*/g, // 英大文字略語
  /[A-Za-z][A-Za-z0-9_.-]{2,}/g // 英単語・識別子
]

export function extractTermCandidates(text: string, existingNormalized: Set<string>): string[] {
  const found = new Map<string, string>()
  for (const pattern of CANDIDATE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const term = match[0]
      const normalized = normalizeTerm(term)
      if (normalized.length >= 2 && !existingNormalized.has(normalized) && !found.has(normalized)) {
        found.set(normalized, term)
      }
    }
  }
  return [...found.values()]
}

// ---- 揺れ検出（EDIT-052） ----

export interface VariantGroup {
  normalized: string
  variants: { uid: string; text: string; source: 'term' | 'synonym' }[]
}

/**
 * 正規化表記が一致する用語・同義語のグループ（= 表記揺れの疑い）を返す。
 * 用語同士は UNIQUE 制約で防がれるため、主に「別用語の同義語と衝突」を検出する。
 */
export function detectVariants(db: Database, projectUid: string): VariantGroup[] {
  const entries: { uid: string; text: string; source: 'term' | 'synonym' }[] = []
  for (const term of listTerms(db, projectUid)) {
    entries.push({ uid: term.uid, text: term.term_text, source: 'term' })
    for (const synonym of term.synonyms) {
      entries.push({ uid: term.uid, text: synonym.synonym_text, source: 'synonym' })
    }
  }
  const groups = new Map<string, VariantGroup>()
  for (const entry of entries) {
    const normalized = normalizeTerm(entry.text)
    const group = groups.get(normalized) ?? { normalized, variants: [] }
    group.variants.push(entry)
    groups.set(normalized, group)
  }
  return [...groups.values()].filter(
    (group) =>
      new Set(group.variants.map((v) => `${v.uid}:${v.text}`)).size > 1 &&
      new Set(group.variants.map((v) => v.uid)).size > 1
  )
}
