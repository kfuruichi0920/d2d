import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { registerEntity } from '../store/entity-registry'
import { importSourceDocument } from '../import/import-service'
import { storeExtractionResult } from '../extract/store-extraction'
import { createIntermediateDocument } from '../intermediate/intermediate-service'
import { buildReportMarkdown, generateReport, getReportContent, listReports } from './report-service'

describe('P13 レポート出力', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-report-'))
    root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'レポート検証' })
    projectUid = getProjectRow(db).uid
    seed()
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  /** ①→②→③→④ の最小データ一式を投入する */
  function seed(): void {
    // ①②③
    const src = join(dir, 's.docx')
    writeFileSync(src, 'x')
    const imported = importSourceDocument(db, projectUid, root, src)
    mkdirSync(join(dir, 'work'), { recursive: true })
    const stored = storeExtractionResult(db, {
      projectUid,
      projectRoot: root,
      sourceDocumentUid: imported.sourceDocumentUid,
      extraction: {
        metadata: { title: '性能仕様', extractor_name: 'd2d-word', extractor_version: '1.0' },
        elements: [
          { id: 'e1', type: 'heading', text: '性能要件', level: 1, section_path: '1' },
          { id: 'e2', type: 'paragraph', text: '応答時間は100ms以内とする。', section_path: '1' },
          {
            id: 'e3',
            type: 'table',
            rows: [
              [{ text: '項目' }, { text: '値' }],
              [{ text: '応答時間' }, { text: '100ms' }]
            ],
            row_count: 2,
            column_count: 2,
            section_path: '1'
          },
          { id: 'e4', type: 'paragraph', text: '付録の説明文。', section_path: '2' }
        ]
      },
      workDir: join(dir, 'work')
    })
    db.prepare(`UPDATE entity_registry SET status = 'approved' WHERE uid = ?`).run(stored.extractedDocumentUid)
    createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [stored.extractedDocumentUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    })

    // ④ REQ + FUNC + satisfies 関係
    const req = registerEntity(db, {
      projectUid,
      entityType: 'resource_text',
      designCategory: 'REQ',
      title: '応答時間要求',
      createdBy: 'user'
    })
    db.prepare(
      `INSERT INTO resource_text (uid, text_body, text_role, language) VALUES (?, ?, 'description', 'ja')`
    ).run(req.uid, '応答は100ms以内であること。')
    const func = registerEntity(db, {
      projectUid,
      entityType: 'resource_text',
      designCategory: 'FUNC',
      title: '応答処理機能',
      createdBy: 'user'
    })
    db.prepare(
      `INSERT INTO resource_text (uid, text_body, text_role, language) VALUES (?, ?, 'description', 'ja')`
    ).run(func.uid, '要求を処理して応答する。')
    const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'human' })
    db.prepare(
      `INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, created_by, review_status, basis_kind)
       VALUES (?, ?, ?, 'satisfies', 'human', 'approved', 'human_approved')`
    ).run(link.uid, func.uid, req.uid)
  }

  it('②③④から文書風レポートを構築する（EXP-001/002）', () => {
    const { markdown, stats } = buildReportMarkdown(db, projectUid, { format: 'markdown' })
    // ② 原本由来情報（ファイル名・ハッシュ・抽出器）
    expect(markdown).toContain('s.docx')
    expect(markdown).toContain('d2d-word')
    // ③ 章構成・本文・表
    expect(markdown).toContain('#### 性能要件')
    expect(markdown).toContain('応答時間は100ms以内とする。')
    expect(markdown).toContain('| 応答時間 | 100ms |')
    // ④ 要素・関係
    expect(markdown).toContain('REQ-000001 応答時間要求')
    expect(markdown).toContain('| satisfies | FUNC-000001 | REQ-000001 |')
    expect(stats).toMatchObject({ sourceDocuments: 1, intermediateDocuments: 1, designElements: 2, relations: 1 })
  })

  it('フィルタ: 設計観点・章節・情報種別で出力対象を絞れる（EXP-003）', () => {
    // 設計観点 REQ のみ → FUNC は要素節に出ない
    const reqOnly = buildReportMarkdown(db, projectUid, {
      format: 'markdown',
      filters: { categories: ['REQ'] }
    }).markdown
    expect(reqOnly).toContain('REQ-000001')
    expect(reqOnly).not.toContain('#### FUNC-000001')

    // 章 1 のみ → 章 2 の段落が消える
    const section1 = buildReportMarkdown(db, projectUid, {
      format: 'markdown',
      filters: { sectionPath: '1' }
    }).markdown
    expect(section1).toContain('応答時間は100ms以内とする。')
    expect(section1).not.toContain('付録の説明文。')

    // 情報種別 table のみ → 段落が消え表は残る
    const tableOnly = buildReportMarkdown(db, projectUid, {
      format: 'markdown',
      filters: { infoTypes: ['table'] }
    }).markdown
    expect(tableOnly).toContain('| 応答時間 | 100ms |')
    expect(tableOnly).not.toContain('応答時間は100ms以内とする。')

    // 要素コード指定 → その要素に関係する関係のみ
    const byCode = buildReportMarkdown(db, projectUid, {
      format: 'markdown',
      filters: { elementCodes: ['REQ-000001'] }
    })
    expect(byCode.stats.designElements).toBe(1)
    expect(byCode.stats.relations).toBe(1) // REQ が to 側の satisfies
  })

  it('表示/非表示の選択（EXP-004）: セクションを個別に抑止できる', () => {
    const { markdown } = buildReportMarkdown(db, projectUid, {
      format: 'markdown',
      sections: { sources: false, intermediate: false, design: true, relations: false }
    })
    expect(markdown).not.toContain('## ① 原本')
    expect(markdown).not.toContain('## ③ 中間データ')
    expect(markdown).toContain('## ④ 設計モデル')
    expect(markdown).not.toContain('## 関係一覧')
  })

  it('Markdown / HTML 出力 + 一覧・本文取得（EXP-005/006）', () => {
    const mdResult = generateReport(db, projectUid, root, { format: 'markdown' })
    expect(mdResult.fileName).toMatch(/\.md$/)
    const htmlResult = generateReport(db, projectUid, root, { format: 'html', title: '性能レポート' })
    expect(htmlResult.fileName).toMatch(/\.html$/)

    const files = listReports(root)
    expect(files.map((f) => f.fileName)).toEqual(expect.arrayContaining([mdResult.fileName, htmlResult.fileName]))

    const html = getReportContent(root, htmlResult.fileName)
    expect(html.format).toBe('html')
    expect(html.content).toContain('<!DOCTYPE html>')
    expect(html.content).toContain('<title>性能レポート</title>')
    expect(html.content).toContain('<table>') // ③ の表が HTML 化される
    expect(html.content).not.toContain('src="http') // 自己完結（外部参照なし）

    // パストラバーサル防止（basename 化）
    expect(() => getReportContent(root, '../../project.db')).toThrowError(/見つかりません/)
  })

  it('LLM 要約テキストは冒頭へ引用ブロックとして挿入される（任意機能）', () => {
    const { markdown } = buildReportMarkdown(db, projectUid, {
      format: 'markdown',
      summaryText: '本書は性能要件を定義する。\n応答時間の上限を規定する。'
    })
    expect(markdown).toContain('> **LLM 要約（候補・未確定）**')
    expect(markdown).toContain('> 応答時間の上限を規定する。')
    // 要約はレポート本文より前に置かれる
    expect(markdown.indexOf('LLM 要約')).toBeLessThan(markdown.indexOf('## ① 原本'))
  })
})
