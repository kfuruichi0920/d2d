import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { deleteArtifactSetting, saveArtifactSetting, saveDevPhase } from '../project/project-settings'
import { importSourceDocument } from '../import/import-service'
import { storeExtractionResult, type ExtractionOutput } from '../extract/store-extraction'
import {
  createChunk,
  createIntermediateDocument,
  deleteChunk,
  editElementText,
  estimateTokens,
  getChunk,
  getChunkText,
  insertExtractedItems,
  reorderIntermediateItems,
  changeIntermediateHierarchy,
  updateIntermediateItemStatuses,
  updateChunk,
  listChunks,
  mergeElements,
  splitElement,
  type IntermediateStructure
} from './intermediate-service'

const EXTRACTION: ExtractionOutput = {
  metadata: { title: '元仕様書', extractor_name: 'test', extractor_version: '0' },
  elements: [
    { id: 'e1', type: 'heading', text: '1. 概要', level: 1, section_path: '' },
    { id: 'e2', type: 'paragraph', text: '応答は速いこと。', section_path: '1. 概要' },
    { id: 'e3', type: 'paragraph', text: '目安は100msである。', section_path: '1. 概要' },
    { id: 'e4', type: 'list_item', text: '対象A', level: 0, section_path: '1. 概要' }
  ]
}

