import { getDatabase } from '../db/database'
import { createEntityEntry } from '../store/entity-registry'
import { withTransaction } from '../store/store-access'

export interface GlossaryTermRow {
  uid: string
  code: string
  term_text: string
  normalized_text: string
  definition: string | null
  abbreviation: string | null
  language: string | null
  category: string | null
  is_prohibited: number
  confirmed_at: string | null
  synonym_count: number
}

export interface GlossarySynonymRow {
  uid: string
  glossary_uid: string
  synonym_text: string
  synonym_kind: string | null
  created_at: string
}

let _glossaryCounter: number | null = null

function nextGloCode(): string {
  if (_glossaryCounter === null) {
    const row = getDatabase()
      .prepare(`SELECT COUNT(*) AS cnt FROM resource_glossary`)
      .get() as { cnt: number }
    _glossaryCounter = row.cnt
  }
  _glossaryCounter += 1
  return `GLO-${String(_glossaryCounter).padStart(4, '0')}`
}

export interface CreateGlossaryOptions {
  termText: string
  definition?: string
  abbreviation?: string
  language?: string
  category?: string
  isProhibited?: boolean
}

export function createGlossaryTerm(opts: CreateGlossaryOptions): string {
  return withTransaction(() => {
    const code = nextGloCode()
    const normalized = opts.termText.trim().toLowerCase()
    const uid = createEntityEntry({ entityType: 'resource_glossary', code, title: opts.termText })
    getDatabase()
      .prepare(
        `INSERT INTO resource_glossary
         (uid, term_text, normalized_text, definition, abbreviation, language, category, is_prohibited)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        uid,
        opts.termText,
        normalized,
        opts.definition ?? null,
        opts.abbreviation ?? null,
        opts.language ?? 'ja',
        opts.category ?? null,
        opts.isProhibited ? 1 : 0
      )
    return uid
  })
}

export function listGlossaryTerms(opts?: {
  language?: string
  category?: string
  search?: string
  isProhibited?: boolean
  limit?: number
}): GlossaryTermRow[] {
  const conditions: string[] = []
  const params: unknown[] = []

  if (opts?.language) { conditions.push(`g.language = ?`); params.push(opts.language) }
  if (opts?.category) { conditions.push(`g.category = ?`); params.push(opts.category) }
  if (opts?.isProhibited !== undefined) { conditions.push(`g.is_prohibited = ?`); params.push(opts.isProhibited ? 1 : 0) }
  if (opts?.search) {
    conditions.push(`(g.term_text LIKE ? OR g.normalized_text LIKE ? OR g.definition LIKE ?)`)
    const like = `%${opts.search}%`
    params.push(like, like, like)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  params.push(opts?.limit ?? 500)

  return getDatabase()
    .prepare(
      `SELECT g.uid, er.code, g.term_text, g.normalized_text, g.definition,
              g.abbreviation, g.language, g.category, g.is_prohibited, g.confirmed_at,
              COUNT(s.uid) AS synonym_count
       FROM resource_glossary g
       JOIN entity_registry er ON er.uid = g.uid
       LEFT JOIN resource_glossary_synonym s ON s.glossary_uid = g.uid
       ${where}
       GROUP BY g.uid
       ORDER BY g.term_text
       LIMIT ?`
    )
    .all(...params) as GlossaryTermRow[]
}

export function getGlossaryTerm(uid: string): GlossaryTermRow | undefined {
  return getDatabase()
    .prepare(
      `SELECT g.uid, er.code, g.term_text, g.normalized_text, g.definition,
              g.abbreviation, g.language, g.category, g.is_prohibited, g.confirmed_at,
              COUNT(s.uid) AS synonym_count
       FROM resource_glossary g
       JOIN entity_registry er ON er.uid = g.uid
       LEFT JOIN resource_glossary_synonym s ON s.glossary_uid = g.uid
       WHERE g.uid = ?
       GROUP BY g.uid`
    )
    .get(uid) as GlossaryTermRow | undefined
}

export function updateGlossaryTerm(
  uid: string,
  updates: Partial<Omit<CreateGlossaryOptions, 'termText'> & { termText?: string; confirmedAt?: string | null }>
): void {
  const db = getDatabase()
  if (updates.termText !== undefined) {
    db.prepare(`UPDATE resource_glossary SET term_text = ?, normalized_text = ? WHERE uid = ?`)
      .run(updates.termText, updates.termText.trim().toLowerCase(), uid)
  }
  if (updates.definition !== undefined)
    db.prepare(`UPDATE resource_glossary SET definition = ? WHERE uid = ?`).run(updates.definition, uid)
  if (updates.abbreviation !== undefined)
    db.prepare(`UPDATE resource_glossary SET abbreviation = ? WHERE uid = ?`).run(updates.abbreviation, uid)
  if (updates.category !== undefined)
    db.prepare(`UPDATE resource_glossary SET category = ? WHERE uid = ?`).run(updates.category, uid)
  if (updates.isProhibited !== undefined)
    db.prepare(`UPDATE resource_glossary SET is_prohibited = ? WHERE uid = ?`).run(updates.isProhibited ? 1 : 0, uid)
  if (updates.confirmedAt !== undefined)
    db.prepare(`UPDATE resource_glossary SET confirmed_at = ? WHERE uid = ?`).run(updates.confirmedAt, uid)
  db.prepare(`UPDATE entity_registry SET updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid = ?`).run(uid)
}

export function deleteGlossaryTerm(uid: string): void {
  withTransaction(() => {
    const db = getDatabase()
    // synonym の entity_registry エントリを削除
    const syns = db.prepare(`SELECT uid FROM resource_glossary_synonym WHERE glossary_uid = ?`).all(uid) as { uid: string }[]
    for (const s of syns) db.prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(s.uid)
    db.prepare(`DELETE FROM resource_glossary_synonym WHERE glossary_uid = ?`).run(uid)
    db.prepare(`DELETE FROM resource_glossary WHERE uid = ?`).run(uid)
    db.prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(uid)
  })
}

export function addSynonym(glossaryUid: string, synonymText: string, synonymKind?: string): string {
  return withTransaction(() => {
    const db = getDatabase()
    const cnt = (db.prepare(`SELECT COUNT(*) AS cnt FROM resource_glossary_synonym WHERE glossary_uid = ?`).get(glossaryUid) as { cnt: number }).cnt
    const code = `SYN-${String(cnt + 1).padStart(4, '0')}`
    const uid = createEntityEntry({ entityType: 'resource_glossary_synonym', code, title: synonymText })
    db.prepare(
      `INSERT INTO resource_glossary_synonym (uid, glossary_uid, synonym_text, synonym_kind) VALUES (?, ?, ?, ?)`
    ).run(uid, glossaryUid, synonymText, synonymKind ?? null)
    return uid
  })
}

export function listSynonyms(glossaryUid: string): GlossarySynonymRow[] {
  return getDatabase()
    .prepare(
      `SELECT uid, glossary_uid, synonym_text, synonym_kind, created_at
       FROM resource_glossary_synonym WHERE glossary_uid = ? ORDER BY created_at`
    )
    .all(glossaryUid) as GlossarySynonymRow[]
}

export function deleteSynonym(uid: string): void {
  withTransaction(() => {
    const db = getDatabase()
    db.prepare(`DELETE FROM resource_glossary_synonym WHERE uid = ?`).run(uid)
    db.prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(uid)
  })
}

export function confirmGlossaryTerm(uid: string): void {
  getDatabase()
    .prepare(`UPDATE resource_glossary SET confirmed_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid = ?`)
    .run(uid)
}
