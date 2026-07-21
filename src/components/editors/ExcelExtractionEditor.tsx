/**
 * Excel抽出グループ候補レビュー（P5-19、EXT-049〜062）。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { executeCommand } from '../../services/command-registry'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { LlmRequestDialog, type LlmRequestMessage, type PreparedLlmRequest } from '../common/LlmRequestDialog'
import { showContextMenu } from '../common/ContextMenu'
import { ResizablePaneGroup } from '../workbench/ResizablePaneGroup'

type CandidateType = 'table' | 'text' | 'list' | 'formula' | 'figure' | 'model' | 'unknown'
type ReviewStatus = 'approved' | 'rejected'
interface Cell {
  address: string
  row: number
  column: number
  display_value?: string | null
  formula?: string | null
  style?: Record<string, unknown>
  comment?: { text?: string } | null
}
interface Drawing {
  drawing_uid: string
  drawing_type: string
  name?: string
  text?: string
  start_cell: string
  end_cell: string
  preview_path?: string
  style?: Record<string, unknown>
  connection_status?: string
}
interface Sheet {
  name: string
  state: string
  dimension?: string
  cells: Cell[]
  merged_ranges: string[]
  drawings?: Drawing[]
}
interface Candidate {
  candidate_uid: string
  sheet_name: string
  start_cell: string
  end_cell: string
  candidate_type: CandidateType
  title: string
  detection_methods: string[]
  confidence: number
  candidate_status: 'detected' | 'adjusted' | 'confirmed' | 'rejected'
  review_status: ReviewStatus
  llm_suggestion?: Record<string, unknown>
  drawing_refs?: string[]
  table_header_row_start?: string
  table_header_row_end?: string
  table_header_column_start?: string
  table_header_column_end?: string
}
interface Draft {
  source_document_uid: string
  status: 'generated' | 'editing' | 'confirmed' | 'failed'
  physical: {
    workbook: { file_name: string; active_tab: number; sheets: Sheet[] }
    review_hints: { warnings: string[] }
  }
  candidates: Candidate[]
  predecessor_source_document_uid: string | null
  diff: { candidates: Array<{ candidate_uid: string; status: string }> } | null
}
interface Range {
  anchor: [number, number]
  focus: [number, number]
}
const CELL_W = 96
const CELL_H = 24
const ROW_HEADER = 38
const COL_HEADER = 24
const TYPES: CandidateType[] = ['table', 'text', 'list', 'formula', 'figure', 'model', 'unknown']

function cellPosition(address: string): [number, number] {
  const match = /^([A-Z]+)([0-9]+)$/.exec(address.toUpperCase())
  if (!match) return [1, 1]
  let column = 0
  for (const char of match[1]!) column = column * 26 + char.charCodeAt(0) - 64
  return [Number(match[2]), column]
}
function columnName(column: number): string {
  let value = column
  let name = ''
  while (value > 0) {
    value--
    name = String.fromCharCode(65 + (value % 26)) + name
    value = Math.floor(value / 26)
  }
  return name
}
function address(row: number, column: number): string {
  return columnName(Math.max(1, column)) + Math.max(1, row)
}
function bounds(range: Range): [number, number, number, number] {
  return [
    Math.min(range.anchor[0], range.focus[0]),
    Math.min(range.anchor[1], range.focus[1]),
    Math.max(range.anchor[0], range.focus[0]),
    Math.max(range.anchor[1], range.focus[1])
  ]
}
function cellVisualStyle(cell: Cell): CSSProperties {
  const style = cell.style ?? {}
  const font = (style.font ?? {}) as Record<string, unknown>
  const fill = (style.fill ?? {}) as Record<string, unknown>
  const foreground = (fill.foreground ?? {}) as Record<string, unknown>
  const alignment = (style.alignment ?? {}) as Record<string, unknown>
  const rgb = typeof foreground.rgb === 'string' ? foreground.rgb.slice(-6) : undefined
  const fontColor = (font.color ?? {}) as Record<string, unknown>
  const textRgb = typeof fontColor.rgb === 'string' ? fontColor.rgb.slice(-6) : undefined
  return {
    backgroundColor: rgb ? `#${rgb}` : undefined,
    color: textRgb ? `#${textRgb}` : undefined,
    fontWeight: font.bold ? 700 : undefined,
    fontStyle: font.italic ? 'italic' : undefined,
    textDecoration: font.underline ? 'underline' : font.strike ? 'line-through' : undefined,
    textAlign: alignment.horizontal === 'center' || alignment.horizontal === 'right' ? alignment.horizontal : undefined,
    whiteSpace: alignment.wrapText ? 'normal' : undefined
  }
}
function candidateRange(candidate: Candidate): Range {
  return { anchor: cellPosition(candidate.start_cell), focus: cellPosition(candidate.end_cell) }
}

export function ExcelExtractionEditor({ sourceDocumentUid }: { sourceDocumentUid: string }): React.JSX.Element {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [sheetName, setSheetName] = useState('')
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set())
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const [selection, setSelection] = useState<Range>({ anchor: [1, 1], focus: [1, 1] })
  const [viewport, setViewport] = useState({ row: 1, column: 1, rows: 40, columns: 12 })
  const [llmRequest, setLlmRequest] = useState<PreparedLlmRequest | null>(null)
  const [llmMode, setLlmMode] = useState<'candidate' | 'range'>('range')
  const [figureUrl, setFigureUrl] = useState<string | null>(null)
  const draggingSelection = useRef(false)
  const gridRef = useRef<HTMLDivElement>(null)
  const notify = useJobsStore((state) => state.notify)
  const openResource = useEditorStore((state) => state.openResource)

  const load = useCallback(async (): Promise<void> => {
    const result = await invoke<Draft>('excelDraft.get', { sourceDocumentUid })
    if (!result.ok) return notify('error', 'Excel候補を取得できませんでした', result.error.message)
    setDraft(result.result)
    setCandidates(
      result.result.candidates.map((candidate) => ({
        ...candidate,
        review_status: candidate.review_status === 'rejected' ? 'rejected' : 'approved'
      }))
    )
    setSheetName(
      (current) =>
        current ||
        result.result.physical.workbook.sheets[result.result.physical.workbook.active_tab]?.name ||
        result.result.physical.workbook.sheets[0]?.name ||
        ''
    )
  }, [notify, sourceDocumentUid])
  useEffect(() => {
    void load()
    return onBackendEvent((event, payload) => {
      if (event !== 'excelDraft.updated' && event !== 'job.updated') return
      const uid = (payload as { sourceDocumentUid?: string }).sourceDocumentUid
      if (!uid || uid === sourceDocumentUid) void load()
    })
  }, [load, sourceDocumentUid])

  const sheet = draft?.physical.workbook.sheets.find((item) => item.name === sheetName)
  const sheetCandidates = useMemo(
    () => candidates.filter((item) => item.sheet_name === sheetName),
    [candidates, sheetName]
  )
  const active = candidates.find((item) => item.candidate_uid === activeUid) ?? null
  const maxRow = Math.max(
    1,
    ...(sheet?.cells.map((cell) => cell.row) ?? []),
    ...sheetCandidates.flatMap((item) => [cellPosition(item.start_cell)[0], cellPosition(item.end_cell)[0]])
  )
  const maxColumn = Math.max(
    1,
    ...(sheet?.cells.map((cell) => cell.column) ?? []),
    ...sheetCandidates.flatMap((item) => [cellPosition(item.start_cell)[1], cellPosition(item.end_cell)[1]])
  )
  const visibleCells = useMemo(
    () =>
      (sheet?.cells ?? []).filter(
        (cell) =>
          cell.row >= viewport.row - 1 &&
          cell.row <= viewport.row + viewport.rows + 1 &&
          cell.column >= viewport.column - 1 &&
          cell.column <= viewport.column + viewport.columns + 1
      ),
    [sheet, viewport]
  )
  const [sr1, sc1, sr2, sc2] = bounds(selection)
  const rangeText = (sheet?.cells ?? [])
    .filter((cell) => cell.row >= sr1 && cell.row <= sr2 && cell.column >= sc1 && cell.column <= sc2)
    .map((cell) => cell.display_value)
    .filter(Boolean)
    .join(' / ')
  const counts = sheetCandidates.reduce(
    (acc, item) => {
      if (item.review_status === 'rejected') acc.rejected++
      else acc.approved++
      return acc
    },
    { approved: 0, rejected: 0 }
  )

  const patchCandidate = (uid: string, patch: Partial<Candidate>): void => {
    if (draft?.status === 'confirmed') return
    setCandidates((items) =>
      items.map((item) =>
        item.candidate_uid === uid
          ? { ...item, ...patch, candidate_status: patch.review_status === 'rejected' ? 'rejected' : 'adjusted' }
          : item
      )
    )
  }
  const patchSelectedStatus = (status: ReviewStatus, targetUids: Set<string> = selectedUids): void => {
    if (draft?.status === 'confirmed') return
    setCandidates((items) =>
      items.map((item) =>
        targetUids.has(item.candidate_uid)
          ? { ...item, review_status: status, candidate_status: status === 'rejected' ? 'rejected' : 'adjusted' }
          : item
      )
    )
  }
  const save = async (): Promise<boolean> => {
    const result = await invoke('excelDraft.saveCandidates', { sourceDocumentUid, candidates })
    if (!result.ok) {
      notify('error', 'Excel候補を保存できませんでした', result.error.message)
      return false
    }
    await load()
    return true
  }
  const addCandidate = (): void => {
    if (draft?.status === 'confirmed') return
    const next: Candidate = {
      candidate_uid: 'new-' + Date.now(),
      sheet_name: sheetName,
      start_cell: address(sr1, sc1),
      end_cell: address(sr2, sc2),
      candidate_type: 'text',
      title: rangeText.slice(0, 120) || '新しい抽出グループ',
      detection_methods: ['manual_overlay'],
      confidence: 1,
      candidate_status: 'adjusted',
      review_status: 'approved'
    }
    setCandidates((items) => [...items, next])
    setActiveUid(next.candidate_uid)
    setSelectedUids(new Set([next.candidate_uid]))
  }
  const removeSelected = (): void => {
    if (draft?.status === 'confirmed') return
    setCandidates((items) => items.filter((item) => !selectedUids.has(item.candidate_uid)))
    setSelectedUids(new Set())
    setActiveUid(null)
  }
  const prepareCandidateLlm = async (): Promise<void> => {
    if (!selectedUids.size || !(await save())) return
    const result = await invoke<PreparedLlmRequest>('excelDraft.prepareLlm', {
      sourceDocumentUid,
      candidateUids: [...selectedUids]
    })
    if (!result.ok) return notify('error', 'LLM支援の入力を作成できませんでした', result.error.message)
    setLlmMode('candidate')
    setLlmRequest(result.result)
  }
  const prepareRangeLlm = async (): Promise<void> => {
    const result = await invoke<PreparedLlmRequest>('excelDraft.prepareRangeLlm', {
      sourceDocumentUid,
      sheetName,
      startCell: address(sr1, sc1),
      endCell: address(sr2, sc2)
    })
    if (!result.ok) return notify('error', '範囲LLM支援の入力を作成できませんでした', result.error.message)
    setLlmMode('range')
    setLlmRequest(result.result)
  }
  const runLlm = async (messages: LlmRequestMessage[], promptTemplateUid?: string): Promise<void> => {
    const method = llmMode === 'range' ? 'excelDraft.runRangeLlmConfirmed' : 'excelDraft.runLlmConfirmed'
    const params =
      llmMode === 'range'
        ? {
            sourceDocumentUid,
            sheetName,
            startCell: address(sr1, sc1),
            endCell: address(sr2, sc2),
            messages,
            promptTemplateUid
          }
        : { sourceDocumentUid, candidateUids: [...selectedUids], messages, promptTemplateUid }
    const result = await invoke(method, params)
    if (!result.ok) return notify('error', 'Excel候補のLLM支援を開始できませんでした', result.error.message)
    notify('info', 'Excel候補のLLM支援を開始しました')
    void executeCommand('job.openPanel')
  }
  const confirm = async (): Promise<void> => {
    if (!(await save())) return
    const result = await invoke<{ extractedDocumentUid: string; elementCount: number }>('excelDraft.confirm', {
      sourceDocumentUid
    })
    if (!result.ok) return notify('error', 'Excel抽出を確定できませんでした', result.error.message)
    notify('info', 'Excel候補から②抽出データを生成しました（' + result.result.elementCount + '要素）')
    openResource(
      'extracted://' + result.result.extractedDocumentUid,
      '抽出: ' + (draft?.physical.workbook.file_name ?? 'Excel')
    )
  }
  const chooseCandidate = (candidate: Candidate, additive: boolean): void => {
    setActiveUid(candidate.candidate_uid)
    setSelection(candidateRange(candidate))
    setSelectedUids((current) => {
      const next = additive ? new Set(current) : new Set<string>()
      if (next.has(candidate.candidate_uid) && additive) next.delete(candidate.candidate_uid)
      else next.add(candidate.candidate_uid)
      return next
    })
  }
  const moveOrResize = (candidate: Candidate, mode: 'move' | 'resize', event: React.PointerEvent): void => {
    event.stopPropagation()
    const originX = event.clientX
    const originY = event.clientY
    const original = candidateRange(candidate)
    const target = event.currentTarget as HTMLElement
    target.setPointerCapture(event.pointerId)
    const move = (next: PointerEvent): void => {
      const dc = Math.round((next.clientX - originX) / CELL_W)
      const dr = Math.round((next.clientY - originY) / CELL_H)
      const [r1, c1, r2, c2] = bounds(original)
      if (mode === 'move')
        patchCandidate(candidate.candidate_uid, {
          start_cell: address(Math.max(1, r1 + dr), Math.max(1, c1 + dc)),
          end_cell: address(Math.max(1, r2 + dr), Math.max(1, c2 + dc))
        })
      else patchCandidate(candidate.candidate_uid, { end_cell: address(Math.max(r1, r2 + dr), Math.max(c1, c2 + dc)) })
    }
    const finish = (): void => {
      target.removeEventListener('pointermove', move)
      target.removeEventListener('pointerup', finish)
      target.removeEventListener('pointercancel', finish)
    }
    target.addEventListener('pointermove', move)
    target.addEventListener('pointerup', finish)
    target.addEventListener('pointercancel', finish)
  }
  useEffect(() => {
    setFigureUrl(null)
    const drawingUid = active?.candidate_type === 'figure' ? active.drawing_refs?.[0] : undefined
    if (!drawingUid) return
    void invoke<{ dataUrl: string }>('excelDraft.getDrawingPreview', { sourceDocumentUid, drawingUid }).then(
      (result) => {
        if (result.ok) setFigureUrl(result.result.dataUrl)
      }
    )
  }, [active, sourceDocumentUid])

  if (!draft) return <div className="d2d-empty">Excel抽出グループ候補を読込中…</div>
  const updateViewport = (): void => {
    const node = gridRef.current
    if (!node) return
    setViewport({
      row: Math.max(1, Math.floor(node.scrollTop / CELL_H)),
      column: Math.max(1, Math.floor(node.scrollLeft / CELL_W)),
      rows: Math.ceil(node.clientHeight / CELL_H),
      columns: Math.ceil(node.clientWidth / CELL_W)
    })
  }
  const scrollCellIntoView = (row: number, column: number): void => {
    const node = gridRef.current
    if (!node) return
    const top = COL_HEADER + (row - 1) * CELL_H
    const left = ROW_HEADER + (column - 1) * CELL_W
    if (top < node.scrollTop + COL_HEADER) node.scrollTop = Math.max(0, top - COL_HEADER)
    else if (top + CELL_H > node.scrollTop + node.clientHeight) node.scrollTop = top + CELL_H - node.clientHeight
    if (left < node.scrollLeft + ROW_HEADER) node.scrollLeft = Math.max(0, left - ROW_HEADER)
    else if (left + CELL_W > node.scrollLeft + node.clientWidth) node.scrollLeft = left + CELL_W - node.clientWidth
  }
  const ctrlArrowTarget = (row: number, column: number, dr: number, dc: number): [number, number] => {
    const occupied = new Set(
      (sheet?.cells ?? [])
        .filter((cell) => cell.display_value != null && cell.display_value !== '')
        .map((cell) => `${cell.row}:${cell.column}`)
    )
    const boundary: [number, number] = [dr < 0 ? 1 : dr > 0 ? maxRow : row, dc < 0 ? 1 : dc > 0 ? maxColumn : column]
    let nextRow = row + dr
    let nextColumn = column + dc
    const valid = (): boolean => nextRow >= 1 && nextRow <= maxRow && nextColumn >= 1 && nextColumn <= maxColumn
    const currentOccupied = occupied.has(`${row}:${column}`)
    if (currentOccupied && valid() && occupied.has(`${nextRow}:${nextColumn}`)) {
      while (valid() && occupied.has(`${nextRow}:${nextColumn}`)) {
        row = nextRow
        column = nextColumn
        nextRow += dr
        nextColumn += dc
      }
      return [row, column]
    }
    while (valid()) {
      if (occupied.has(`${nextRow}:${nextColumn}`)) return [nextRow, nextColumn]
      nextRow += dr
      nextColumn += dc
    }
    return boundary
  }
  const pointFromPointer = (event: React.PointerEvent): [number, number] => {
    const node = gridRef.current
    if (!node) return [1, 1]
    const rect = node.getBoundingClientRect()
    return [
      Math.min(maxRow, Math.max(1, Math.floor((event.clientY - rect.top + node.scrollTop - COL_HEADER) / CELL_H) + 1)),
      Math.min(
        maxColumn,
        Math.max(1, Math.floor((event.clientX - rect.left + node.scrollLeft - ROW_HEADER) / CELL_W) + 1)
      )
    ]
  }

  return (
    <div className="excel-extraction-editor" data-testid="excel-extraction-editor">
      <div className="extraction-review-toolbar">
        <h1>{draft.physical.workbook.file_name}</h1>
        <label className="excel-sheet-select">
          シート
          <select
            value={sheetName}
            onChange={(event) => {
              setSheetName(event.target.value)
              setSelectedUids(new Set())
              setActiveUid(null)
            }}
            data-testid="excel-sheet-select"
          >
            {draft.physical.workbook.sheets.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name + (item.state !== 'visible' ? '（' + item.state + '）' : '')}
              </option>
            ))}
          </select>
        </label>
        <span className="d2d-badge">候補 {sheetCandidates.length}</span>

        <span className="d2d-badge">採用 {counts.approved}</span>
        <span className="d2d-badge">不採用 {counts.rejected}</span>
        <span style={{ flex: 1 }} />
        <button
          className="d2d-btn small"
          type="button"
          onClick={addCandidate}
          disabled={draft.status === 'confirmed'}
          data-testid="excel-candidate-add"
        >
          選択範囲を候補追加
        </button>
        <button
          className="d2d-btn small"
          type="button"
          onClick={() => void prepareRangeLlm()}
          disabled={draft.status === 'confirmed'}
          data-testid="excel-range-llm"
        >
          選択範囲をLLMでグループ化
        </button>
        <button
          className="d2d-btn small"
          type="button"
          disabled={draft.status === 'confirmed' || !selectedUids.size}
          onClick={() => void prepareCandidateLlm()}
          data-testid="excel-candidate-llm"
        >
          候補をLLMで調整
        </button>
        <button
          className="d2d-btn small"
          type="button"
          disabled={draft.status === 'confirmed' || !selectedUids.size}
          onClick={removeSelected}
          data-testid="excel-candidate-delete"
        >
          削除
        </button>

        <button
          className="d2d-btn primary"
          type="button"
          disabled={
            draft.status === 'confirmed' || !candidates.some((candidate) => candidate.review_status === 'approved')
          }
          onClick={() => void confirm()}
          data-testid="excel-candidate-confirm"
        >
          抽出を実行して②を生成
        </button>
      </div>
      {draft.diff && draft.predecessor_source_document_uid && (
        <div className="excel-diff-summary" data-testid="excel-diff-summary">
          再取込差分: {draft.diff.candidates.filter((item) => item.status === 'unchanged').length}件一致 /{' '}
          {draft.diff.candidates.filter((item) => item.status === 'moved').length}件移動 /{' '}
          {draft.diff.candidates.filter((item) => item.status === 'added').length}件追加 /{' '}
          {draft.diff.candidates.filter((item) => item.status === 'ambiguous').length}件要確認
        </div>
      )}
      {draft.physical.review_hints.warnings.length > 0 && (
        <div className="excel-extraction-warnings">
          {draft.physical.review_hints.warnings.map((warning) => (
            <span key={warning}>⚠ {warning}</span>
          ))}
        </div>
      )}
      <ResizablePaneGroup initialSizes={[1.45, 1]} testId="excel-extraction-layout">
        <section className="excel-sheet-pane">
          <div className="excel-selection-bar">
            選択範囲: {address(sr1, sc1)}:{address(sr2, sc2)} <span>{rangeText || '（空セル）'}</span>
          </div>
          <div
            ref={gridRef}
            className="excel-grid-scroll"
            data-testid="excel-sheet-grid"
            tabIndex={0}
            onScroll={updateViewport}
            onKeyDown={(event) => {
              const [row, column] = selection.focus
              const dr = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0
              const dc = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
              if (!dr && !dc) return
              event.preventDefault()
              const next: [number, number] =
                event.ctrlKey || event.metaKey
                  ? ctrlArrowTarget(row, column, dr, dc)
                  : [Math.min(maxRow, Math.max(1, row + dr)), Math.min(maxColumn, Math.max(1, column + dc))]
              setSelection((current) => ({ anchor: event.shiftKey ? current.anchor : next, focus: next }))
              scrollCellIntoView(next[0], next[1])
            }}
          >
            <div
              className="excel-grid-canvas"
              style={{ width: ROW_HEADER + maxColumn * CELL_W, height: COL_HEADER + maxRow * CELL_H }}
              onPointerDown={(event) => {
                if (event.button !== 0) return
                gridRef.current?.focus()
                const point = pointFromPointer(event)
                draggingSelection.current = true
                setSelection({ anchor: event.shiftKey ? selection.anchor : point, focus: point })
                event.currentTarget.setPointerCapture(event.pointerId)
              }}
              onPointerMove={(event) => {
                if (draggingSelection.current)
                  setSelection((current) => ({ ...current, focus: pointFromPointer(event) }))
              }}
              onPointerUp={(event) => {
                draggingSelection.current = false
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId)
              }}
              onPointerCancel={() => {
                draggingSelection.current = false
              }}
            >
              {Array.from({ length: viewport.columns + 2 }, (_, index) => viewport.column + index)
                .filter((column) => column <= maxColumn)
                .map((column) => (
                  <div
                    key={'c' + column}
                    className="excel-column-header"
                    style={{ left: ROW_HEADER + (column - 1) * CELL_W, width: CELL_W }}
                  >
                    {columnName(column)}
                  </div>
                ))}
              {Array.from({ length: viewport.rows + 2 }, (_, index) => viewport.row + index)
                .filter((row) => row <= maxRow)
                .map((row) => (
                  <div
                    key={'r' + row}
                    className="excel-row-header"
                    style={{ top: COL_HEADER + (row - 1) * CELL_H, height: CELL_H }}
                  >
                    {row}
                  </div>
                ))}
              {visibleCells.map((cell) => (
                <div
                  key={cell.address}
                  className="excel-cell"
                  style={{
                    ...cellVisualStyle(cell),
                    left: ROW_HEADER + (cell.column - 1) * CELL_W,
                    top: COL_HEADER + (cell.row - 1) * CELL_H,
                    width: CELL_W,
                    height: CELL_H
                  }}
                  title={
                    cell.address +
                    (cell.formula ? '\n数式: ' + cell.formula : '') +
                    (cell.comment?.text ? '\nコメント: ' + cell.comment.text : '')
                  }
                >
                  {cell.display_value ?? ''}
                </div>
              ))}
              <div
                className="excel-selection-overlay"
                style={{
                  left: ROW_HEADER + (sc1 - 1) * CELL_W,
                  top: COL_HEADER + (sr1 - 1) * CELL_H,
                  width: (sc2 - sc1 + 1) * CELL_W,
                  height: (sr2 - sr1 + 1) * CELL_H
                }}
              />
              {sheetCandidates.map((candidate) => {
                const [r1, c1, r2, c2] = bounds(candidateRange(candidate))
                return (
                  <div
                    key={candidate.candidate_uid}
                    className={
                      'excel-candidate-overlay type-' +
                      candidate.candidate_type +
                      (selectedUids.has(candidate.candidate_uid) ? ' active' : '')
                    }
                    style={{
                      left: ROW_HEADER + (c1 - 1) * CELL_W,
                      top: COL_HEADER + (r1 - 1) * CELL_H,
                      width: (c2 - c1 + 1) * CELL_W,
                      height: (r2 - r1 + 1) * CELL_H
                    }}
                    onPointerDown={(event) => {
                      event.stopPropagation()
                      chooseCandidate(candidate, event.ctrlKey || event.metaKey)
                    }}
                    data-testid={'excel-overlay-' + candidate.candidate_uid}
                  >
                    <button
                      type="button"
                      className="excel-overlay-move"
                      aria-label="候補範囲を移動"
                      onPointerDown={(event) => moveOrResize(candidate, 'move', event)}
                    >
                      ⋮⋮ {candidate.candidate_type}
                    </button>
                    <button
                      type="button"
                      className="excel-overlay-resize"
                      aria-label="候補範囲を変更"
                      onPointerDown={(event) => moveOrResize(candidate, 'resize', event)}
                    >
                      ◢
                    </button>
                  </div>
                )
              })}
            </div>
          </div>
          <div className="excel-sheet-meta">
            保持範囲: {sheet?.dimension ?? address(maxRow, maxColumn)} / セル {sheet?.cells.length ?? 0} / 図{' '}
            {sheet?.drawings?.length ?? 0} / 結合 {sheet?.merged_ranges.length ?? 0}
          </div>
        </section>
        <section className="excel-candidate-pane">
          <ResizablePaneGroup initialSizes={[1, 1.2]} testId="excel-candidate-detail-layout" axis="y" minPaneSize={100}>
            <div className="excel-candidate-list" data-testid="excel-candidate-list">
              {sheetCandidates.map((candidate) => (
                <div
                  key={candidate.candidate_uid}
                  className={'excel-candidate-row' + (candidate.candidate_uid === activeUid ? ' active' : '')}
                  onContextMenu={(event) => {
                    if (!selectedUids.has(candidate.candidate_uid)) chooseCandidate(candidate, false)
                    showContextMenu(event, [
                      {
                        label: '採用',
                        testId: 'excel-bulk-approved',
                        run: () =>
                          patchSelectedStatus(
                            'approved',
                            selectedUids.has(candidate.candidate_uid)
                              ? selectedUids
                              : new Set([candidate.candidate_uid])
                          )
                      },

                      {
                        label: '不採用',
                        testId: 'excel-bulk-rejected',
                        run: () =>
                          patchSelectedStatus(
                            'rejected',
                            selectedUids.has(candidate.candidate_uid)
                              ? selectedUids
                              : new Set([candidate.candidate_uid])
                          )
                      }
                    ])
                  }}
                >
                  <input
                    type="checkbox"
                    aria-label={candidate.title}
                    checked={selectedUids.has(candidate.candidate_uid)}
                    onChange={() => chooseCandidate(candidate, true)}
                  />
                  <button type="button" onClick={(event) => chooseCandidate(candidate, event.ctrlKey || event.metaKey)}>
                    <span className={'excel-type-tag type-' + candidate.candidate_type}>
                      {candidate.candidate_type}
                    </span>
                    <strong>{candidate.title}</strong>
                    <span>
                      {candidate.start_cell}:{candidate.end_cell} · {candidate.review_status} ·{' '}
                      {Math.round(candidate.confidence * 100)}%
                    </span>
                  </button>
                </div>
              ))}
            </div>
            {active && active.sheet_name === sheetName ? (
              <div className="excel-candidate-form" data-testid="excel-candidate-form">
                <div className="excel-range-text">
                  <label>選択範囲内の文字列</label>
                  <textarea
                    readOnly
                    data-testid="excel-candidate-text-preview"
                    value={
                      (sheet?.cells ?? [])
                        .filter((cell) => {
                          const [r1, c1, r2, c2] = bounds(candidateRange(active))
                          return cell.row >= r1 && cell.row <= r2 && cell.column >= c1 && cell.column <= c2
                        })
                        .map((cell) => cell.display_value)
                        .filter(Boolean)
                        .join(' / ') || '（文字列なし）'
                    }
                  />
                </div>
                <div className="excel-candidate-range-inputs">
                  <label>
                    開始セル
                    <input
                      value={active.start_cell}
                      disabled={draft.status === 'confirmed'}
                      onChange={(event) =>
                        patchCandidate(active.candidate_uid, { start_cell: event.target.value.toUpperCase() })
                      }
                      data-testid="excel-candidate-start"
                    />
                  </label>
                  <label>
                    終了セル
                    <input
                      value={active.end_cell}
                      disabled={draft.status === 'confirmed'}
                      onChange={(event) =>
                        patchCandidate(active.candidate_uid, { end_cell: event.target.value.toUpperCase() })
                      }
                      data-testid="excel-candidate-end"
                    />
                  </label>
                </div>
                <label>
                  種別
                  <select
                    value={active.candidate_type}
                    disabled={draft.status === 'confirmed'}
                    onChange={(event) =>
                      patchCandidate(active.candidate_uid, { candidate_type: event.target.value as CandidateType })
                    }
                    data-testid="excel-candidate-type"
                  >
                    {TYPES.map((type) => (
                      <option key={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label>
                  採否
                  <select
                    value={active.review_status}
                    disabled={draft.status === 'confirmed'}
                    onChange={(event) =>
                      patchCandidate(active.candidate_uid, { review_status: event.target.value as ReviewStatus })
                    }
                    data-testid="excel-candidate-status"
                  >
                    <option value="approved">採用</option>
                    <option value="rejected">不採用</option>
                  </select>
                </label>
                {active.candidate_type === 'figure' && (
                  <div className="excel-figure-preview">
                    {figureUrl ? (
                      <img src={figureUrl} alt="図候補プレビュー" />
                    ) : (
                      <span>図形情報のプレビューを準備中…</span>
                    )}
                  </div>
                )}
                {active.candidate_type === 'table' && (
                  <div className="excel-table-headers">
                    <strong>表タイトル範囲</strong>
                    <span>
                      現在の選択 {address(sr1, sc1)}:{address(sr2, sc2)}
                    </span>
                    <button
                      className="d2d-btn small"
                      type="button"
                      onClick={() =>
                        patchCandidate(active.candidate_uid, {
                          table_header_row_start: address(sr1, sc1),
                          table_header_row_end: address(sr2, sc2)
                        })
                      }
                    >
                      選択をタイトル行に設定
                    </button>
                    <button
                      className="d2d-btn small"
                      type="button"
                      onClick={() =>
                        patchCandidate(active.candidate_uid, {
                          table_header_column_start: address(sr1, sc1),
                          table_header_column_end: address(sr2, sc2)
                        })
                      }
                    >
                      選択をタイトル列に設定
                    </button>
                    <span>
                      行: {active.table_header_row_start ?? '—'}:{active.table_header_row_end ?? '—'} / 列:{' '}
                      {active.table_header_column_start ?? '—'}:{active.table_header_column_end ?? '—'}
                    </span>
                  </div>
                )}
                <div>検出根拠: {active.detection_methods.join(', ') || '手動'}</div>
              </div>
            ) : (
              <div className="d2d-empty">候補を選択してください。</div>
            )}
          </ResizablePaneGroup>
        </section>
      </ResizablePaneGroup>
      {llmRequest && (
        <LlmRequestDialog
          request={llmRequest}
          screenId="excel-candidates"
          title={llmMode === 'range' ? '指定範囲のグルーピングをLLM支援' : '選択候補をLLM支援'}
          onClose={() => setLlmRequest(null)}
          onConfirmed={runLlm}
        />
      )}
    </div>
  )
}
