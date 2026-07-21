import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { importSourceDocument } from '../import/import-service'
import { registerEntity } from '../store/entity-registry'
import {
  applyExcelLlmSuggestions,
  applyExcelRangeLlmSuggestions,
  buildExcelCandidateLlmMessages,
  buildExcelRangeLlmMessages,
  confirmExcelDraft,
  getExcelDraft,
  saveExcelCandidates,
  storeExcelDraft,
  type ExcelPhysicalOutput
} from './excel-draft-service'

const OUTPUT: ExcelPhysicalOutput = {
  metadata: { extractor_name: 'd2d-excel-extractor', extractor_version: '0.1.0' },
  workbook: {
    file_name: 'requirements.xlsx',
    active_tab: 0,
    defined_names: [],
    external_links: [],
    sheets: [
      {
        name: '要求',
        state: 'visible',
        dimension: 'A1:B3',
        rows: [],
        columns: [],
        merged_ranges: ['A1:B1'],
        tables: [],
        comments: [],
        cells: [
          { address: 'A1', row: 1, column: 1, display_value: 'ID' },
          { address: 'B1', row: 1, column: 2, display_value: '要求' },
          { address: 'A2', row: 2, column: 1, display_value: 'REQ-1' },
          { address: 'B2', row: 2, column: 2, display_value: '停止する' },
          { address: 'A3', row: 3, column: 1, formula: 'LEN(B2)', display_value: '4' }
        ]
      },
      {
        name: '秘密',
        state: 'hidden',
        rows: [],
        columns: [],
        merged_ranges: [],
        tables: [],
        comments: [],
        cells: [{ address: 'A1', row: 1, column: 1, display_value: '送信対象外の秘密' }]
      }
    ]
  },
  candidates: [
    {
      sheet_name: '要求',
      start_cell: 'A1',
      end_cell: 'B2',
      candidate_type: 'table',
      title: '要求一覧',
      detection_methods: ['continuous_non_empty'],
      confidence: 0.9,
      candidate_status: 'detected',
      review_status: 'draft'
    },
    {
      sheet_name: '要求',
      start_cell: 'A3',
      end_cell: 'A3',
      candidate_type: 'formula',
      title: '件数式',
      detection_methods: ['continuous_non_empty'],
      confidence: 0.7,
      candidate_status: 'detected',
      review_status: 'draft'
    }
  ],
  package: { parts: [], unsupported_parts: [] },
  review_hints: { warnings: [] }
}