describe('③中間データ（P7）', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string
  let extractedUid: string

  function structureOf(uid: string): IntermediateStructure {
    const row = db.prepare(`SELECT structure_json FROM intermediate_document WHERE uid = ?`).get(uid) as {
      structure_json: string
    }
    return JSON.parse(row.structure_json) as IntermediateStructure
  }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-mid-'))
    root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid

    const src = join(dir, 'spec.docx')
    writeFileSync(src, 'dummy')
    const imported = importSourceDocument(db, projectUid, root, src)
    mkdirSync(join(dir, 'work'), { recursive: true })
    const stored = storeExtractionResult(db, {
      projectUid,
      projectRoot: root,
      sourceDocumentUid: imported.sourceDocumentUid,
      extraction: EXTRACTION,
      workDir: join(dir, 'work')
    })
    extractedUid = stored.extractedDocumentUid
    // ②正本確定（統合の前提）
    db.prepare(`UPDATE entity_registry SET status = 'approved' WHERE uid = ?`).run(extractedUid)
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('承認済み②から③を統合生成し、sources・対応・根拠リンクを登録する（P7-1）', () => {
    const result = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    })
    expect(result.code).toMatch(/^IMDOC-\d{6}$/)
    expect(result.elementCount).toBe(4)

    const structure = structureOf(result.intermediateDocumentUid)
    expect(structure.sources).toEqual([{ extracted_document_uid: extractedUid, order: 1 }])
    expect(structure.metadata.artifact_type_id).toBe('design_doc')
    // ③要素は新しい ID（i1..）を持ち、②とリソースを共有する
    expect(structure.elements.map((e) => e.id)).toEqual(['i1', 'i2', 'i3', 'i4'])
    expect(structure.elements[0]!.resource_uid).toBeTruthy()

    const itemCount = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM intermediate_item WHERE intermediate_document_uid = ?`)
        .get(result.intermediateDocumentUid) as { n: number }
    ).n
    expect(itemCount).toBe(4)
    const itemLinkCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM trace_link t JOIN intermediate_item i ON i.uid=t.from_uid JOIN extracted_item x ON x.uid=t.to_uid WHERE i.intermediate_document_uid=? AND t.relation_type='based_on' AND t.basis_kind='extracted'`
        )
        .get(result.intermediateDocumentUid) as { n: number }
    ).n
    expect(itemLinkCount).toBe(4)

    // ③→② based_on（basis_kind=extracted）
    const link = db
      .prepare(`SELECT relation_type, basis_kind FROM trace_link WHERE from_uid = ? AND to_uid = ?`)
      .get(result.intermediateDocumentUid, extractedUid) as { relation_type: string; basis_kind: string }
    expect(link).toEqual({ relation_type: 'based_on', basis_kind: 'extracted' })
  })

  it('空の成果物へ②要素を統合し、階層・連続移動・レビュー状態を編集できる（P7-1/P7-7）', () => {
    const doc = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD',
      importItems: false
    })
    expect(doc.elementCount).toBe(0)
    const extracted = db.prepare(`SELECT structure_json FROM extracted_document WHERE uid=?`).get(extractedUid) as {
      structure_json: string
    }
    const source = JSON.parse(extracted.structure_json) as { elements: { resource_uid: string }[] }
    insertExtractedItems(
      db,
      projectUid,
      doc.intermediateDocumentUid,
      source.elements.slice(0, 3).map((e) => e.resource_uid),
      undefined,
      'below'
    )
    expect(structureOf(doc.intermediateDocumentUid).elements).toHaveLength(3)
    changeIntermediateHierarchy(db, doc.intermediateDocumentUid, ['i2'], 1)
    expect(structureOf(doc.intermediateDocumentUid).elements[1]!.level).toBe(1)
    reorderIntermediateItems(db, doc.intermediateDocumentUid, ['i2', 'i3'], 'up')
    expect(structureOf(doc.intermediateDocumentUid).elements.map((e) => e.id)).toEqual(['i2', 'i3', 'i1'])
    expect(() => reorderIntermediateItems(db, doc.intermediateDocumentUid, ['i2', 'i1'], 'down')).toThrow(/連続/)
    expect(updateIntermediateItemStatuses(db, doc.intermediateDocumentUid, ['i2'], 'needs_fix')).toBe(1)
    const status = db
      .prepare(
        `SELECT e.status FROM intermediate_item i JOIN entity_registry e ON e.uid=i.uid WHERE i.intermediate_document_uid=? AND i.resource_uid=?`
      )
      .get(doc.intermediateDocumentUid, source.elements[1]!.resource_uid) as { status: string }
    expect(status.status).toBe('review')
    expect(updateIntermediateItemStatuses(db, doc.intermediateDocumentUid, ['i2'], 'rejected')).toBe(1)
    expect(updateIntermediateItemStatuses(db, doc.intermediateDocumentUid, ['i2'], 'draft')).toBe(1)
    const resetStatus = db
      .prepare(
        `SELECT e.status FROM intermediate_item i JOIN entity_registry e ON e.uid=i.uid WHERE i.intermediate_document_uid=? AND i.resource_uid=?`
      )
      .get(doc.intermediateDocumentUid, source.elements[1]!.resource_uid) as { status: string }
    expect(resetStatus.status).toBe('draft')
    const legacy = db
      .prepare(`SELECT source_extracted_document_uid FROM intermediate_document WHERE uid=?`)
      .get(doc.intermediateDocumentUid) as { source_extracted_document_uid: string | null }
    expect(legacy.source_extracted_document_uid).toBeNull()
  })

  it('複数の②抽出文書を統合元として保持し、各アイテムのbased_onを登録する', () => {
    const src2 = join(dir, 'spec2.docx')
    writeFileSync(src2, 'dummy2')
    const imported2 = importSourceDocument(db, projectUid, root, src2)
    const work2 = join(dir, 'work2')
    mkdirSync(work2, { recursive: true })
    const stored2 = storeExtractionResult(db, {
      projectUid,
      projectRoot: root,
      sourceDocumentUid: imported2.sourceDocumentUid,
      extraction: { ...EXTRACTION, metadata: { ...EXTRACTION.metadata, title: '別仕様書' } },
      workDir: work2
    })
    db.prepare(`UPDATE entity_registry SET status='approved' WHERE uid=?`).run(stored2.extractedDocumentUid)
    const doc = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid, stored2.extractedDocumentUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD',
      importItems: false
    })
    expect(structureOf(doc.intermediateDocumentUid).sources).toHaveLength(2)
    const resource1 = (
      db
        .prepare(`SELECT resource_uid FROM extracted_item WHERE extracted_document_uid=? LIMIT 1`)
        .get(extractedUid) as { resource_uid: string }
    ).resource_uid
    const resource2 = (
      db
        .prepare(`SELECT resource_uid FROM extracted_item WHERE extracted_document_uid=? LIMIT 1`)
        .get(stored2.extractedDocumentUid) as { resource_uid: string }
    ).resource_uid
    insertExtractedItems(db, projectUid, doc.intermediateDocumentUid, [resource1, resource2], undefined, 'below')
    const links = db
      .prepare(
        `SELECT t.from_uid,t.to_uid FROM trace_link t JOIN intermediate_item i ON i.uid=t.from_uid WHERE i.intermediate_document_uid=? AND t.basis_kind='extracted'`
      )
      .all(doc.intermediateDocumentUid) as { from_uid: string; to_uid: string }[]
    expect(links).toHaveLength(2)
    expect(new Set(links.map((link) => link.from_uid)).size).toBe(2)
  })

  it('成果物設定の削除で関連する③中間データも物理削除する', () => {
    saveDevPhase(db, projectUid, { devPhaseId: 'DD', devPhaseName: '詳細設計' })
    const artifact = saveArtifactSetting(db, projectUid, {
      artifactName: '統合設計書',
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    })
    const doc = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    })
    expect(deleteArtifactSetting(db, projectUid, artifact.uid)).toEqual({ deletedDocuments: 1 })
    expect(
      db.prepare(`SELECT uid FROM intermediate_document WHERE uid=?`).get(doc.intermediateDocumentUid)
    ).toBeUndefined()
  })

  it('未承認の②は統合を拒否する（SRS §2.2 原則10）', () => {
    db.prepare(`UPDATE entity_registry SET status = 'draft' WHERE uid = ?`).run(extractedUid)
    expect(() =>
      createIntermediateDocument(db, projectUid, {
        extractedDocumentUids: [extractedUid],
        artifactTypeId: 'design_doc',
        devPhaseId: 'DD'
      })
    ).toThrowError(/統合できません/)
  })

  it('テキスト編集は新リソース ID を割当て、based_on で元 ID を追跡する（P7-2 / MID-005）', () => {
    const doc = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    })
    const before = structureOf(doc.intermediateDocumentUid)
    const oldResourceUid = before.elements[1]!.resource_uid!

    const edited = editElementText(db, projectUid, doc.intermediateDocumentUid, 'i2', '応答時間は100ms以内とすること。')
    expect(edited.newResourceUid).not.toBe(oldResourceUid)

    const after = structureOf(doc.intermediateDocumentUid)
    expect(after.elements[1]!.text).toBe('応答時間は100ms以内とすること。')
    expect(after.elements[1]!.resource_uid).toBe(edited.newResourceUid)

    // 由来リンク（新→旧、transform_note=edit）
    const link = db
      .prepare(`SELECT basis_kind, transform_note FROM trace_link WHERE from_uid = ? AND to_uid = ?`)
      .get(edited.newResourceUid, oldResourceUid) as { basis_kind: string; transform_note: string }
    expect(link).toEqual({ basis_kind: 'human_approved', transform_note: 'edit' })
    const itemBasis = db
      .prepare(
        `SELECT x.resource_uid FROM intermediate_item i JOIN trace_link t ON t.from_uid=i.uid AND t.relation_type='based_on' JOIN extracted_item x ON x.uid=t.to_uid WHERE i.intermediate_document_uid=? AND i.resource_uid=?`
      )
      .get(doc.intermediateDocumentUid, edited.newResourceUid) as { resource_uid: string }
    expect(itemBasis.resource_uid).toBe(oldResourceUid)

    // 旧リソース自体は②の正本として残る
    const oldText = db.prepare(`SELECT text_body FROM resource_text WHERE uid = ?`).get(oldResourceUid) as {
      text_body: string
    }
    expect(oldText.text_body).toBe('応答は速いこと。')
  })

  it('隣接要素のマージ: 1 要素へ統合し両元 ID を追跡する（EXT-014/015 相当）', () => {
    const doc = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    })
    const before = structureOf(doc.intermediateDocumentUid)
    const oldA = before.elements[1]!.resource_uid!
    const oldB = before.elements[2]!.resource_uid!

    const merged = mergeElements(db, projectUid, doc.intermediateDocumentUid, ['i2', 'i3'])
    const after = structureOf(doc.intermediateDocumentUid)
    expect(after.elements).toHaveLength(3)
    expect(after.elements[1]!.text).toBe('応答は速いこと。\n目安は100msである。')

    const links = db
      .prepare(`SELECT to_uid FROM trace_link WHERE from_uid = ? AND transform_note = 'merge' ORDER BY to_uid`)
      .all(merged.newResourceUid) as { to_uid: string }[]
    expect(links.map((l) => l.to_uid).sort()).toEqual([oldA, oldB].sort())

    // 非隣接はエラー
    expect(() => mergeElements(db, projectUid, doc.intermediateDocumentUid, ['i1', 'i4'])).toThrowError(/隣接/)
  })

  it('分割: 2 新リソースへ分割し双方から元 ID を追跡する', () => {
    const doc = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    })
    const oldUid = structureOf(doc.intermediateDocumentUid).elements[1]!.resource_uid!

    const split = splitElement(db, projectUid, doc.intermediateDocumentUid, 'i2', [
      '応答は速いこと。',
      '具体値は別途定める。'
    ])
    expect(split.newElementIds).toEqual(['i2a', 'i2b'])

    const after = structureOf(doc.intermediateDocumentUid)
    expect(after.elements).toHaveLength(5)
    expect(after.elements[1]!.text).toBe('応答は速いこと。')
    expect(after.elements[2]!.text).toBe('具体値は別途定める。')

    const links = db
      .prepare(`SELECT COUNT(*) AS n FROM trace_link WHERE to_uid = ? AND transform_note = 'split'`)
      .get(oldUid) as { n: number }
    expect(links.n).toBe(2)
  })

  it('チャンク: 作成・本文再生成・一覧・削除（P7-5 / MID-030〜034）', () => {
    const doc = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    })
    db.prepare(
      "UPDATE entity_registry SET status='approved' WHERE uid IN (SELECT uid FROM intermediate_item WHERE intermediate_document_uid=?)"
    ).run(doc.intermediateDocumentUid)
    const chunk = createChunk(
      db,
      projectUid,
      doc.intermediateDocumentUid,
      ['i1', 'i2', 'i4'],
      undefined,
      '安全性を重視すること'
    )
    expect(chunk.code).toMatch(/^CHUNK-\d{6}$/)
    expect(chunk.tokenCount).toBe(estimateTokens('1. 概要\n応答は速いこと。\n対象A'))

    // 本文は resource_* から再生成される（二重管理しない。§9.2）
    const text = getChunkText(db, chunk.chunkUid)
    expect(text).toBe('# 1. 概要\n応答は速いこと。\n- 対象A')

    expect(listChunks(db, doc.intermediateDocumentUid)).toHaveLength(1)
    expect((getChunk(db, chunk.chunkUid) as { additional_prompt: string }).additional_prompt).toBe(
      '安全性を重視すること'
    )
    const itemUids = (getChunk(db, chunk.chunkUid) as { items: { intermediate_item_uid: string }[] }).items.map(
      (item) => item.intermediate_item_uid
    )
    expect(
      (
        db
          .prepare("SELECT COUNT(*) AS count FROM trace_link WHERE from_uid=? AND relation_type='based_on'")
          .get(chunk.chunkUid) as { count: number }
      ).count
    ).toBe(3)
    updateChunk(db, projectUid, chunk.chunkUid, itemUids.slice(0, 2), '更新後プロンプト')
    expect((getChunk(db, chunk.chunkUid) as { items: unknown[]; additional_prompt: string }).items).toHaveLength(2)
    expect((getChunk(db, chunk.chunkUid) as { additional_prompt: string }).additional_prompt).toBe('更新後プロンプト')

    deleteChunk(db, chunk.chunkUid)
    expect(listChunks(db, doc.intermediateDocumentUid)).toHaveLength(0)
    expect(() => getChunkText(db, chunk.chunkUid)).toThrowError(/見つかりません/)
  })
})
