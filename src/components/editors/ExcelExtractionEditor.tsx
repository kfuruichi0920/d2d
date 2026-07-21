/**
 * Excel抽出グループ候補レビュー（P5-19、EXT-049〜055）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { executeCommand } from '../../services/command-registry'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { LlmRequestDialog, type LlmRequestMessage, type PreparedLlmRequest } from '../common/LlmRequestDialog'
import { ResizablePaneGroup } from '../workbench/ResizablePaneGroup'

interface ExcelCell {
  address: string
  row: number
  column: number
  display_value?: string | null
  raw_value?: string | null
  formula?: string | null
  comment?: { author?: string; text?: string } | null
  style?: Record<string, unknown>
}

interface ExcelSheet {
  name: string
  state: string
  dimension?: string
  cells: ExcelCell[]
  merged_ranges: string[]
  rows: Array<Record<string, unknown>>
  columns: Array<Record<string, unknown>>
}

interface ExcelCandidate {
  candidate_uid: string
  sheet_name: string
  start_cell: string
  end_cell: string
  candidate_type: 'table' | 'text' | 'list' | 'formula' | 'figure' | 'model' | 'unknown'
  title: string
  description?: string
  detection_methods: string[]
  confidence: number
  candidate_status: 'detected' | 'adjusted' | 'confirmed' | 'rejected'
  review_status: 'draft' | 'review' | 'approved' | 'rejected'
  llm_suggestion?: Record<string, unknown>
}

interface ExcelDraft {
  source_document_uid: string
  status: 'generated' | 'editing' | 'confirmed' | 'failed'
  physical: {
    metadata: Record<string, unknown>
    workbook: { file_name: string; active_tab: number; sheets: ExcelSheet[] }
    review_hints: { warnings: string[] }
  }
  candidates: ExcelCandidate[]
  confirmed_extracted_document_uid: string | null
  last_llm_run_uid: string | null
}

function cellPosition(address: string): [number, number] {
  const match = /^([A-Z]+)([0-9]+)$/.exec(address.toUpperCase())
  if (!match) return [0, 0]
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

function inCandidate(cell: ExcelCell, candidate: ExcelCandidate): boolean {
  if (candidate.sheet_name === '') return false
  const [r1, c1] = cellPosition(candidate.start_cell)
  const [r2, c2] = cellPosition(candidate.end_cell)
  return (
    cell.row >= Math.min(r1, r2) &&
    cell.row <= Math.max(r1, r2) &&
    cell.column >= Math.min(c1, c2) &&
    cell.column <= Math.max(c1, c2)
  )
}

export function ExcelExtractionEditor({ sourceDocumentUid }: { sourceDocumentUid: string }): React.JSX.Element {
  const [draft, setDraft] = useState<ExcelDraft | null>(null)
  const [candidates, setCandidates] = useState<ExcelCandidate[]>([])
  const [sheetName, setSheetName] = useState('')
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set())
  const [activeUid, setActiveUid] = useState<string | null>(null)
  const [llmRequest, setLlmRequest] = useState<PreparedLlmRequest | null>(null)
  const notify = useJobsStore((state) => state.notify)
  const openResource = useEditorStore((state) => state.openResource)

  const load = useCallback(async (): Promise<void> => {
    const result = await invoke<ExcelDraft>('excelDraft.get', { sourceDocumentUid })
    if (!result.ok) {
      notify('error', 'Excel候補を取得できませんでした', result.error.message)
      return
    }
    setDraft(result.result)
    setCandidates(result.result.candidates)
    setSheetName((current) => current || result.result.physical.workbook.sheets[0]?.name || '')
    if (!activeUid && result.result.candidates[0]) {
      setActiveUid(result.result.candidates[0].candidate_uid)
      setSelectedUids(new Set([result.result.candidates[0].candidate_uid]))
    }
  }, [activeUid, notify, sourceDocumentUid])

  useEffect(() => {
    void load()
    return onBackendEvent((event, payload) => {
      if (event !== 'excelDraft.updated' && event !== 'job.updated') return
      const sourceUid = (payload as { sourceDocumentUid?: string }).sourceDocumentUid
      if (!sourceUid || sourceUid === sourceDocumentUid) void load()
    })
  }, [load, sourceDocumentUid])

  const sheet = draft?.physical.workbook.sheets.find((item) => item.name === sheetName)
  const active = candidates.find((candidate) => candidate.candidate_uid === activeUid) ?? null
  const visibleCells = useMemo(() => sheet?.cells ?? [], [sheet])
  const maxRow = Math.min(120, Math.max(1, ...visibleCells.map((cell) => cell.row)))
  const maxColumn = Math.min(50, Math.max(1, ...visibleCells.map((cell) => cell.column)))
  const cellMap = useMemo(
    () => new Map(visibleCells.map((cell) => [`${cell.row}:${cell.column}`, cell])),
    [visibleCells]
  )
  const selectedCandidates = candidates.filter((candidate) => selectedUids.has(candidate.candidate_uid))

  const patchCandidate = (uid: string, patch: Partial<ExcelCandidate>): void => {
    setCandidates((current) =>
      current.map((candidate) =>
        candidate.candidate_uid === uid
          ? { ...candidate, ...patch, candidate_status: 'adjusted', review_status: 'review' }
          : candidate
      )
    )
  }

  const save = async (): Promise<boolean> => {
    const result = await invoke('excelDraft.saveCandidates', { sourceDocumentUid, candidates })
    if (!result.ok) {
      notify('error', 'Excel候補を保存できませんでした', result.error.message)
      return false
    }
    notify('info', 'Excel抽出グループ候補を保存しました')
    await load()
    return true
  }

  const addCandidate = (): void => {
    const candidate: ExcelCandidate = {
      candidate_uid: `new-${Date.now()}`,
      sheet_name: sheetName || draft?.physical.workbook.sheets[0]?.name || '',
      start_cell: 'A1',
      end_cell: 'A1',
      candidate_type: 'unknown',
      title: '新しい抽出グループ',
      detection_methods: ['manual'],
      confidence: 1,
      candidate_status: 'adjusted',
      review_status: 'review'
    }
    setCandidates((current) => [...current, candidate])
    setActiveUid(candidate.candidate_uid)
    setSelectedUids(new Set([candidate.candidate_uid]))
  }

  const removeSelected = (): void => {
    setCandidates((current) => current.filter((candidate) => !selectedUids.has(candidate.candidate_uid)))
    setSelectedUids(new Set())
    setActiveUid(null)
  }

  const prepareLlm = async (): Promise<void> => {
    if (selectedUids.size === 0) return
    const saved = await save()
    if (!saved) return
    const result = await invoke<PreparedLlmRequest>('excelDraft.prepareLlm', {
      sourceDocumentUid,
      candidateUids: [...selectedUids]
    })
    if (!result.ok) return notify('error', 'LLM支援の入力を作成できませんでした', result.error.message)
    setLlmRequest(result.result)
  }

  const runLlm = async (messages: LlmRequestMessage[], promptTemplateUid?: string): Promise<void> => {
    const result = await invoke('excelDraft.runLlmConfirmed', {
      sourceDocumentUid,
      candidateUids: [...selectedUids],
      messages,
      promptTemplateUid
    })
    if (!result.ok) return notify('error', 'Excel候補のLLM支援を開始できませんでした', result.error.message)
    notify('info', '選択したExcel候補のLLM支援を開始しました')
    void executeCommand('job.openPanel')
  }

  const confirm = async (): Promise<void> => {
    if (!(await save())) return
    const result = await invoke<{ extractedDocumentUid: string; elementCount: number }>('excelDraft.confirm', {
      sourceDocumentUid
    })
    if (!result.ok) return notify('error', 'Excel抽出を確定できませんでした', result.error.message)
    notify('info', `Excel候補から②抽出データを生成しました（${result.result.elementCount}要素）`)
    openResource(
      `extracted://${result.result.extractedDocumentUid}`,
      `抽出: ${draft?.physical.workbook.file_name ?? 'Excel'}`
    )
  }

  if (!draft) return <div className="d2d-empty">Excel抽出グループ候補を読込中…</div>

  return (
    <div className="excel-extraction-editor" data-testid="excel-extraction-editor">
      <div className="extraction-review-toolbar">
        <h1>{draft.physical.workbook.file_name}</h1>
        <span className="d2d-badge">Excel候補 {candidates.length}件</span>
        <span className="d2d-badge">{draft.status}</span>
        <span style={{ flex: 1 }} />
        <button className="d2d-btn small" type="button" onClick={addCandidate} data-testid="excel-candidate-add">
          候補追加
        </button>
        <button
          className="d2d-btn small"
          type="button"
          disabled={selectedUids.size === 0}
          onClick={removeSelected}
          data-testid="excel-candidate-delete"
        >
          選択候補を削除
        </button>
        <button className="d2d-btn small" type="button" onClick={() => void save()} data-testid="excel-candidate-save">
          候補を保存
        </button>
        <button
          className="d2d-btn small"
          type="button"
          disabled={selectedUids.size === 0 || draft.status === 'confirmed'}
          onClick={() => void prepareLlm()}
          data-testid="excel-candidate-llm"
        >
          選択範囲をLLM支援
        </button>
        <button
          className="d2d-btn primary"
          type="button"
          disabled={draft.status === 'confirmed' || candidates.length === 0}
          onClick={() => void confirm()}
          data-testid="excel-candidate-confirm"
        >
          抽出を実行して②を生成
        </button>
      </div>
      {draft.physical.review_hints.warnings.length > 0 && (
        <div className="excel-extraction-warnings" data-testid="excel-extraction-warnings">
          {draft.physical.review_hints.warnings.map((warning) => (
            <span key={warning}>⚠ {warning}</span>
          ))}
        </div>
      )}
      <ResizablePaneGroup initialSizes={[1.35, 1]} testId="excel-extraction-layout">
        <section className="excel-sheet-pane">
          <div className="excel-sheet-tabs" role="tablist" aria-label="Excelシート">
            {draft.physical.workbook.sheets.map((item) => (
              <button
                type="button"
                role="tab"
                aria-selected={item.name === sheetName}
                className={`d2d-btn small${item.name === sheetName ? ' active' : ''}`}
                key={item.name}
                onClick={() => setSheetName(item.name)}
                data-testid={`excel-sheet-${item.name}`}
              >
                {item.name}
                {item.state !== 'visible' ? `（${item.state}）` : ''}
              </button>
            ))}
          </div>
          <div className="excel-grid-scroll" data-testid="excel-sheet-grid">
            <table className="excel-preview-grid">
              <thead>
                <tr>
                  <th />
                  {Array.from({ length: maxColumn }, (_, index) => (
                    <th key={index + 1}>{columnName(index + 1)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: maxRow }, (_, rowIndex) => (
                  <tr key={rowIndex + 1}>
                    <th>{rowIndex + 1}</th>
                    {Array.from({ length: maxColumn }, (_, columnIndex) => {
                      const cell = cellMap.get(`${rowIndex + 1}:${columnIndex + 1}`)
                      const highlighted = selectedCandidates.some(
                        (candidate) => candidate.sheet_name === sheetName && cell && inCandidate(cell, candidate)
                      )
                      return (
                        <td
                          key={columnIndex + 1}
                          className={highlighted ? 'candidate-range' : ''}
                          title={
                            cell
                              ? `${cell.address}${cell.formula ? `\n数式: ${cell.formula}` : ''}${
                                  cell.comment?.text ? `\nコメント: ${cell.comment.text}` : ''
                                }`
                              : undefined
                          }
                        >
                          {cell?.display_value ?? ''}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="excel-sheet-meta">
            使用範囲: {sheet?.dimension ?? '—'} / 結合セル: {sheet?.merged_ranges.join(', ') || 'なし'}
            {(sheet?.cells.length ?? 0) > maxRow * maxColumn && ' / 大規模シートは先頭120行×50列を表示'}
          </div>
        </section>
        <section className="excel-candidate-pane">
          <div className="excel-candidate-list" data-testid="excel-candidate-list">
            {candidates.map((candidate) => (
              <label
                key={candidate.candidate_uid}
                className={`excel-candidate-row${candidate.candidate_uid === activeUid ? ' active' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selectedUids.has(candidate.candidate_uid)}
                  onChange={(event) => {
                    const next = new Set(selectedUids)
                    if (event.target.checked) next.add(candidate.candidate_uid)
                    else next.delete(candidate.candidate_uid)
                    setSelectedUids(next)
                  }}
                />
                <button
                  type="button"
                  onClick={() => {
                    setActiveUid(candidate.candidate_uid)
                    setSheetName(candidate.sheet_name)
                  }}
                >
                  <strong>{candidate.title}</strong>
                  <span>
                    {candidate.sheet_name}!{candidate.start_cell}:{candidate.end_cell} / {candidate.candidate_type} /{' '}
                    {Math.round(candidate.confidence * 100)}%
                  </span>
                </button>
              </label>
            ))}
          </div>
          {active ? (
            <div className="excel-candidate-form" data-testid="excel-candidate-form">
              <label>
                タイトル
                <input
                  value={active.title}
                  onChange={(event) => patchCandidate(active.candidate_uid, { title: event.target.value })}
                  data-testid="excel-candidate-title"
                />
              </label>
              <label>
                シート
                <select
                  value={active.sheet_name}
                  onChange={(event) => {
                    patchCandidate(active.candidate_uid, { sheet_name: event.target.value })
                    setSheetName(event.target.value)
                  }}
                >
                  {draft.physical.workbook.sheets.map((item) => (
                    <option key={item.name}>{item.name}</option>
                  ))}
                </select>
              </label>
              <div className="excel-candidate-range-inputs">
                <label>
                  開始セル
                  <input
                    value={active.start_cell}
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
                  onChange={(event) =>
                    patchCandidate(active.candidate_uid, {
                      candidate_type: event.target.value as ExcelCandidate['candidate_type']
                    })
                  }
                  data-testid="excel-candidate-type"
                >
                  {['table', 'text', 'list', 'formula', 'figure', 'model', 'unknown'].map((type) => (
                    <option key={type}>{type}</option>
                  ))}
                </select>
              </label>
              <label>
                採否
                <select
                  value={active.review_status}
                  onChange={(event) =>
                    patchCandidate(active.candidate_uid, {
                      review_status: event.target.value as ExcelCandidate['review_status'],
                      candidate_status: event.target.value === 'rejected' ? 'rejected' : 'adjusted'
                    })
                  }
                  data-testid="excel-candidate-status"
                >
                  <option value="draft">未確認</option>
                  <option value="review">要修正</option>
                  <option value="approved">採用</option>
                  <option value="rejected">抽出不要</option>
                </select>
              </label>
              <div>検出根拠: {active.detection_methods.join(', ') || '手動'}</div>
              {active.llm_suggestion && (
                <pre data-testid="excel-llm-suggestion">{JSON.stringify(active.llm_suggestion, null, 2)}</pre>
              )}
            </div>
          ) : (
            <div className="d2d-empty">候補を選択してください。</div>
          )}
        </section>
      </ResizablePaneGroup>
      {llmRequest && (
        <LlmRequestDialog
          request={llmRequest}
          screenId="excel-candidates"
          title="選択したExcel抽出グループ候補をLLM支援"
          onClose={() => setLlmRequest(null)}
          onConfirmed={runLlm}
        />
      )}
    </div>
  )
}