describe('Excel抽出グループ候補（P5-19、EXT-049〜062）', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string
  let sourceDocumentUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-excel-'))
    root = join(dir, 'project')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'Excel test' })
    projectUid = getProjectRow(db).uid
    const source = join(dir, 'requirements.xlsx')
    writeFileSync(source, 'dummy')
    sourceDocumentUid = importSourceDocument(db, projectUid, root, source).sourceDocumentUid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('物理抽出と候補を②正本と分離して保存し、候補UIDをUUIDv7で採番する', () => {
    const draft = storeExcelDraft(db, sourceDocumentUid, OUTPUT)
    expect(draft.status).toBe('generated')
    expect(draft.candidates).toHaveLength(2)
    expect(draft.candidates[0]!.candidate_uid).toMatch(/^[0-9a-f-]{36}$/)
    expect(getExcelDraft(db, sourceDocumentUid).physical.workbook.sheets[0]!.merged_ranges).toEqual(['A1:B1'])
    expect(
      db.prepare(`SELECT COUNT(*) AS count FROM extracted_document WHERE source_document_uid=?`).get(sourceDocumentUid)
    ).toEqual({ count: 0 })
  })

  it('人間の範囲・種別・採否編集を保存し、存在しないシートは拒否する', () => {
    const draft = storeExcelDraft(db, sourceDocumentUid, OUTPUT)
    const first = draft.candidates[0]!
    const saved = saveExcelCandidates(db, sourceDocumentUid, [
      { ...first, start_cell: 'A2', end_cell: 'B3', candidate_type: 'text', review_status: 'approved' }
    ])
    expect(saved.candidates[0]).toMatchObject({
      candidate_uid: first.candidate_uid,
      start_cell: 'A2',
      end_cell: 'B3',
      candidate_type: 'text',
      review_status: 'approved'
    })
    expect(() => saveExcelCandidates(db, sourceDocumentUid, [{ ...first, sheet_name: '存在しない' }])).toThrowError(
      /存在しないシート/
    )
  })

  it('LLM入力は選択候補と周辺セルだけに限定し、未選択候補の提案を無視する', () => {
    const draft = storeExcelDraft(db, sourceDocumentUid, OUTPUT)
    const selected = draft.candidates[0]!
    const other = draft.candidates[1]!
    const messages = buildExcelCandidateLlmMessages(db, sourceDocumentUid, [selected.candidate_uid])
    const body = messages.map((message) => message.content).join('\n')
    expect(body).toContain('停止する')
    expect(body).not.toContain('送信対象外の秘密')

    const llmRun = registerEntity(db, { projectUid, entityType: 'llm_run_ref', createdBy: 'rule' })
    db.prepare(
      `INSERT INTO llm_run_ref (uid,process_name,status) VALUES (?,'excel-candidate-refinement','success')`
    ).run(llmRun.uid)

    const result = applyExcelLlmSuggestions(
      db,
      sourceDocumentUid,
      [selected.candidate_uid],
      JSON.stringify({
        candidates: [
          {
            candidate_uid: selected.candidate_uid,
            suggested_type: 'table',
            suggested_start_cell: 'A1',
            suggested_end_cell: 'B3',
            suggested_title: 'LLM要求一覧',
            reason: ['ヘッダーあり'],
            confidence: 0.95
          },
          {
            candidate_uid: other.candidate_uid,
            suggested_title: '未選択を書換'
          }
        ]
      }),
      llmRun.uid
    )
    expect(result.updatedCount).toBe(1)
    const updated = getExcelDraft(db, sourceDocumentUid)
    expect(updated.candidates[0]!.title).toBe('LLM要求一覧')
    expect(updated.candidates[0]!.review_status).toBe('review')
    expect(updated.candidates[1]!.title).toBe('件数式')
  })

  it('任意矩形だけをLLMへ送り、範囲内の複数候補だけを未確定で追加する', () => {
    storeExcelDraft(db, sourceDocumentUid, OUTPUT)
    const messages = buildExcelRangeLlmMessages(db, sourceDocumentUid, '要求', 'A1', 'B2')
    const body = messages.map((message) => message.content).join('\n')
    expect(body).toContain('停止する')
    expect(body).not.toContain('送信対象外の秘密')
    expect(body).not.toContain('LEN(B2)')

    const llmRun = registerEntity(db, { projectUid, entityType: 'llm_run_ref', createdBy: 'rule' })
    db.prepare("INSERT INTO llm_run_ref (uid,process_name,status) VALUES (?,'excel-range-grouping','success')").run(
      llmRun.uid
    )
    const result = applyExcelRangeLlmSuggestions(
      db,
      sourceDocumentUid,
      { sheetName: '要求', startCell: 'A1', endCell: 'B2' },
      JSON.stringify({
        candidates: [
          { start_cell: 'A1', end_cell: 'A1', candidate_type: 'text', title: '見出し', confidence: 0.9 },
          { start_cell: 'A3', end_cell: 'B3', candidate_type: 'table', title: '範囲外', confidence: 0.9 }
        ]
      }),
      llmRun.uid
    )
    expect(result.addedCount).toBe(1)
    expect(getExcelDraft(db, sourceDocumentUid).candidates.at(-1)).toMatchObject({
      title: '見出し',
      review_status: 'review',
      candidate_status: 'adjusted'
    })
  })

  it('同名Excel再取込の一意な一致へ候補UIDとレビュー設定を継承し差分を保持する', () => {
    const first = storeExcelDraft(db, sourceDocumentUid, OUTPUT)
    saveExcelCandidates(db, sourceDocumentUid, [
      {
        ...first.candidates[0]!,
        review_status: 'approved',
        table_header_row_start: 'A1',
        table_header_row_end: 'B1'
      }
    ])
    const source = join(dir, 'requirements.xlsx')
    writeFileSync(source, 'changed')
    const nextSourceUid = importSourceDocument(db, projectUid, root, source).sourceDocumentUid
    const next = storeExcelDraft(db, nextSourceUid, OUTPUT)
    expect(next.predecessor_source_document_uid).toBe(sourceDocumentUid)
    expect(next.candidates[0]!.candidate_uid).toBe(first.candidates[0]!.candidate_uid)
    expect(next.candidates[0]).toMatchObject({
      review_status: 'review',
      table_header_row_start: 'A1',
      table_header_row_end: 'B1'
    })
    expect(next.diff?.candidates.some((item) => item.status === 'unchanged')).toBe(true)
  })
  it('確定操作で採用候補だけを既存②抽出データへ同一変換する', () => {
    const draft = storeExcelDraft(db, sourceDocumentUid, OUTPUT)
    saveExcelCandidates(
      db,
      sourceDocumentUid,
      draft.candidates.map((candidate) => ({ ...candidate, review_status: 'approved' }))
    )
    const result = confirmExcelDraft(db, { projectUid, projectRoot: root, sourceDocumentUid })
    expect(result.elementCount).toBe(2)
    const items = db
      .prepare(`SELECT item_type FROM extracted_item WHERE extracted_document_uid=? ORDER BY rowid`)
      .all(result.extractedDocumentUid) as { item_type: string }[]
    expect(items.map((item) => item.item_type)).toEqual(['resource_table', 'resource_formula'])
    const locations = db
      .prepare(
        `SELECT sheet_name,cell_start,cell_end FROM source_location
          WHERE source_document_uid=? AND sheet_name IS NOT NULL ORDER BY cell_start`
      )
      .all(sourceDocumentUid)
    expect(locations).toEqual([
      { sheet_name: '要求', cell_start: 'A1', cell_end: 'B2' },
      { sheet_name: '要求', cell_start: 'A3', cell_end: 'A3' }
    ])
    const confirmed = getExcelDraft(db, sourceDocumentUid)
    expect(confirmed.status).toBe('confirmed')
    expect(confirmed.confirmed_extracted_document_uid).toBe(result.extractedDocumentUid)
    expect(() => confirmExcelDraft(db, { projectUid, projectRoot: root, sourceDocumentUid })).toThrowError(/確定済み/)
  })
})
