/**
 * Excel抽出グループ候補ドラフト（P5-19、EXT-049〜055）。
 * 物理抽出・意味候補を②正本と分離し、ユーザー確定時だけ既存抽出モデルへ変換する。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { newUid } from '../store/uid'
import { storeExtractionResult, type ExtractionElement, type ExtractionOutput } from './store-extraction'
import type { ChatMessage } from '../llm/providers'

export const EXCEL_CANDIDATE_TYPES = ['table', 'text', 'list', 'formula', 'figure', 'model', 'unknown'] as const
export type ExcelCandidateType = (typeof EXCEL_CANDIDATE_TYPES)[number]

export interface ExcelCell {
  address: string
  row: number
  column: number
  raw_value?: string | null
  display_value?: string | null
  formula?: string | null
  style_id?: number
  style?: Record<string, unknown>
  comment?: { author?: string; text?: string } | null
  hyperlink?: { target?: string; display?: string; external?: boolean } | null
}

export interface ExcelSheet {
  name: string
  state: string
  dimension?: string | null
  rows: Array<Record<string, unknown>>
  columns: Array<Record<string, unknown>>
  cells: ExcelCell[]
  merged_ranges: string[]
  tables: Array<Record<string, unknown>>
  comments: Array<Record<string, unknown>>
}

export interface ExcelPhysicalOutput {
  metadata: Record<string, unknown> & { extractor_name?: string; extractor_version?: string }
  workbook: {
    file_name: string
    active_tab: number
    defined_names: Array<Record<string, unknown>>
    external_links: Array<Record<string, unknown>>
    sheets: ExcelSheet[]
  }
  candidates: Array<Partial<ExcelCandidate>>
  package: { parts: Array<Record<string, unknown>>; unsupported_parts: Array<Record<string, unknown>> }
  review_hints: { warnings: string[] }
}

export interface ExcelCandidate {
  candidate_uid: string
  sheet_name: string
  start_cell: string
  end_cell: string
  candidate_type: ExcelCandidateType
  title: string
  description?: string
  detection_methods: string[]
  confidence: number
  candidate_status: 'detected' | 'adjusted' | 'confirmed' | 'rejected'
  review_status: 'draft' | 'review' | 'approved' | 'rejected'
  llm_suggestion?: Record<string, unknown>
}

export interface ExcelDraft {
  source_document_uid: string
  status: 'generated' | 'editing' | 'confirmed' | 'failed'
  physical: ExcelPhysicalOutput
  candidates: ExcelCandidate[]
  last_llm_run_uid: string | null
  confirmed_extracted_document_uid: string | null
  created_at: string
  updated_at: string
  confirmed_at: string | null
}

const CELL_RE = /^[A-Z]{1,3}[1-9][0-9]*$/

function asCandidate(value: unknown, preserveUid?: string): ExcelCandidate {
  if (typeof value !== 'object' || value === null) throw new BackendError('validation', '候補はオブジェクトです', '')
  const item = value as Record<string, unknown>
  const sheetName = String(item.sheet_name ?? '').trim()
  const startCell = String(item.start_cell ?? '')
    .trim()
    .toUpperCase()
  const endCell = String(item.end_cell ?? '')
    .trim()
    .toUpperCase()
  const type = String(item.candidate_type ?? 'unknown') as ExcelCandidateType
  if (!sheetName) throw new BackendError('validation', '候補の sheet_name は必須です', '')
  if (!CELL_RE.test(startCell) || !CELL_RE.test(endCell))
    throw new BackendError('validation', '候補範囲はA1形式で指定してください', `${startCell}:${endCell}`)
  if (!EXCEL_CANDIDATE_TYPES.includes(type)) throw new BackendError('validation', `未対応の候補種別です: ${type}`, '')
  const confidence = Number(item.confidence ?? 0)
  return {
    candidate_uid:
      preserveUid ?? (typeof item.candidate_uid === 'string' && item.candidate_uid ? item.candidate_uid : newUid()),
    sheet_name: sheetName,
    start_cell: startCell,
    end_cell: endCell,
    candidate_type: type,
    title: String(item.title ?? '').trim() || `${sheetName} ${startCell}:${endCell}`,
    description: typeof item.description === 'string' ? item.description : undefined,
    detection_methods: Array.isArray(item.detection_methods)
      ? item.detection_methods.filter((method): method is string => typeof method === 'string')
      : [],
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    candidate_status:
      item.candidate_status === 'adjusted' ||
      item.candidate_status === 'confirmed' ||
      item.candidate_status === 'rejected'
        ? item.candidate_status
        : 'detected',
    review_status:
      item.review_status === 'review' || item.review_status === 'approved' || item.review_status === 'rejected'
        ? item.review_status
        : 'draft',
    llm_suggestion:
      typeof item.llm_suggestion === 'object' && item.llm_suggestion !== null
        ? (item.llm_suggestion as Record<string, unknown>)
        : undefined
  }
}

function parseRow(row: {
  source_document_uid: string
  status: ExcelDraft['status']
  physical_json: string
  candidates_json: string
  last_llm_run_uid: string | null
  confirmed_extracted_document_uid: string | null
  created_at: string
  updated_at: string
  confirmed_at: string | null
}): ExcelDraft {
  return {
    source_document_uid: row.source_document_uid,
    status: row.status,
    physical: JSON.parse(row.physical_json) as ExcelPhysicalOutput,
    candidates: JSON.parse(row.candidates_json) as ExcelCandidate[],
    last_llm_run_uid: row.last_llm_run_uid,
    confirmed_extracted_document_uid: row.confirmed_extracted_document_uid,
    created_at: row.created_at,
    updated_at: row.updated_at,
    confirmed_at: row.confirmed_at
  }
}

export function storeExcelDraft(db: Database, sourceDocumentUid: string, output: ExcelPhysicalOutput): ExcelDraft {
  if (!output.workbook || !Array.isArray(output.workbook.sheets) || !Array.isArray(output.candidates))
    throw new BackendError('validation', 'Excelワーカー出力の構造が不正です', '')
  const source = db.prepare(`SELECT file_type FROM source_document WHERE uid=?`).get(sourceDocumentUid) as
    { file_type: string } | undefined
  if (!source) throw new BackendError('not_found', `原本が見つかりません: ${sourceDocumentUid}`, '')
  if (source.file_type !== 'excel') throw new BackendError('validation', 'Excel原本ではありません', source.file_type)
  const candidates = output.candidates.map((candidate) => asCandidate(candidate))
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO excel_extraction_draft
       (source_document_uid,status,physical_json,candidates_json,created_at,updated_at)
     VALUES (?, 'generated', ?, ?, ?, ?)
     ON CONFLICT(source_document_uid) DO UPDATE SET
       status='generated', physical_json=excluded.physical_json, candidates_json=excluded.candidates_json,
       last_llm_run_uid=NULL, confirmed_extracted_document_uid=NULL, confirmed_at=NULL, updated_at=excluded.updated_at`
  ).run(sourceDocumentUid, JSON.stringify(output), JSON.stringify(candidates), now, now)
  return getExcelDraft(db, sourceDocumentUid)
}

export function getExcelDraft(db: Database, sourceDocumentUid: string): ExcelDraft {
  const row = db.prepare(`SELECT * FROM excel_extraction_draft WHERE source_document_uid=?`).get(sourceDocumentUid) as
    Parameters<typeof parseRow>[0] | undefined
  if (!row) throw new BackendError('not_found', 'Excel抽出グループ候補がありません', sourceDocumentUid)
  return parseRow(row)
}

export function saveExcelCandidates(
  db: Database,
  sourceDocumentUid: string,
  candidatesInput: unknown[]
): { candidates: ExcelCandidate[]; updatedAt: string } {
  const draft = getExcelDraft(db, sourceDocumentUid)
  if (draft.status === 'confirmed') throw new BackendError('conflict', '確定済みの候補は編集できません', '')
  const existingUids = new Set(draft.candidates.map((candidate) => candidate.candidate_uid))
  const seen = new Set<string>()
  const candidates = candidatesInput.map((candidate) => {
    const raw = candidate as Record<string, unknown>
    const requestedUid = typeof raw?.candidate_uid === 'string' ? raw.candidate_uid : undefined
    const normalized = asCandidate(candidate, requestedUid && existingUids.has(requestedUid) ? requestedUid : undefined)
    if (seen.has(normalized.candidate_uid))
      throw new BackendError('validation', '候補UIDが重複しています', normalized.candidate_uid)
    seen.add(normalized.candidate_uid)
    return normalized
  })
  const sheetNames = new Set(draft.physical.workbook.sheets.map((sheet) => sheet.name))
  for (const candidate of candidates) {
    if (!sheetNames.has(candidate.sheet_name))
      throw new BackendError('validation', `存在しないシートです: ${candidate.sheet_name}`, '')
  }
  const updatedAt = new Date().toISOString()
  db.prepare(
    `UPDATE excel_extraction_draft SET status='editing', candidates_json=?, updated_at=? WHERE source_document_uid=?`
  ).run(JSON.stringify(candidates), updatedAt, sourceDocumentUid)
  return { candidates, updatedAt }
}

function cellPosition(address: string): [number, number] {
  const match = /^([A-Z]+)([0-9]+)$/.exec(address)
  if (!match) return [0, 0]
  let column = 0
  for (const char of match[1]!) column = column * 26 + char.charCodeAt(0) - 64
  return [Number(match[2]), column]
}

function cellsInRange(sheet: ExcelSheet, start: string, end: string, margin = 0): ExcelCell[] {
  const [r1, c1] = cellPosition(start)
  const [r2, c2] = cellPosition(end)
  const minRow = Math.max(1, Math.min(r1, r2) - margin)
  const maxRow = Math.max(r1, r2) + margin
  const minCol = Math.max(1, Math.min(c1, c2) - margin)
  const maxCol = Math.max(c1, c2) + margin
  return sheet.cells.filter(
    (cell) => cell.row >= minRow && cell.row <= maxRow && cell.column >= minCol && cell.column <= maxCol
  )
}

export function buildExcelCandidateLlmMessages(
  db: Database,
  sourceDocumentUid: string,
  candidateUids: string[]
): ChatMessage[] {
  const draft = getExcelDraft(db, sourceDocumentUid)
  const selected = draft.candidates.filter((candidate) => candidateUids.includes(candidate.candidate_uid))
  if (selected.length === 0) throw new BackendError('validation', 'LLM支援対象の候補を選択してください', '')
  const scopes = selected.map((candidate) => {
    const sheet = draft.physical.workbook.sheets.find((item) => item.name === candidate.sheet_name)
    if (!sheet) throw new BackendError('validation', `シートが見つかりません: ${candidate.sheet_name}`, '')
    return {
      candidate,
      cells: cellsInRange(sheet, candidate.start_cell, candidate.end_cell, 2).map((cell) => ({
        address: cell.address,
        display_value: cell.display_value,
        formula: cell.formula,
        style_id: cell.style_id
      })),
      merged_ranges: sheet.merged_ranges
    }
  })
  return [
    {
      role: 'system',
      content:
        'Excel抽出グループ候補を改善してください。入力に含まれるcandidate_uidだけを対象にし、原本にない情報を作らないでください。JSON objectのcandidates配列で candidate_uid, suggested_type, suggested_start_cell, suggested_end_cell, suggested_title, reason, confidence を返してください。'
    },
    {
      role: 'user',
      content: JSON.stringify({ scopes }, null, 2)
    }
  ]
}

function parseLlmJson(content: string): Record<string, unknown> {
  const stripped = content
    .trim()
    .replace(/^\`\`\`(?:json)?\s*/i, '')
    .replace(/\s*\`\`\`$/, '')
  try {
    const parsed = JSON.parse(stripped)
    if (typeof parsed !== 'object' || parsed === null) throw new Error('objectではありません')
    return parsed as Record<string, unknown>
  } catch (error) {
    throw new BackendError('llm', 'Excel候補のLLM応答をJSONとして解釈できません', String(error))
  }
}

export function applyExcelLlmSuggestions(
  db: Database,
  sourceDocumentUid: string,
  selectedCandidateUids: string[],
  content: string,
  llmRunUid: string
): { updatedCount: number } {
  const draft = getExcelDraft(db, sourceDocumentUid)
  if (draft.status === 'confirmed') throw new BackendError('conflict', '確定済みの候補は更新できません', '')
  const parsed = parseLlmJson(content)
  const suggestions = Array.isArray(parsed.candidates) ? parsed.candidates : []
  const selected = new Set(selectedCandidateUids)
  const suggestionByUid = new Map<string, Record<string, unknown>>()
  for (const value of suggestions) {
    if (typeof value !== 'object' || value === null) continue
    const suggestion = value as Record<string, unknown>
    const uid = String(suggestion.candidate_uid ?? '')
    if (selected.has(uid)) suggestionByUid.set(uid, suggestion)
  }
  const candidates = draft.candidates.map((candidate) => {
    const suggestion = suggestionByUid.get(candidate.candidate_uid)
    if (!suggestion) return candidate
    const next = asCandidate(
      {
        ...candidate,
        candidate_type: suggestion.suggested_type ?? candidate.candidate_type,
        start_cell: suggestion.suggested_start_cell ?? candidate.start_cell,
        end_cell: suggestion.suggested_end_cell ?? candidate.end_cell,
        title: suggestion.suggested_title ?? candidate.title,
        confidence: suggestion.confidence ?? candidate.confidence,
        candidate_status: 'adjusted',
        review_status: 'review',
        llm_suggestion: {
          reason: suggestion.reason,
          llm_run_uid: llmRunUid,
          received_at: new Date().toISOString()
        }
      },
      candidate.candidate_uid
    )
    return next
  })
  db.prepare(
    `UPDATE excel_extraction_draft
        SET status='editing', candidates_json=?, last_llm_run_uid=?, updated_at=?
      WHERE source_document_uid=?`
  ).run(JSON.stringify(candidates), llmRunUid, new Date().toISOString(), sourceDocumentUid)
  return { updatedCount: suggestionByUid.size }
}

function rowsForCandidate(sheet: ExcelSheet, candidate: ExcelCandidate): { text: string }[][] {
  const cells = cellsInRange(sheet, candidate.start_cell, candidate.end_cell)
  const [r1, c1] = cellPosition(candidate.start_cell)
  const [r2, c2] = cellPosition(candidate.end_cell)
  const minRow = Math.min(r1, r2)
  const maxRow = Math.max(r1, r2)
  const minCol = Math.min(c1, c2)
  const maxCol = Math.max(c1, c2)
  const byPosition = new Map(cells.map((cell) => [`${cell.row}:${cell.column}`, cell]))
  const rows = []
  for (let row = minRow; row <= maxRow; row++) {
    const values = []
    for (let column = minCol; column <= maxCol; column++) {
      values.push({ text: String(byPosition.get(`${row}:${column}`)?.display_value ?? '') })
    }
    rows.push(values)
  }
  return rows
}

function extractionElement(candidate: ExcelCandidate, sheet: ExcelSheet): ExtractionElement {
  const rows = rowsForCandidate(sheet, candidate)
  const flattened = rows
    .map((row) =>
      row
        .map((cell) => cell.text)
        .filter(Boolean)
        .join(' | ')
    )
    .filter(Boolean)
    .join('\n')
  const base = {
    id: candidate.candidate_uid,
    sheet_name: candidate.sheet_name,
    cell_start: candidate.start_cell,
    cell_end: candidate.end_cell,
    section_path: candidate.sheet_name,
    candidate_uid: candidate.candidate_uid
  }
  if (candidate.candidate_type === 'table') {
    return {
      ...base,
      type: 'table',
      text: candidate.title,
      rows,
      row_count: rows.length,
      column_count: rows[0]?.length ?? 0
    }
  }
  if (candidate.candidate_type === 'formula') {
    const formulas = cellsInRange(sheet, candidate.start_cell, candidate.end_cell)
      .map((cell) => cell.formula)
      .filter((formula): formula is string => Boolean(formula))
    return { ...base, type: 'formula', text: formulas.join('\n') || flattened }
  }
  return { ...base, type: 'paragraph', text: flattened || candidate.title }
}

export function confirmExcelDraft(
  db: Database,
  input: {
    projectUid: string
    projectRoot: string
    sourceDocumentUid: string
  }
): { extractedDocumentUid: string; code: string; elementCount: number } {
  const draft = getExcelDraft(db, input.sourceDocumentUid)
  if (draft.status === 'confirmed') throw new BackendError('conflict', 'Excel候補は確定済みです', '')
  const selected = draft.candidates.filter(
    (candidate) => candidate.candidate_status !== 'rejected' && candidate.review_status !== 'rejected'
  )
  if (selected.length === 0) throw new BackendError('validation', '抽出対象の候補がありません', '')
  const elements = selected.map((candidate) => {
    const sheet = draft.physical.workbook.sheets.find((item) => item.name === candidate.sheet_name)
    if (!sheet) throw new BackendError('validation', `シートが見つかりません: ${candidate.sheet_name}`, '')
    return extractionElement(candidate, sheet)
  })
  const extraction: ExtractionOutput = {
    ...draft.physical,
    metadata: draft.physical.metadata,
    elements
  }
  const txn = db.transaction(() => {
    const stored = storeExtractionResult(db, {
      projectUid: input.projectUid,
      projectRoot: input.projectRoot,
      sourceDocumentUid: input.sourceDocumentUid,
      extraction,
      workDir: input.projectRoot
    })
    const now = new Date().toISOString()
    db.prepare(
      `UPDATE excel_extraction_draft
          SET status='confirmed', candidates_json=?, confirmed_extracted_document_uid=?, confirmed_at=?, updated_at=?
        WHERE source_document_uid=?`
    ).run(
      JSON.stringify(
        selected.map((candidate) => ({ ...candidate, candidate_status: 'confirmed', review_status: 'approved' }))
      ),
      stored.extractedDocumentUid,
      now,
      now,
      input.sourceDocumentUid
    )
    return stored
  })
  return txn()
}
