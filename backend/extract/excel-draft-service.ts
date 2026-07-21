/**
 * Excel抽出グループ候補ドラフト（P5-19、EXT-049〜062）。
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
  drawings?: ExcelDrawing[]
}

export interface ExcelDrawing {
  drawing_uid: string
  drawing_type: 'image' | 'shape' | 'connector' | 'group' | 'chart' | 'unknown'
  name?: string
  text?: string
  start_cell: string
  end_cell: string
  anchor?: Record<string, unknown>
  style?: Record<string, unknown>
  source_part?: string
  relationship_id?: string
  preview_path?: string
  connection_status?: 'resolved' | 'unresolved' | 'not_applicable'
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
  drawing_refs?: string[]
  table_header_row_start?: string
  table_header_row_end?: string
  table_header_column_start?: string
  table_header_column_end?: string
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
  predecessor_source_document_uid: string | null
  diff: ExcelDraftDiff | null
}

export interface ExcelDraftDiff {
  predecessor_source_document_uid: string | null
  sheets: Array<{ sheet_name: string; status: 'unchanged' | 'modified' | 'added' | 'removed' }>
  candidates: Array<{
    candidate_uid: string
    previous_candidate_uid?: string
    status: 'unchanged' | 'moved' | 'added' | 'removed' | 'ambiguous'
  }>
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
        : undefined,
    drawing_refs: Array.isArray(item.drawing_refs)
      ? item.drawing_refs.filter((entry): entry is string => typeof entry === 'string')
      : undefined,
    table_header_row_start: typeof item.table_header_row_start === 'string' ? item.table_header_row_start : undefined,
    table_header_row_end: typeof item.table_header_row_end === 'string' ? item.table_header_row_end : undefined,
    table_header_column_start:
      typeof item.table_header_column_start === 'string' ? item.table_header_column_start : undefined,
    table_header_column_end: typeof item.table_header_column_end === 'string' ? item.table_header_column_end : undefined
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
  predecessor_source_document_uid: string | null
  diff_json: string | null
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
    confirmed_at: row.confirmed_at,
    predecessor_source_document_uid: row.predecessor_source_document_uid,
    diff: row.diff_json ? (JSON.parse(row.diff_json) as ExcelDraftDiff) : null
  }
}

function sheetContentSignature(sheet: ExcelSheet): string {
  return JSON.stringify({
    cells: sheet.cells.map((cell) => [cell.address, cell.display_value ?? '', cell.formula ?? '', cell.style_id ?? 0]),
    merged_ranges: sheet.merged_ranges,
    drawings: (sheet.drawings ?? []).map((drawing) => [
      drawing.drawing_uid,
      drawing.start_cell,
      drawing.end_cell,
      drawing.text ?? '',
      drawing.style ?? {}
    ])
  })
}
function candidateContentSignature(output: ExcelPhysicalOutput, candidate: ExcelCandidate): string {
  const sheet = output.workbook.sheets.find((item) => item.name === candidate.sheet_name)
  if (!sheet) return ''
  const values = cellsInRange(sheet, candidate.start_cell, candidate.end_cell).map((cell) => ({
    row: cell.row - cellPosition(candidate.start_cell)[0],
    column: cell.column - cellPosition(candidate.start_cell)[1],
    value: cell.display_value ?? '',
    formula: cell.formula ?? '',
    style: cell.style_id ?? 0
  }))
  return JSON.stringify({ type: candidate.candidate_type, values, drawings: candidate.drawing_refs ?? [] })
}

function compareWithPredecessor(
  output: ExcelPhysicalOutput,
  candidates: ExcelCandidate[],
  predecessor: ExcelDraft | null
): { candidates: ExcelCandidate[]; diff: ExcelDraftDiff } {
  if (!predecessor) {
    return {
      candidates,
      diff: {
        predecessor_source_document_uid: null,
        sheets: output.workbook.sheets.map((sheet) => ({ sheet_name: sheet.name, status: 'added' as const })),
        candidates: candidates.map((candidate) => ({
          candidate_uid: candidate.candidate_uid,
          status: 'added' as const
        }))
      }
    }
  }
  const previousBySignature = new Map<string, ExcelCandidate[]>()
  for (const candidate of predecessor.candidates) {
    const signature = candidateContentSignature(predecessor.physical, candidate)
    previousBySignature.set(signature, [...(previousBySignature.get(signature) ?? []), candidate])
  }
  const used = new Set<string>()
  const entries: ExcelDraftDiff['candidates'] = []
  const inherited = candidates.map((candidate) => {
    const matches = (previousBySignature.get(candidateContentSignature(output, candidate)) ?? []).filter(
      (item) => !used.has(item.candidate_uid)
    )
    if (matches.length !== 1) {
      entries.push({ candidate_uid: candidate.candidate_uid, status: matches.length > 1 ? 'ambiguous' : 'added' })
      return candidate
    }
    const previous = matches[0]!
    used.add(previous.candidate_uid)
    const unchanged =
      previous.sheet_name === candidate.sheet_name &&
      previous.start_cell === candidate.start_cell &&
      previous.end_cell === candidate.end_cell
    const next: ExcelCandidate = {
      ...candidate,
      candidate_uid: previous.candidate_uid,
      candidate_type: previous.candidate_type,
      candidate_status: previous.candidate_status === 'confirmed' ? 'adjusted' : previous.candidate_status,
      review_status: previous.review_status === 'approved' ? 'review' : previous.review_status,
      table_header_row_start: previous.table_header_row_start,
      table_header_row_end: previous.table_header_row_end,
      table_header_column_start: previous.table_header_column_start,
      table_header_column_end: previous.table_header_column_end
    }
    entries.push({
      candidate_uid: next.candidate_uid,
      previous_candidate_uid: previous.candidate_uid,
      status: unchanged ? 'unchanged' : 'moved'
    })
    return next
  })
  for (const previous of predecessor.candidates) {
    if (!used.has(previous.candidate_uid)) {
      entries.push({
        candidate_uid: previous.candidate_uid,
        previous_candidate_uid: previous.candidate_uid,
        status: 'removed'
      })
    }
  }
  const currentSheets = new Set(output.workbook.sheets.map((sheet) => sheet.name))
  const previousSheets = new Set(predecessor.physical.workbook.sheets.map((sheet) => sheet.name))
  const sheetNames = new Set([...currentSheets, ...previousSheets])
  return {
    candidates: inherited,
    diff: {
      predecessor_source_document_uid: predecessor.source_document_uid,
      sheets: [...sheetNames].map((sheet_name) => ({
        sheet_name,
        status: currentSheets.has(sheet_name)
          ? previousSheets.has(sheet_name)
            ? sheetContentSignature(output.workbook.sheets.find((sheet) => sheet.name === sheet_name)!) ===
              sheetContentSignature(predecessor.physical.workbook.sheets.find((sheet) => sheet.name === sheet_name)!)
              ? 'unchanged'
              : 'modified'
            : 'added'
          : 'removed'
      })),
      candidates: entries
    }
  }
}
export function storeExcelDraft(db: Database, sourceDocumentUid: string, output: ExcelPhysicalOutput): ExcelDraft {
  if (!output.workbook || !Array.isArray(output.workbook.sheets) || !Array.isArray(output.candidates))
    throw new BackendError('validation', 'Excelワーカー出力の構造が不正です', '')
  const source = db
    .prepare(`SELECT file_type,file_name,imported_at FROM source_document WHERE uid=?`)
    .get(sourceDocumentUid) as { file_type: string; file_name: string; imported_at: string } | undefined
  if (!source) throw new BackendError('not_found', `原本が見つかりません: ${sourceDocumentUid}`, '')
  if (source.file_type !== 'excel') throw new BackendError('validation', 'Excel原本ではありません', source.file_type)
  const predecessorRow = db
    .prepare(
      `SELECT xd.source_document_uid
         FROM excel_extraction_draft xd
         JOIN source_document sd ON sd.uid=xd.source_document_uid
        WHERE sd.file_name=? AND sd.file_type='excel' AND sd.imported_at<=? AND sd.uid<>?
        ORDER BY sd.imported_at DESC, xd.updated_at DESC LIMIT 1`
    )
    .get(source.file_name, source.imported_at, sourceDocumentUid) as { source_document_uid: string } | undefined
  const predecessor = predecessorRow ? getExcelDraft(db, predecessorRow.source_document_uid) : null
  const compared = compareWithPredecessor(
    output,
    output.candidates.map((candidate) => asCandidate(candidate)),
    predecessor
  )
  const candidates = compared.candidates
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO excel_extraction_draft
       (source_document_uid,status,physical_json,candidates_json,predecessor_source_document_uid,diff_json,created_at,updated_at)
     VALUES (?, 'generated', ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_document_uid) DO UPDATE SET
       status='generated', physical_json=excluded.physical_json, candidates_json=excluded.candidates_json,
       predecessor_source_document_uid=excluded.predecessor_source_document_uid, diff_json=excluded.diff_json,
       last_llm_run_uid=NULL, confirmed_extracted_document_uid=NULL, confirmed_at=NULL, updated_at=excluded.updated_at`
  ).run(
    sourceDocumentUid,
    JSON.stringify(output),
    JSON.stringify(candidates),
    predecessor?.source_document_uid ?? null,
    JSON.stringify(compared.diff),
    now,
    now
  )
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

export function buildExcelRangeLlmMessages(
  db: Database,
  sourceDocumentUid: string,
  sheetName: string,
  startCell: string,
  endCell: string
): ChatMessage[] {
  if (!CELL_RE.test(startCell) || !CELL_RE.test(endCell))
    throw new BackendError('validation', 'LLM支援範囲はA1形式で指定してください', `${startCell}:${endCell}`)
  const draft = getExcelDraft(db, sourceDocumentUid)
  const sheet = draft.physical.workbook.sheets.find((item) => item.name === sheetName)
  if (!sheet) throw new BackendError('validation', `シートが見つかりません: ${sheetName}`, '')
  const scope = {
    sheet_name: sheetName,
    start_cell: startCell,
    end_cell: endCell,
    cells: cellsInRange(sheet, startCell, endCell).map((cell) => ({
      address: cell.address,
      display_value: cell.display_value,
      formula: cell.formula,
      style_id: cell.style_id
    })),
    merged_ranges: sheet.merged_ranges.filter((range) => rangesIntersect(`${startCell}:${endCell}`, range))
  }
  return [
    {
      role: 'system',
      content:
        '指定されたExcel矩形範囲だけを分析し、抽出グループ候補を提案してください。範囲外のセルや原本にない情報を作らないでください。JSON objectのcandidates配列で sheet_name, start_cell, end_cell, candidate_type, title, reason, confidence を返してください。'
    },
    { role: 'user', content: JSON.stringify({ scope }, null, 2) }
  ]
}

function rangesIntersect(left: string, right: string): boolean {
  const bounds = (value: string): [number, number, number, number] => {
    const [first, last = first] = value.split(':')
    const [r1, c1] = cellPosition(first ?? '')
    const [r2, c2] = cellPosition(last ?? '')
    return [Math.min(r1, r2), Math.min(c1, c2), Math.max(r1, r2), Math.max(c1, c2)]
  }
  const [ar1, ac1, ar2, ac2] = bounds(left)
  const [br1, bc1, br2, bc2] = bounds(right)
  return ar1 <= br2 && br1 <= ar2 && ac1 <= bc2 && bc1 <= ac2
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

export function applyExcelRangeLlmSuggestions(
  db: Database,
  sourceDocumentUid: string,
  scope: { sheetName: string; startCell: string; endCell: string },
  content: string,
  llmRunUid: string
): { addedCount: number } {
  const draft = getExcelDraft(db, sourceDocumentUid)
  if (draft.status === 'confirmed') throw new BackendError('conflict', '確定済みの候補は更新できません', '')
  const parsed = parseLlmJson(content)
  const suggestions = Array.isArray(parsed.candidates) ? parsed.candidates : []
  const added: ExcelCandidate[] = []
  for (const value of suggestions) {
    if (typeof value !== 'object' || value === null) continue
    const suggestion = value as Record<string, unknown>
    const candidate = asCandidate({
      sheet_name: scope.sheetName,
      start_cell: suggestion.start_cell,
      end_cell: suggestion.end_cell,
      candidate_type: suggestion.candidate_type,
      title: suggestion.title,
      detection_methods: ['llm_range_grouping'],
      confidence: suggestion.confidence,
      candidate_status: 'adjusted',
      review_status: 'review',
      llm_suggestion: { reason: suggestion.reason, llm_run_uid: llmRunUid, received_at: new Date().toISOString() }
    })
    if (!rangesIntersect(`${scope.startCell}:${scope.endCell}`, `${candidate.start_cell}:${candidate.end_cell}`))
      continue
    const [sr1, sc1] = cellPosition(scope.startCell)
    const [sr2, sc2] = cellPosition(scope.endCell)
    const [cr1, cc1] = cellPosition(candidate.start_cell)
    const [cr2, cc2] = cellPosition(candidate.end_cell)
    if (
      Math.min(cr1, cr2) < Math.min(sr1, sr2) ||
      Math.max(cr1, cr2) > Math.max(sr1, sr2) ||
      Math.min(cc1, cc2) < Math.min(sc1, sc2) ||
      Math.max(cc1, cc2) > Math.max(sc1, sc2)
    )
      continue
    added.push(candidate)
  }
  const candidates = [...draft.candidates, ...added]
  db.prepare(
    `UPDATE excel_extraction_draft
        SET status='editing', candidates_json=?, last_llm_run_uid=?, updated_at=?
      WHERE source_document_uid=?`
  ).run(JSON.stringify(candidates), llmRunUid, new Date().toISOString(), sourceDocumentUid)
  return { addedCount: added.length }
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
  if (candidate.candidate_type === 'figure') {
    const drawing = (sheet.drawings ?? []).find((item) => candidate.drawing_refs?.includes(item.drawing_uid))
    return {
      ...base,
      type: 'figure',
      text: drawing?.text || candidate.title,
      caption: candidate.title,
      image: drawing?.preview_path
    }
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
  const selected = draft.candidates.filter((candidate) => candidate.review_status === 'approved')

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
