import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow, openDatabase } from '../store/database'
import { getSchemaVersion, LATEST_SCHEMA_VERSION } from '../db/migrations'
import { createProjectLayout } from '../project/layout'

import { importSourceDocument, listSourceDocuments } from '../import/import-service'
import { storeExtractionResult } from '../extract/store-extraction'
import { createIntermediateDocument } from '../intermediate/intermediate-service'
import {
  analyzeStateMachine,
  createStateMachine,
  getStateMachine,
  simulateStateMachine,
  updateStateMachine
} from './state-machine-service'
import {
  addSynonym,
  addTerm,
  detectVariants,
  extractTermCandidates,
  listTerms,
  normalizeTerm,
  setTermStatus
} from './glossary-service'
import { editIntermediateTable, getTableCells } from './table-service'

describe('P10 編集機能', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-edit-'))
    root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('schema 2.0.0: 新規 DB は最新版の表セル・アーカイブ列・セマンティック表・LLM生ログ列を持つ', () => {
    expect(LATEST_SCHEMA_VERSION).toBe('2.0.0')
    expect(getSchemaVersion(db)).toBe('2.0.0')
    const table = db
      .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'resource_table_cell'`)
      .get()
    expect(table).toBeTruthy()
    const columns = db.prepare(`PRAGMA table_info(entity_registry)`).all() as { name: string }[]
    expect(columns.some((column) => column.name === 'is_archived')).toBe(true)
    expect(columns.some((column) => column.name === 'administrative_notes')).toBe(true)
    const textColumns = db.prepare('PRAGMA table_info(resource_text)').all() as { name: string }[]
    expect(textColumns.some((column) => column.name === 'target_resource_uid')).toBe(true)
    const figureColumns = db.prepare('PRAGMA table_info(resource_figure)').all() as { name: string }[]
    expect(figureColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(['byte_size', 'image_format', 'figure_number', 'caption', 'description'])
    )
    const tableColumns = db.prepare('PRAGMA table_info(resource_table)').all() as { name: string }[]
    expect(tableColumns.some((column) => column.name === 'description')).toBe(true)
    const codeColumns = db.prepare('PRAGMA table_info(resource_code)').all() as { name: string }[]
    expect(codeColumns.some((column) => column.name === 'description')).toBe(true)
    const formulaColumns = db.prepare('PRAGMA table_info(resource_formula)').all() as { name: string }[]
    expect(formulaColumns.some((column) => column.name === 'description')).toBe(true)
  })

  it('schema 1.x の既存 DB は変更せず、schema 2.0.0 での再作成を要求する', () => {
    const path = join(dir, 'old.db')
    const legacy = createDatabase(path, { projectName: 'old' })
    legacy.prepare(`UPDATE project SET schema_version = '1.10.0'`).run()
    closeDatabase(legacy)

    expect(() => openDatabase(path)).toThrowError(/再作成/)
  })
  it('原本一覧はアーカイブを既定で除外し、指定時は復元対象として返す（UI-047）', () => {
    const sourcePath = join(dir, 'archive-target.docx')
    writeFileSync(sourcePath, 'archive')
    const imported = importSourceDocument(db, projectUid, root, sourcePath)
    db.prepare(`UPDATE entity_registry SET is_archived = 1 WHERE uid = ?`).run(imported.sourceDocumentUid)

    expect(listSourceDocuments(db, projectUid)).toHaveLength(0)
    const archived = listSourceDocuments(db, projectUid, { includeArchived: true })
    expect(archived).toHaveLength(1)
    expect(archived[0]!.is_archived).toBe(1)
  })

  describe('状態遷移（P10-4）', () => {
    it('作成・更新・取得ができ、STATE 分類で採番される（EDIT-030〜032）', () => {
      const created = createStateMachine(db, projectUid, '電源状態')
      expect(created.code).toBe('STATE-000001')

      updateStateMachine(db, created.uid, {
        states: ['停止', '起動中', '運転'],
        events: ['start', 'ready', 'stop'],
        transitions: [
          { from: '停止', to: '起動中', event: 'start' },
          { from: '起動中', to: '運転', event: 'ready' },
          { from: '運転', to: '停止', event: 'stop', condition: '安全確認済み' }
        ],
        initialState: '停止',
        finalStates: []
      })
      const machine = getStateMachine(db, created.uid)
      expect(machine.states).toHaveLength(3)
      expect(machine.transitions[2]!.condition).toBe('安全確認済み')

      // 初期状態が一覧に無い更新は拒否
      expect(() =>
        updateStateMachine(db, created.uid, {
          states: ['A'],
          events: [],
          transitions: [],
          initialState: 'X',
          finalStates: []
        })
      ).toThrowError(/初期状態/)
    })

    it('検出: 未到達状態・未定義遷移・競合遷移・行き止まり（EDIT-035）', () => {
      const problems = analyzeStateMachine({
        states: ['A', 'B', '孤島'],
        events: ['go'],
        transitions: [
          { from: 'A', to: 'B', event: 'go' },
          { from: 'A', to: 'B', event: 'go' }, // 競合
          { from: 'B', to: 'Z', event: 'go' } // 未定義状態 Z
        ],
        initial_state: 'A',
        final_states: []
      })
      const kinds = problems.map((p) => p.kind)
      expect(kinds).toContain('unreachable_state') // 孤島
      expect(kinds).toContain('undefined_state') // Z
      expect(kinds).toContain('conflicting_transition') // A --go--> ×2
      expect(kinds).toContain('dead_end') // 孤島（出遷移なし・非終了）
    })

    it('簡易シミュレーション: イベント列を初期状態から適用する（EDIT-034）', () => {
      const machine = {
        transitions: [
          { from: '停止', to: '運転', event: 'start' },
          { from: '運転', to: '停止', event: 'stop' }
        ],
        initial_state: '停止'
      }
      const result = simulateStateMachine(machine, ['start', 'stop', 'unknown'])
      expect(result.steps[0]).toMatchObject({ from: '停止', to: '運転', matched: true })
      expect(result.steps[2]).toMatchObject({ event: 'unknown', matched: false })
      expect(result.finalState).toBe('停止')
    })
  })

  describe('用語集（P10-6）', () => {
    it('用語・同義語の登録と承認、正規化重複の拒否（EDIT-050）', () => {
      const term = addTerm(db, projectUid, { term: 'トレーサビリティ', definition: '追跡可能性' })
      expect(term.code).toMatch(/^GLOSS-\d{6}$/)
      addSynonym(db, projectUid, term.uid, 'トレサビ', 'abbreviation')

      // 正規化表記が同じ用語（長音差分）は conflict
      expect(() => addTerm(db, projectUid, { term: 'トレーサビリテイ'.replace('テイ', 'ティー') })).toThrowError(
        /既に存在/
      )

      setTermStatus(db, term.uid, 'approved')
      const approved = listTerms(db, projectUid, { approvedOnly: true })
      expect(approved).toHaveLength(1)
      expect(approved[0]!.synonyms[0]!.synonym_text).toBe('トレサビ')
    })

    it('normalizeTerm が長音・中点・大小文字・全半角を吸収する', () => {
      expect(normalizeTerm('インターフェース')).toBe(normalizeTerm('インタフェース').replace('た', 'た')) // 参考: 完全一致ではない
      expect(normalizeTerm('Ｄａｔａ－Ｂａｓｅ')).toBe('database')
      expect(normalizeTerm('サーバー')).toBe(normalizeTerm('サーバ'))
    })

    it('候補抽出: カタカナ語・略語を抽出し、登録済みは除外する（EDIT-051）', () => {
      const existing = new Set([normalizeTerm('レスポンス')])
      const candidates = extractTermCandidates('システムのレスポンスは REST API 経由で TCP を用いて返す。', existing)
      expect(candidates).toContain('システム')
      expect(candidates).toContain('API')
      expect(candidates).toContain('TCP')
      expect(candidates).not.toContain('レスポンス')
    })

    it('揺れ検出: 別用語間で正規化表記が衝突する場合に検出する（EDIT-052）', () => {
      const a = addTerm(db, projectUid, { term: 'サーバ' })
      const b = addTerm(db, projectUid, { term: 'ホスト' })
      addSynonym(db, projectUid, b.uid, 'サーバー', 'variant') // a と正規化一致

      const variants = detectVariants(db, projectUid)
      expect(variants).toHaveLength(1)
      expect(variants[0]!.variants.map((v) => v.uid).sort()).toEqual([a.uid, b.uid].sort())
    })
  })

  describe('表編集（P10-2）', () => {
    it('③の表要素をセルID付きで編集し、由来を追跡する（EDIT-022/024）', () => {
      // ③中間文書（表 1 件）を用意
      const src = join(dir, 's.docx')
      writeFileSync(src, 'x')
      const imported = importSourceDocument(db, projectUid, root, src)
      mkdirSync(join(dir, 'work'), { recursive: true })
      const stored = storeExtractionResult(db, {
        projectUid,
        projectRoot: root,
        sourceDocumentUid: imported.sourceDocumentUid,
        extraction: {
          metadata: { title: 't' },
          elements: [
            {
              id: 'e1',
              type: 'table',
              rows: [[{ text: '項目' }, { text: '値' }]],
              row_count: 1,
              column_count: 2,
              section_path: ''
            }
          ]
        },
        workDir: join(dir, 'work')
      })
      db.prepare(`UPDATE entity_registry SET status = 'approved' WHERE uid = ?`).run(stored.extractedDocumentUid)
      const doc = createIntermediateDocument(db, projectUid, {
        extractedDocumentUids: [stored.extractedDocumentUid],
        artifactTypeId: 'design_doc',
        devPhaseId: 'DD'
      })

      const edited = editIntermediateTable(db, projectUid, doc.intermediateDocumentUid, 'i1', [
        ['項目', '値', '備考'],
        ['応答時間', '100ms', '必須']
      ])
      expect(edited.cellCount).toBe(6)

      // セル ID 付きで取得できる（EDIT-024）
      const cells = getTableCells(db, edited.newResourceUid)
      expect(cells.rows).toHaveLength(2)
      expect(cells.rows[0]![2]!.cell_text).toBe('備考')
      expect(cells.rows[1]![0]!.uid).toMatch(/^[0-9a-f-]{36}$/)
      expect(cells.rows[0]![0]!.is_header).toBe(1)

      // 由来リンク（新→旧、transform_note=edit-table）
      const link = db
        .prepare(`SELECT transform_note FROM trace_link WHERE from_uid = ? AND relation_type = 'based_on'`)
        .get(edited.newResourceUid) as { transform_note: string }
      expect(link.transform_note).toBe('edit-table')
    })
  })
})
