import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { importSourceDocument, listSourceDocuments, fileTypeOf } from '../import/import-service'
import { storeExtractionResult, type ExtractionOutput } from './store-extraction'
import { generateMarkdown } from './markdown-gen'
import { renameExtractedDocument } from './review-service'

const SAMPLE_EXTRACTION: ExtractionOutput = {
  metadata: { title: 'テスト仕様書', extractor_name: 'd2d-word-extractor', extractor_version: '0.1.0' },
  elements: [
    { id: 'e1', type: 'heading', text: '1. 概要', level: 1, section_path: '' },
    { id: 'e2', type: 'paragraph', text: '本書はテスト用である。', section_path: '1. 概要' },
    { id: 'e3', type: 'list_item', text: '項目A', level: 0, section_path: '1. 概要' },
    {
      id: 'e4',
      type: 'table',
      rows: [[{ text: '項目' }, { text: '値' }], [{ text: '結合', colspan: 2 }]],
      row_count: 2,
      column_count: 2,
      section_path: '1. 概要'
    },
    {
      id: 'e5',
      type: 'figure',
      image: 'media/image1.png',
      width: 640,
      height: 480,
      image_format: 'PNG',
      section_path: '1. 概要'
    },
    { id: 'e6', type: 'caption', text: '図1 構成図', section_path: '1. 概要' }
  ]
}

