import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'

export interface SearchSettings {
  useMecab?: boolean
  mecabPath?: string
  dictionaryPath?: string
  userDictionaryPaths?: string[]
}
export interface SearchResultRow {
  uid: string
  entityType: string
  code: string
  title: string
  snippet: string
  score: number
  resourceUri: string
  targetItemUid?: string
  targetResourceUid?: string
}
export interface SearchResponse {
  results: SearchResultRow[]
  indexCount: number
  tokenizer: 'mecab' | 'unicode'
  warning?: string
}
interface SearchDocument {
  uid: string
  entity_type: string
  code: string
  title: string
  search_text: string
  resource_uri?: string
  target_item_uid?: string
  target_resource_uid?: string
}
interface IndexedRow extends SearchDocument {
  snippet: string
  score: number
}

const RESOURCE_TEXT = `trim(concat_ws(' ', child.title, child.review_info_json, child.memo_json,
  rl.label_text, rt.text_body, rtb.table_title, rf.formula_text, rc.code_text, rm.model_name, rm.model_source,
  rs.scenario_name, rst.state_machine_name, rr.reference_text, rg.term_text, rg.definition))`

function collectDocuments(db: Database, projectUid: string): SearchDocument[] {
  const resources = db
    .prepare(
      `
    SELECT er.uid, er.entity_type, er.code, COALESCE(er.title, er.code) AS title,
      trim(concat_ws(' ', er.title, er.review_info_json, er.memo_json, rl.label_text, rt.text_body,
        rtb.table_title, rf.formula_text, rc.code_text, rm.model_name, rm.model_source, rs.scenario_name,
        rst.state_machine_name, rr.reference_text, rg.term_text, rg.definition,
        (SELECT group_concat(s.synonym_text, ' ') FROM resource_glossary_synonym s WHERE s.glossary_uid = er.uid))) AS search_text
    FROM entity_registry er
    LEFT JOIN resource_label rl ON rl.uid = er.uid LEFT JOIN resource_text rt ON rt.uid = er.uid
    LEFT JOIN resource_table rtb ON rtb.uid = er.uid LEFT JOIN resource_formula rf ON rf.uid = er.uid
    LEFT JOIN resource_code rc ON rc.uid = er.uid LEFT JOIN resource_model rm ON rm.uid = er.uid
    LEFT JOIN resource_scenario rs ON rs.uid = er.uid LEFT JOIN resource_state_transition rst ON rst.uid = er.uid
    LEFT JOIN resource_reference rr ON rr.uid = er.uid LEFT JOIN resource_glossary rg ON rg.uid = er.uid
    WHERE er.project_uid = ? AND er.status <> 'deleted'`
    )
    .all(projectUid) as SearchDocument[]

  const extracted = db
    .prepare(
      `
    SELECT 'search:extracted:' || ei.uid AS uid, 'extracted_document' AS entity_type,
      COALESCE(item.code, document.code) AS code,
      COALESCE(child.title, item.title, document.title, item.code) AS title,
      ${RESOURCE_TEXT} AS search_text, 'extracted://' || ei.extracted_document_uid AS resource_uri,
      ei.uid AS target_item_uid, ei.resource_uid AS target_resource_uid
    FROM extracted_item ei
    JOIN entity_registry item ON item.uid = ei.uid AND item.status <> 'deleted'
    JOIN entity_registry document ON document.uid = ei.extracted_document_uid AND document.project_uid = ? AND document.status <> 'deleted'
    JOIN entity_registry child ON child.uid = ei.resource_uid AND child.status <> 'deleted'
    LEFT JOIN resource_label rl ON rl.uid = child.uid LEFT JOIN resource_text rt ON rt.uid = child.uid
    LEFT JOIN resource_table rtb ON rtb.uid = child.uid LEFT JOIN resource_formula rf ON rf.uid = child.uid
    LEFT JOIN resource_code rc ON rc.uid = child.uid LEFT JOIN resource_model rm ON rm.uid = child.uid
    LEFT JOIN resource_scenario rs ON rs.uid = child.uid LEFT JOIN resource_state_transition rst ON rst.uid = child.uid
    LEFT JOIN resource_reference rr ON rr.uid = child.uid LEFT JOIN resource_glossary rg ON rg.uid = child.uid`
    )
    .all(projectUid) as SearchDocument[]

  const originals = db
    .prepare(
      `
    SELECT 'search:source:' || ei.uid AS uid, 'source_document' AS entity_type,
      COALESCE(item.code, source.code) AS code,
      COALESCE(child.title, item.title, source.title, item.code) AS title,
      ${RESOURCE_TEXT} AS search_text, 'extracted://' || ei.extracted_document_uid AS resource_uri,
      ei.uid AS target_item_uid, ei.resource_uid AS target_resource_uid
    FROM extracted_item ei
    JOIN entity_registry item ON item.uid = ei.uid AND item.status <> 'deleted'
    JOIN entity_registry source ON source.uid = ei.source_document_uid AND source.project_uid = ? AND source.status <> 'deleted'
    JOIN entity_registry child ON child.uid = ei.resource_uid AND child.status <> 'deleted'
    LEFT JOIN resource_label rl ON rl.uid = child.uid LEFT JOIN resource_text rt ON rt.uid = child.uid
    LEFT JOIN resource_table rtb ON rtb.uid = child.uid LEFT JOIN resource_formula rf ON rf.uid = child.uid
    LEFT JOIN resource_code rc ON rc.uid = child.uid LEFT JOIN resource_model rm ON rm.uid = child.uid
    LEFT JOIN resource_scenario rs ON rs.uid = child.uid LEFT JOIN resource_state_transition rst ON rst.uid = child.uid
    LEFT JOIN resource_reference rr ON rr.uid = child.uid LEFT JOIN resource_glossary rg ON rg.uid = child.uid`
    )
    .all(projectUid) as SearchDocument[]

  const intermediate = db
    .prepare(
      `
    SELECT 'search:intermediate:' || ii.uid AS uid, 'intermediate_document' AS entity_type,
      COALESCE(item.code, document.code) AS code,
      COALESCE(child.title, item.title, document.title, item.code) AS title,
      ${RESOURCE_TEXT} AS search_text, 'intermediate://' || ii.intermediate_document_uid AS resource_uri,
      ii.uid AS target_item_uid, ii.resource_uid AS target_resource_uid
    FROM intermediate_item ii
    JOIN entity_registry item ON item.uid = ii.uid AND item.status <> 'deleted'
    JOIN entity_registry document ON document.uid = ii.intermediate_document_uid AND document.project_uid = ? AND document.status <> 'deleted'
    JOIN entity_registry child ON child.uid = ii.resource_uid AND child.status <> 'deleted'
    LEFT JOIN resource_label rl ON rl.uid = child.uid LEFT JOIN resource_text rt ON rt.uid = child.uid
    LEFT JOIN resource_table rtb ON rtb.uid = child.uid LEFT JOIN resource_formula rf ON rf.uid = child.uid
    LEFT JOIN resource_code rc ON rc.uid = child.uid LEFT JOIN resource_model rm ON rm.uid = child.uid
    LEFT JOIN resource_scenario rs ON rs.uid = child.uid LEFT JOIN resource_state_transition rst ON rst.uid = child.uid
    LEFT JOIN resource_reference rr ON rr.uid = child.uid LEFT JOIN resource_glossary rg ON rg.uid = child.uid`
    )
    .all(projectUid) as SearchDocument[]

  return [...resources, ...extracted, ...originals, ...intermediate]
}

