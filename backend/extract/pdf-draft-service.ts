/**
 * PDF抽出領域候補ドラフト（P5-20、IMP-005/EXT-012/EXT-027〜029）。
 * ワーカーの物理抽出結果（ページ・ブロック・線・矩形・画像・ページ画像）と
 * ルール候補（抽出領域）を②正本と分離して保持し、オーバーレイレビューで
 * 人間が調整・確定した領域だけを既存抽出モデルへ変換する。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { newUid } from '../store/uid'
import { storeExtractionResult, type ExtractionElement } from './store-extraction'

export const PDF_REGION_TYPES = [
  'heading',
  'text',
  'list',
  'table',
  'figure',
  'caption',
  'formula',
  'header',
  'footer',
  'page_number',
  'decoration',
  'unknown'
] as const
export type PdfRegionType = (typeof PDF_REGION_TYPES)[number]

/** 確定時に②へ変換しない除外系種別（非破壊除外。検討資料 §6.2/§9） */
export const PDF_EXCLUDED_TYPES: readonly PdfRegionType[] = ['header', 'footer', 'page_number', 'decoration']

export interface PdfLine {
  text: string
  bbox: [number, number, number, number]
  size: number
  fontname: string
  bold: boolean
  italic: boolean
  color: string | null
}

export interface PdfBlock {
  block_id: string
  bbox: [number, number, number, number]
  text: string
  lines: PdfLine[]
}

export interface PdfPage {
  page_index: number
  page_number: number
  width: number
  height: number
  rotation: number
  image_file?: string
  image_width?: number
  image_height?: number
  image_scale?: number
  blocks: PdfBlock[]
  images: Array<{ image_id: string; bbox: [number, number, number, number] }>
  rules: {
    lines: Array<{ bbox: [number, number, number, number]; orientation: 'h' | 'v' }>
    rects: Array<{ bbox: [number, number, number, number] }>
    curve_count: number
    truncated: boolean
  }
  links: Array<{ bbox: [number, number, number, number]; uri: string }>
  word_count: number
  truncated: boolean
}

export interface PdfTableData {
  rows: string[][]
  row_count: number
  column_count: number
  header_row_count: number
  detection_method: string
}

export interface PdfPhysicalOutput {
  metadata: Record<string, unknown> & { extractor_name?: string; extractor_version?: string }
  document: { file_name: string; pages: PdfPage[] }
  candidates: Array<Record<string, unknown>>
  review_hints: { warnings: string[] }
}

export interface PdfRegion {
  region_uid: string
  page_index: number
  /** PDFポイント座標 [x0, top, x1, bottom]（左上原点） */
  bbox: [number, number, number, number]
  region_type: PdfRegionType
  title: string
  text_preview: string
  detection_methods: string[]
  confidence: number
  candidate_status: 'detected' | 'adjusted' | 'confirmed' | 'rejected'
  review_status: 'approved' | 'rejected'
  reading_order: number
  block_ids: string[]
  level?: number
  caption_of?: string
  table_data?: PdfTableData
  llm_suggestion?: Record<string, unknown>
}

export interface PdfDraft {
  source_document_uid: string
  status: 'generated' | 'editing' | 'confirmed' | 'failed'
  physical: PdfPhysicalOutput
  regions: PdfRegion[]
  last_llm_run_uid: string | null
  confirmed_extracted_document_uid: string | null
  created_at: string
  updated_at: string
  confirmed_at: string | null
}

function asTableData(value: unknown): PdfTableData | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const item = value as Record<string, unknown>
  if (!Array.isArray(item.rows)) return undefined
  const rows = item.rows.map((row) =>
    Array.isArray(row) ? row.map((cell) => (typeof cell === 'string' ? cell : '')) : []
  )
  return {
    rows,
    row_count: rows.length,
    column_count: rows.reduce((max, row) => Math.max(max, row.length), 0),
    header_row_count: Math.max(0, Math.min(Number(item.header_row_count ?? 1) || 0, rows.length)),
    detection_method: typeof item.detection_method === 'string' ? item.detection_method : 'user'
  }
}