describe('取込〜②抽出保存（P4-1 / P5-2）', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string
  let workDir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-ext-'))
    root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid
    workDir = join(dir, 'work')
    mkdirSync(join(workDir, 'media'), { recursive: true })
    writeFileSync(join(workDir, 'media', 'image1.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  function importDoc(): string {
    const src = join(dir, 'spec.docx')
    writeFileSync(src, 'dummy-docx')
    return importSourceDocument(db, projectUid, root, src).sourceDocumentUid
  }

  it('原本取込: ハッシュ・file_type・blob・batch を登録する（IMP-008/009）', () => {
    const src = join(dir, 'spec.docx')
    writeFileSync(src, 'dummy-docx')
    const result = importSourceDocument(db, projectUid, root, src)

    expect(result.fileType).toBe('word')
    expect(result.fileHash).toMatch(/^[0-9a-f]{64}$/)
    expect(result.code).toBe('DOC-000001')

    const list = listSourceDocuments(db, projectUid)
    expect(list).toHaveLength(1)
    expect(list[0]!.is_current).toBe(1)
    expect(list[0]!.has_extracted_data).toBe(0)

    const batch = db.prepare(`SELECT batch_type, status FROM batch_operation_info`).get() as {
      batch_type: string
      status: string
    }
    expect(batch).toEqual({ batch_type: 'import', status: 'success' })
  })

  it('抽出文書は原本と同じ名称で作成し、表示名称だけを後から変更できる（EXT-040）', () => {
    const sourceUid = importDoc()
    const stored = storeExtractionResult(db, {
      projectUid,
      projectRoot: root,
      sourceDocumentUid: sourceUid,
      extraction: SAMPLE_EXTRACTION,
      workDir
    })
    const initial = db.prepare(`SELECT title FROM entity_registry WHERE uid = ?`).get(stored.extractedDocumentUid) as {
      title: string
    }
    expect(initial.title).toBe('spec.docx')

    expect(renameExtractedDocument(db, projectUid, stored.extractedDocumentUid, '任意の抽出名称')).toEqual({
      title: '任意の抽出名称'
    })
    const renamed = db.prepare(`SELECT title FROM entity_registry WHERE uid = ?`).get(stored.extractedDocumentUid) as {
      title: string
    }
    expect(renamed.title).toBe('任意の抽出名称')
    expect(listSourceDocuments(db, projectUid)[0]!.file_name).toBe('spec.docx')
    expect(listSourceDocuments(db, projectUid)[0]!.has_extracted_data).toBe(1)
  })
  it('旧バイナリ形式（.doc）は拒否する（SRS §3.1）', () => {
    const src = join(dir, 'old.doc')
    writeFileSync(src, 'x')
    expect(() => importSourceDocument(db, projectUid, root, src)).toThrowError(/旧バイナリ形式/)
  })

  it('fileTypeOf が拡張子を SRS 対象形式へ分類する', () => {
    expect(fileTypeOf('a.docx')).toBe('word')
    expect(fileTypeOf('a.pdf')).toBe('pdf')
    expect(fileTypeOf('a.yaml')).toBe('other')
    expect(fileTypeOf('a.tsv')).toBe('csv')
  })

  it('抽出結果を候補（draft）として保存し、リソース・位置・対応・根拠リンクを登録する', () => {
    const sourceUid = importDoc()
    const stored = storeExtractionResult(db, {
      projectUid,
      projectRoot: root,
      sourceDocumentUid: sourceUid,
      extraction: SAMPLE_EXTRACTION,
      workDir
    })

    expect(stored.elementCount).toBe(6)
    expect(stored.figureCount).toBe(1)

    // extracted_item は要素数ぶん登録され、item_type が正しい
    const items = db
      .prepare(`SELECT item_type FROM extracted_item WHERE extracted_document_uid = ? ORDER BY rowid`)
      .all(stored.extractedDocumentUid) as { item_type: string }[]
    expect(items.map((i) => i.item_type)).toEqual([
      'resource_label',
      'resource_text',
      'resource_list',
      'resource_table',
      'resource_figure',
      'resource_label'
    ])

    // 全リソースは候補（draft）で登録される（SRS §2.2 原則 9〜10）
    const statuses = db
      .prepare(
        `SELECT DISTINCT e.status FROM extracted_item i JOIN entity_registry e ON e.uid = i.resource_uid
          WHERE i.extracted_document_uid = ?`
      )
      .all(stored.extractedDocumentUid) as { status: string }[]
    expect(statuses).toEqual([{ status: 'draft' }])

    // 図は blobs/extracted へコピーされ blob_resource が指す
    const figure = db
      .prepare(
        `SELECT f.image_uri,f.image_hash,f.figure_number,f.caption,f.width,f.height,f.byte_size,f.image_format
           FROM resource_figure f JOIN extracted_item i ON i.resource_uid = f.uid
          WHERE i.extracted_document_uid = ?`
      )
      .get(stored.extractedDocumentUid) as {
      image_uri: string
      image_hash: string
      figure_number: string
      caption: string
      width: number
      height: number
      byte_size: number
      image_format: string
    }
    expect(figure).toMatchObject({
      width: 640,
      height: 480,
      byte_size: 4,
      image_format: 'PNG'
    })
    expect(figure.image_uri).toMatch(/^blobs\/extracted\/.+\.png$/)
    expect(figure.image_hash).toMatch(/^[0-9a-f]{64}$/)

    // 根拠リンク（②→① based_on / basis_kind=extracted）
    const link = db
      .prepare(`SELECT relation_type, basis_kind, to_uid FROM trace_link WHERE from_uid = ?`)
      .get(stored.extractedDocumentUid) as { relation_type: string; basis_kind: string; to_uid: string }
    expect(link).toEqual({ relation_type: 'based_on', basis_kind: 'extracted', to_uid: sourceUid })

    // source_location に章節パスが入る
    const loc = db
      .prepare(
        `SELECT l.section_path FROM source_location l JOIN extracted_item i ON i.source_location_uid = l.uid
          WHERE i.item_type = 'resource_text'`
      )
      .get() as { section_path: string }
    expect(loc.section_path).toBe('1. 概要')
  })
})

describe('派生 Markdown 生成（P5-5、EXT-018/019）', () => {
  it('review は要素アンカー付き、clean はアンカーなしで生成する', () => {
    const review = generateMarkdown(SAMPLE_EXTRACTION.elements, 'review')
    const clean = generateMarkdown(SAMPLE_EXTRACTION.elements, 'clean')

    expect(review).toContain('# 1. 概要 <!-- e1 -->')
    expect(review).toContain('- 項目A <!-- e3 -->')
    expect(review).toContain('| 項目 | 値 |')
    expect(review).toContain('![図](media/image1.png)')

    expect(clean).toContain('# 1. 概要')
    expect(clean).not.toContain('<!--')
    expect(clean).toContain('（図: media/image1.png）')
  })

  it('結合セルは空セルで桁揃えする', () => {
    const md = generateMarkdown(SAMPLE_EXTRACTION.elements, 'clean')
    expect(md).toContain('| 結合 |  |')
  })
})