export class JapaneseTokenizer {
  readonly mode: 'mecab' | 'unicode'
  readonly warning?: string
  constructor(private readonly settings: SearchSettings) {
    if (!settings.useMecab) {
      this.mode = 'unicode'
      return
    }
    const path = settings.mecabPath?.trim()
    this.mode = path && existsSync(path) ? 'mecab' : 'unicode'
    if (path && !existsSync(path)) this.warning = `MeCab が見つかりません: ${path}`
    if (!path) this.warning = 'MeCab パスが未設定のためUnicode検索を使用しています'
  }
  tokenize(text: string): string {
    const normalized = text.normalize('NFKC').replaceAll('\u0000', ' ').trim()
    if (!normalized || this.mode === 'unicode') return normalized
    const args = ['-Owakati']
    if (this.settings.dictionaryPath) args.push('-d', this.settings.dictionaryPath)
    for (const path of this.settings.userDictionaryPaths ?? []) if (path.trim()) args.push('-u', path.trim())
    const result = spawnSync(this.settings.mecabPath!, args, {
      input: normalized,
      encoding: 'utf-8',
      windowsHide: true,
      timeout: 15_000
    })
    return result.status === 0 && !result.error ? result.stdout.trim() || normalized : normalized
  }
}

function resourceUri(db: Database, type: string, uid: string): string {
  if (type === 'source_document') return `original://${uid}`
  if (type === 'extracted_document') return `extracted://${uid}`
  if (type === 'intermediate_document') return `intermediate://${uid}`
  if (type === 'resource_glossary' || type === 'resource_glossary_synonym') return 'glossary://workspace'
  if (type.startsWith('resource_')) return `resource://${uid}`
  const intermediate = db
    .prepare('SELECT intermediate_document_uid FROM intermediate_item WHERE resource_uid = ? LIMIT 1')
    .get(uid) as { intermediate_document_uid: string } | undefined
  if (intermediate) return `intermediate://${intermediate.intermediate_document_uid}`
  const extracted = db
    .prepare('SELECT extracted_document_uid FROM extracted_item WHERE resource_uid = ? LIMIT 1')
    .get(uid) as { extracted_document_uid: string } | undefined
  if (extracted) return `extracted://${extracted.extracted_document_uid}`
  return `design://${uid}`
}