function asRegion(value: unknown, pages: PdfPage[], preserveUid?: string): PdfRegion {
  if (typeof value !== 'object' || value === null) throw new BackendError('validation', '領域はオブジェクトです', '')
  const item = value as Record<string, unknown>
  const pageIndex = Number(item.page_index)
  const page = pages.find((entry) => entry.page_index === pageIndex)
  if (!page) throw new BackendError('validation', `存在しないページです: ${item.page_index}`, '')
  const rawBbox = item.bbox
  if (!Array.isArray(rawBbox) || rawBbox.length !== 4 || rawBbox.some((entry) => !Number.isFinite(Number(entry))))
    throw new BackendError('validation', 'bbox は数値4要素 [x0, top, x1, bottom] です', '')
  const numbers = rawBbox.map(Number)
  // ページ境界へクランプする（範囲外指定の安全化。検討資料 §16.3 スナップ方針）
  const x0 = Math.max(0, Math.min(Math.min(numbers[0]!, numbers[2]!), page.width))
  const x1 = Math.min(page.width, Math.max(numbers[0]!, numbers[2]!))
  const top = Math.max(0, Math.min(Math.min(numbers[1]!, numbers[3]!), page.height))
  const bottom = Math.min(page.height, Math.max(numbers[1]!, numbers[3]!))
  if (x1 - x0 < 1 || bottom - top < 1)
    throw new BackendError('validation', '領域の幅・高さは1pt以上必要です', `${x0},${top},${x1},${bottom}`)
  const type = String(item.region_type ?? 'text') as PdfRegionType
  if (!PDF_REGION_TYPES.includes(type)) throw new BackendError('validation', `未対応の領域種別です: ${type}`, '')
  const confidence = Number(item.confidence ?? 0)
  const level = Number(item.level)
  const readingOrder = Number(item.reading_order)
  return {
    region_uid: preserveUid ?? (typeof item.region_uid === 'string' && item.region_uid ? item.region_uid : newUid()),
    page_index: pageIndex,
    bbox: [round2(x0), round2(top), round2(x1), round2(bottom)],
    region_type: type,
    title: String(item.title ?? '').trim(),
    text_preview: typeof item.text_preview === 'string' ? item.text_preview : '',
    detection_methods: Array.isArray(item.detection_methods)
      ? item.detection_methods.filter((entry): entry is string => typeof entry === 'string')
      : [],
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    candidate_status:
      item.candidate_status === 'adjusted' ||
      item.candidate_status === 'confirmed' ||
      item.candidate_status === 'rejected'
        ? item.candidate_status
        : 'detected',
    review_status: item.review_status === 'rejected' ? 'rejected' : 'approved',
    reading_order: Number.isFinite(readingOrder) ? readingOrder : 0,
    block_ids: Array.isArray(item.block_ids)
      ? item.block_ids.filter((entry): entry is string => typeof entry === 'string')
      : [],
    level: Number.isFinite(level) && level >= 1 ? Math.min(Math.trunc(level), 6) : undefined,
    caption_of: typeof item.caption_of === 'string' && item.caption_of ? item.caption_of : undefined,
    table_data: asTableData(item.table_data),
    llm_suggestion:
      typeof item.llm_suggestion === 'object' && item.llm_suggestion !== null
        ? (item.llm_suggestion as Record<string, unknown>)
        : undefined
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function overlapRatio(inner: [number, number, number, number], outer: [number, number, number, number]): number {
  const x0 = Math.max(inner[0], outer[0])
  const top = Math.max(inner[1], outer[1])
  const x1 = Math.min(inner[2], outer[2])
  const bottom = Math.min(inner[3], outer[3])
  if (x1 <= x0 || bottom <= top) return 0
  const area = Math.max(0, inner[2] - inner[0]) * Math.max(0, inner[3] - inner[1])
  return area > 0 ? ((x1 - x0) * (bottom - top)) / area : 0
}

/** 領域 bbox に半分以上含まれる行を読み順に連結してプレビュー文字列を作る */
export function textInRegion(physical: PdfPhysicalOutput, region: PdfRegion): string {
  const page = physical.document.pages.find((entry) => entry.page_index === region.page_index)
  if (!page) return ''
  const lines = page.blocks
    .flatMap((block) => block.lines)
    .filter((line) => overlapRatio(line.bbox, region.bbox) >= 0.5)
    .sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
  return lines.map((line) => line.text).join('\n')
}

function parseRow(row: {
  source_document_uid: string
  status: PdfDraft['status']
  physical_json: string
  regions_json: string
  last_llm_run_uid: string | null
  confirmed_extracted_document_uid: string | null
  created_at: string
  updated_at: string
  confirmed_at: string | null
}): PdfDraft {
  return {
    source_document_uid: row.source_document_uid,
    status: row.status,
    physical: JSON.parse(row.physical_json) as PdfPhysicalOutput,
    regions: JSON.parse(row.regions_json) as PdfRegion[],
    last_llm_run_uid: row.last_llm_run_uid,
    confirmed_extracted_document_uid: row.confirmed_extracted_document_uid,
    created_at: row.created_at,
    updated_at: row.updated_at,
    confirmed_at: row.confirmed_at
  }
}

export function storePdfDraft(db: Database, sourceDocumentUid: string, output: PdfPhysicalOutput): PdfDraft {
  if (!output.document || !Array.isArray(output.document.pages) || !Array.isArray(output.candidates))
    throw new BackendError('validation', 'PDFワーカー出力の構造が不正です', '')
  const source = db.prepare(`SELECT file_type FROM source_document WHERE uid=?`).get(sourceDocumentUid) as
    { file_type: string } | undefined
  if (!source) throw new BackendError('not_found', `原本が見つかりません: ${sourceDocumentUid}`, '')
  if (source.file_type !== 'pdf') throw new BackendError('validation', 'PDF原本ではありません', source.file_type)

  // 候補UIDはLocal BackendでUUIDv7を採番し、ワーカー内キー（candidate_key）の参照を差し替える
  const uidByKey = new Map<string, string>()
  const prepared = output.candidates.map((candidate) => {
    const uid = newUid()
    const key = typeof candidate.candidate_key === 'string' ? candidate.candidate_key : ''
    if (key) uidByKey.set(key, uid)
    return { candidate, uid }
  })
  const pages = output.document.pages
  const regions = prepared.map(({ candidate, uid }) => {
    const region = asRegion(candidate, pages, uid)
    const captionKey = typeof candidate.caption_of_key === 'string' ? candidate.caption_of_key : ''
    if (captionKey && uidByKey.has(captionKey)) region.caption_of = uidByKey.get(captionKey)
    return region
  })
  const now = new Date().toISOString()
  db.prepare(
    `INSERT INTO pdf_extraction_draft (source_document_uid,status,physical_json,regions_json,created_at,updated_at)
     VALUES (?, 'generated', ?, ?, ?, ?)
     ON CONFLICT(source_document_uid) DO UPDATE SET
       status='generated', physical_json=excluded.physical_json, regions_json=excluded.regions_json,
       last_llm_run_uid=NULL, confirmed_extracted_document_uid=NULL, confirmed_at=NULL, updated_at=excluded.updated_at`
  ).run(sourceDocumentUid, JSON.stringify(output), JSON.stringify(regions), now, now)
  return getPdfDraft(db, sourceDocumentUid)
}

export function getPdfDraft(db: Database, sourceDocumentUid: string): PdfDraft {
  const row = db.prepare(`SELECT * FROM pdf_extraction_draft WHERE source_document_uid=?`).get(sourceDocumentUid) as
    Parameters<typeof parseRow>[0] | undefined
  if (!row) throw new BackendError('not_found', 'PDF抽出領域候補がありません', sourceDocumentUid)
  return parseRow(row)
}

export function savePdfRegions(
  db: Database,
  sourceDocumentUid: string,
  regionsInput: unknown[]
): { regions: PdfRegion[]; updatedAt: string } {
  const draft = getPdfDraft(db, sourceDocumentUid)
  if (draft.status === 'confirmed') throw new BackendError('conflict', '確定済みの領域は編集できません', '')
  const existingUids = new Set(draft.regions.map((region) => region.region_uid))
  const seen = new Set<string>()
  const regions = regionsInput.map((region) => {
    const raw = region as Record<string, unknown>
    const requestedUid = typeof raw?.region_uid === 'string' ? raw.region_uid : undefined
    const normalized = asRegion(
      region,
      draft.physical.document.pages,
      requestedUid && existingUids.has(requestedUid) ? requestedUid : undefined
    )
    if (seen.has(normalized.region_uid))
      throw new BackendError('validation', '領域UIDが重複しています', normalized.region_uid)
    seen.add(normalized.region_uid)
    return normalized
  })
  const validUids = new Set(regions.map((region) => region.region_uid))
  for (const region of regions) {
    // 図・装飾以外はレビュー表示用プレビューを物理情報から再計算する（領域調整の即時反映）
    if (region.region_type !== 'figure' && region.region_type !== 'decoration' && !region.table_data) {
      region.text_preview = textInRegion(draft.physical, region).slice(0, 500)
    }
    if (!region.title) region.title = region.text_preview.split('\n')[0]?.slice(0, 40) || region.region_type
    if (region.caption_of && !validUids.has(region.caption_of)) region.caption_of = undefined
  }
  const updatedAt = new Date().toISOString()
  db.prepare(
    `UPDATE pdf_extraction_draft SET status='editing', regions_json=?, updated_at=? WHERE source_document_uid=?`
  ).run(JSON.stringify(regions), updatedAt, sourceDocumentUid)
  return { regions, updatedAt }
}

/** 図領域の切出し画像情報（pdf.confirm ジョブが extract.pdf.region crop で生成する） */
export interface PdfRegionCrop {
  /** プロジェクトルート相対のPNGパス */
  image: string
  width?: number
  height?: number
}

const BULLET_RE = /^([-*•・◦▪‣]|[(（]?[0-9a-zA-Z０-９]{1,3}[)）.、]|[①-⑳])\s*/

/**
 * 採用済み・非除外の領域候補を reading_order 順に②抽出要素へ変換する（P5-20C、EXT-031）。
 * header/footer/page_number/decoration は採否に関わらず②へ変換しない（検討資料 §6.2/§9）。
 */
export function buildPdfExtractionElements(
  draft: PdfDraft,
  crops: Map<string, PdfRegionCrop> = new Map()
): ExtractionElement[] {
  const selected = draft.regions
    .filter((region) => region.review_status === 'approved' && !PDF_EXCLUDED_TYPES.includes(region.region_type))
    .sort((a, b) => a.reading_order - b.reading_order || a.page_index - b.page_index)
  const captionByTarget = new Map<string, PdfRegion>()
  for (const region of draft.regions) {
    if (region.region_type === 'caption' && region.caption_of) captionByTarget.set(region.caption_of, region)
  }
  const pageOf = (region: PdfRegion): PdfPage | undefined =>
    draft.physical.document.pages.find((page) => page.page_index === region.page_index)

  const elements: ExtractionElement[] = []
  for (const region of selected) {
    const pageNumber = pageOf(region)?.page_number ?? region.page_index + 1
    const base = {
      id: region.region_uid,
      candidate_uid: region.region_uid,
      section_path: `p${pageNumber}`,
      page_no_start: pageNumber,
      page_no_end: pageNumber,
      bbox: region.bbox
    }
    const text = textInRegion(draft.physical, region) || region.text_preview
    switch (region.region_type) {
      case 'heading':
        elements.push({ ...base, type: 'heading', text, level: region.level ?? 1 })
        break
      case 'list': {
        const lines = text.split('\n').filter((line) => line.trim())
        if (lines.length === 0) break
        for (const [index, line] of lines.entries()) {
          elements.push({
            ...base,
            id: `${region.region_uid}-L${index + 1}`,
            type: 'list_item',
            text: line.replace(BULLET_RE, '').trim() || line.trim(),
            level: 0
          })
        }
        break
      }
      case 'table': {
        if (!region.table_data || region.table_data.rows.length === 0) {
          elements.push({ ...base, type: 'paragraph', text })
          break
        }
        elements.push({
          ...base,
          type: 'table',
          text: region.title,
          rows: region.table_data.rows.map((row) => row.map((cell) => ({ text: cell }))),
          row_count: region.table_data.row_count,
          column_count: region.table_data.column_count
        })
        break
      }
      case 'figure': {
        const crop = crops.get(region.region_uid)
        const caption = captionByTarget.get(region.region_uid)
        elements.push({
          ...base,
          type: 'figure',
          text: region.title,
          caption: caption ? textInRegion(draft.physical, caption) || caption.text_preview : null,
          image: crop?.image,
          width: crop?.width,
          height: crop?.height,
          image_format: crop ? 'PNG' : undefined
        })
        break
      }
      case 'caption':
        elements.push({ ...base, type: 'caption', text })
        break
      case 'formula':
        elements.push({ ...base, type: 'formula', text })
        break
      default:
        elements.push({ ...base, type: 'paragraph', text })
    }
  }
  return elements
}

/**
 * 人間が確定した領域候補から②抽出データを生成する（P5-20C、検討資料 §25 中核要件11）。
 * 採用領域だけを storeExtractionResult へ渡し、原本ページ・bbox を source_location に保持する。
 */
export function confirmPdfDraft(
  db: Database,
  input: {
    projectUid: string
    projectRoot: string
    sourceDocumentUid: string
    crops?: Map<string, PdfRegionCrop>
  }
): { extractedDocumentUid: string; code: string; elementCount: number } {
  const draft = getPdfDraft(db, input.sourceDocumentUid)
  if (draft.status === 'confirmed') throw new BackendError('conflict', 'PDF候補は確定済みです', '')
  const elements = buildPdfExtractionElements(draft, input.crops ?? new Map())
  if (elements.length === 0) throw new BackendError('validation', '抽出対象の採用領域がありません', '')
  const extraction = {
    metadata: draft.physical.metadata,
    review_hints: draft.physical.review_hints,
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
    const excluded = (region: PdfRegion): boolean =>
      region.review_status === 'rejected' || PDF_EXCLUDED_TYPES.includes(region.region_type)
    db.prepare(
      `UPDATE pdf_extraction_draft
          SET status='confirmed', regions_json=?, confirmed_extracted_document_uid=?, confirmed_at=?, updated_at=?
        WHERE source_document_uid=?`
    ).run(
      JSON.stringify(
        draft.regions.map((region) =>
          excluded(region)
            ? { ...region, candidate_status: 'rejected' as const }
            : { ...region, candidate_status: 'confirmed' as const }
        )
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

/** 領域単位の部分再解析結果（表・テキスト）を該当領域へ反映する（EXT-029、検討資料 §14） */
export function applyPdfRegionReanalysis(
  db: Database,
  sourceDocumentUid: string,
  regionUid: string,
  result: { table?: unknown; text?: string }
): { regions: PdfRegion[] } {
  const draft = getPdfDraft(db, sourceDocumentUid)
  if (draft.status === 'confirmed') throw new BackendError('conflict', '確定済みの領域は編集できません', '')
  const target = draft.regions.find((region) => region.region_uid === regionUid)
  if (!target) throw new BackendError('not_found', `領域が見つかりません: ${regionUid}`, '')
  if (result.table !== undefined) {
    const tableData = asTableData(result.table)
    if (!tableData) throw new BackendError('validation', '表の再解析結果が不正です', '')
    target.table_data = tableData
    target.text_preview = tableData.rows[0]?.filter(Boolean).join(' | ').slice(0, 200) ?? ''
  } else if (typeof result.text === 'string') {
    target.text_preview = result.text.slice(0, 500)
  }
  target.candidate_status = 'adjusted'
  const updatedAt = new Date().toISOString()
  db.prepare(
    `UPDATE pdf_extraction_draft SET status='editing', regions_json=?, updated_at=? WHERE source_document_uid=?`
  ).run(JSON.stringify(draft.regions), updatedAt, sourceDocumentUid)
  return { regions: draft.regions }
}
