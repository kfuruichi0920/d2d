/**
 * PDF抽出領域候補ドラフトのテスト（P5-20A、IMP-005/EXT-027〜029）。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { importSourceDocument } from '../import/import-service'
import {
  applyPdfRegionReanalysis,
  getPdfDraft,
  savePdfRegions,
  storePdfDraft,
  textInRegion,
  type PdfPhysicalOutput
} from './pdf-draft-service'

const OUTPUT: PdfPhysicalOutput = {
  metadata: { extractor_name: 'd2d-pdf-extractor', extractor_version: '0.1.0', page_count: 1 },
  document: {
    file_name: 'spec.pdf',
    pages: [
      {
        page_index: 0,
        page_number: 1,
        width: 612,
        height: 792,
        rotation: 0,
        image_file: 'blobs/extracted/job-1/pages/page-0001.png',
        image_width: 1224,
        image_height: 1584,
        image_scale: 2,
        blocks: [
          {
            block_id: 'p1-b1',
            bbox: [72, 80, 300, 96],
            text: '1. System Configuration',
            lines: [
              {
                text: '1. System Configuration',
                bbox: [72, 80, 300, 96],
                size: 16,
                fontname: 'Helvetica-Bold',
                bold: true,
                italic: false,
                color: '#000000'
              }
            ]
          },
          {
            block_id: 'p1-b2',
            bbox: [72, 120, 500, 160],
            text: 'This system consists of a controller.\nIt polls the sensor.',
            lines: [
              {
                text: 'This system consists of a controller.',
                bbox: [72, 120, 500, 132],
                size: 10,
                fontname: 'Helvetica',
                bold: false,
                italic: false,
                color: '#000000'
              },
              {
                text: 'It polls the sensor.',
                bbox: [72, 145, 320, 157],
                size: 10,
                fontname: 'Helvetica',
                bold: false,
                italic: false,
                color: '#000000'
              }
            ]
          }
        ],
        images: [{ image_id: 'p1-i1', bbox: [200, 500, 400, 650] }],
        rules: { lines: [], rects: [], curve_count: 0, truncated: false },
        links: [],
        word_count: 10,
        truncated: false
      }
    ]
  },
  candidates: [
    {
      candidate_key: 'p1-r1',
      page_index: 0,
      bbox: [72, 80, 300, 96],
      region_type: 'heading',
      title: '1. System Configuration',
      text_preview: '1. System Configuration',
      detection_methods: ['font-size'],
      confidence: 0.85,
      reading_order: 1,
      block_ids: ['p1-b1'],
      level: 1,
      review_status: 'approved',
      candidate_status: 'detected'
    },
    {
      candidate_key: 'p1-r2',
      page_index: 0,
      bbox: [200, 500, 400, 650],
      region_type: 'figure',
      title: '図候補',
      detection_methods: ['embedded-image'],
      confidence: 0.85,
      reading_order: 2,
      review_status: 'approved',
      candidate_status: 'detected'
    },
    {
      candidate_key: 'p1-r3',
      page_index: 0,
      bbox: [220, 655, 380, 668],
      region_type: 'caption',
      title: 'Figure 1 Overview',
      text_preview: 'Figure 1 Overview',
      detection_methods: ['caption-keyword'],
      confidence: 0.8,
      reading_order: 3,
      caption_of_key: 'p1-r2',
      review_status: 'approved',
      candidate_status: 'detected'
    },
    {
      candidate_key: 'p1-r4',
      page_index: 0,
      bbox: [72, 760, 140, 770],
      region_type: 'header',
      title: 'D2D SPEC',
      text_preview: 'D2D SPEC',
      detection_methods: ['recurring-position'],
      confidence: 0.9,
      reading_order: 4,
      review_status: 'rejected',
      candidate_status: 'detected'
    }
  ],
  review_hints: { warnings: [] }
}

describe('PDF抽出領域候補（P5-20A、IMP-005/EXT-027〜029）', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string
  let sourceDocumentUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-pdf-'))
    root = join(dir, 'project')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'PDF test' })
    projectUid = getProjectRow(db).uid
    const source = join(dir, 'spec.pdf')
    writeFileSync(source, 'dummy')
    sourceDocumentUid = importSourceDocument(db, projectUid, root, source).sourceDocumentUid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('物理抽出と領域候補を②正本と分離して保存し、UID採番とキャプション参照差替を行う', () => {
    const draft = storePdfDraft(db, sourceDocumentUid, OUTPUT)
    expect(draft.status).toBe('generated')
    expect(draft.regions).toHaveLength(4)
    const figure = draft.regions.find((region) => region.region_type === 'figure')!
    const caption = draft.regions.find((region) => region.region_type === 'caption')!
    expect(figure.region_uid).toMatch(/^[0-9a-f-]{36}$/)
    expect(caption.caption_of).toBe(figure.region_uid)
    const header = draft.regions.find((region) => region.region_type === 'header')!
    expect(header.review_status).toBe('rejected')
    expect(
      db.prepare(`SELECT COUNT(*) AS count FROM extracted_document WHERE source_document_uid=?`).get(sourceDocumentUid)
    ).toEqual({ count: 0 })
  })

  it('領域の移動・種別変更・採否を保存し、プレビューを物理情報から再計算する', () => {
    const draft = storePdfDraft(db, sourceDocumentUid, OUTPUT)
    const heading = draft.regions.find((region) => region.region_type === 'heading')!
    const saved = savePdfRegions(db, sourceDocumentUid, [
      { ...heading, bbox: [70, 75, 520, 165], region_type: 'text', candidate_status: 'adjusted' }
    ])
    expect(saved.regions).toHaveLength(1)
    const region = saved.regions[0]!
    expect(region.region_uid).toBe(heading.region_uid)
    expect(region.region_type).toBe('text')
    expect(region.text_preview).toContain('System Configuration')
    expect(region.text_preview).toContain('polls the sensor')
    expect(getPdfDraft(db, sourceDocumentUid).status).toBe('editing')
  })

  it('ページ範囲外の bbox はクランプし、不正な領域・ページを拒否する', () => {
    const draft = storePdfDraft(db, sourceDocumentUid, OUTPUT)
    const heading = draft.regions.find((region) => region.region_type === 'heading')!
    const saved = savePdfRegions(db, sourceDocumentUid, [{ ...heading, bbox: [-50, -10, 9000, 400] }])
    expect(saved.regions[0]!.bbox).toEqual([0, 0, 612, 400])
    expect(() => savePdfRegions(db, sourceDocumentUid, [{ ...heading, page_index: 9 }])).toThrowError(
      /存在しないページ/
    )
    expect(() => savePdfRegions(db, sourceDocumentUid, [{ ...heading, region_type: 'chart' }])).toThrowError(
      /未対応の領域種別/
    )
    expect(() => savePdfRegions(db, sourceDocumentUid, [{ ...heading, bbox: [10, 10, 10.5, 10.5] }])).toThrowError(
      /1pt以上/
    )
  })

  it('部分再解析の結果（表・テキスト）を該当領域だけへ反映する', () => {
    const draft = storePdfDraft(db, sourceDocumentUid, OUTPUT)
    const figure = draft.regions.find((region) => region.region_type === 'figure')!
    const applied = applyPdfRegionReanalysis(db, sourceDocumentUid, figure.region_uid, {
      table: {
        rows: [
          ['ID', 'Name'],
          ['C-1', 'Controller']
        ],
        header_row_count: 1,
        detection_method: 'ruled-lines'
      }
    })
    const updated = applied.regions.find((region) => region.region_uid === figure.region_uid)!
    expect(updated.table_data?.row_count).toBe(2)
    expect(updated.table_data?.column_count).toBe(2)
    expect(updated.candidate_status).toBe('adjusted')
    expect(updated.text_preview).toContain('ID | Name')
    const other = applied.regions.find((region) => region.region_type === 'heading')!
    expect(other.candidate_status).toBe('detected')
  })

  it('textInRegion は領域へ半分以上含まれる行だけを読み順で連結する', () => {
    const draft = storePdfDraft(db, sourceDocumentUid, OUTPUT)
    const text = textInRegion(draft.physical, {
      ...draft.regions[0]!,
      bbox: [70, 115, 510, 140]
    })
    expect(text).toBe('This system consists of a controller.')
  })

  it('PDF以外の原本と未生成ドラフトを拒否する', () => {
    const wordPath = join(dir, 'doc.docx')
    writeFileSync(wordPath, 'dummy')
    const wordUid = importSourceDocument(db, projectUid, root, wordPath).sourceDocumentUid
    expect(() => storePdfDraft(db, wordUid, OUTPUT)).toThrowError(/PDF原本ではありません/)
    expect(() => getPdfDraft(db, wordUid)).toThrowError(/PDF抽出領域候補がありません/)
  })
})