export function rebuildSearchIndex(
  db: Database,
  projectUid: string,
  settings: SearchSettings
): { count: number; tokenizer: 'mecab' | 'unicode'; warning: string | undefined } {
  const tokenizer = new JapaneseTokenizer(settings)
  const docs = collectDocuments(db, projectUid)
  db.transaction(() => {
    db.prepare('DELETE FROM fts_entity_text').run()
    const insert = db.prepare(
      'INSERT INTO fts_entity_text (uid, entity_type, code, title, search_text) VALUES (?, ?, ?, ?, ?)'
    )
    for (const doc of docs)
      insert.run(doc.uid, doc.entity_type, doc.code, tokenizer.tokenize(doc.title), tokenizer.tokenize(doc.search_text))
  })()
  return { count: docs.length, tokenizer: tokenizer.mode, warning: tokenizer.warning }
}

export function searchElements(
  db: Database,
  projectUid: string,
  query: string,
  settings: SearchSettings,
  options: { entityType?: string; limit?: number } = {}
): SearchResponse {
  const q = query.normalize('NFKC').trim()
  if (!q) throw new BackendError('validation', '検索文字列を入力してください', '')
  const index = rebuildSearchIndex(db, projectUid, settings)
  const documents = collectDocuments(db, projectUid)
  const metadata = new Map(documents.map((document) => [document.uid, document]))
  const tokenizer = new JapaneseTokenizer(settings)
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500)
  const typeSql = options.entityType ? 'AND f.entity_type = ?' : ''
  const typeArgs = options.entityType ? [options.entityType] : []
  const exact = db
    .prepare(
      `SELECT er.uid, er.entity_type, er.code, COALESCE(er.title, er.code) title, '' search_text,
    COALESCE(er.title, er.code) snippet, -1000 AS score FROM entity_registry er
    WHERE er.project_uid = ? AND er.status <> 'deleted' AND (lower(er.uid) = lower(?) OR lower(er.code) LIKE lower(?))
    ${options.entityType ? 'AND er.entity_type = ?' : ''}
    ORDER BY CASE WHEN lower(er.uid) = lower(?) OR lower(er.code) = lower(?) THEN 0 ELSE 1 END, er.code LIMIT ?`
    )
    .all(projectUid, q, `${q}%`, ...typeArgs, q, q, limit) as IndexedRow[]
  let rows: IndexedRow[] = []
  const tokens = tokenizer.tokenize(q).split(/\s+/).filter(Boolean)
  if (tokens.length) {
    const match = tokens.map((token) => `"${token.replaceAll('"', '""')}"*`).join(' AND ')
    try {
      rows = db
        .prepare(
          `SELECT f.uid, f.entity_type, f.code, f.title, f.search_text,
        snippet(fts_entity_text, 4, '【', '】', ' … ', 24) snippet, bm25(fts_entity_text, 5.0, 1.0) score
        FROM fts_entity_text f WHERE fts_entity_text MATCH ? ${typeSql} ORDER BY score LIMIT ?`
        )
        .all(match, ...typeArgs, limit) as IndexedRow[]
    } catch {
      rows = []
    }
  }
  // FTSは語単位・前方一致なので、日本語の部分文字列や記号を含む検索を取りこぼし得る。
  // FTSの成否にかかわらずNFKC済み全文への部分一致を併合し、検索漏れを防ぐ（SEARCH-001）。
  const like = `%${q.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
  const likeRows = db
    .prepare(
      `SELECT f.uid, f.entity_type, f.code, f.title, f.search_text,
    substr(f.search_text, 1, 240) snippet, 1000 AS score FROM fts_entity_text f
    WHERE (f.title LIKE ? ESCAPE '\\' OR f.search_text LIKE ? ESCAPE '\\') ${typeSql}
    ORDER BY f.code LIMIT ?`
    )
    .all(like, like, ...typeArgs, limit) as IndexedRow[]
  const merged = [...exact, ...rows, ...likeRows]
    .filter((row, index, all) => all.findIndex((candidate) => candidate.uid === row.uid) === index)
    .slice(0, limit)
  return {
    results: merged.map((row) => {
      const meta = metadata.get(row.uid)
      return {
        uid: row.uid,
        entityType: row.entity_type,
        code: row.code,
        title: row.title,
        snippet: row.snippet,
        score: row.score,
        resourceUri: meta?.resource_uri ?? resourceUri(db, row.entity_type, row.uid),
        ...(meta?.target_item_uid ? { targetItemUid: meta.target_item_uid } : {}),
        ...(meta?.target_resource_uid ? { targetResourceUid: meta.target_resource_uid } : {})
      }
    }),
    indexCount: index.count,
    tokenizer: index.tokenizer,
    warning: index.warning
  }
}
