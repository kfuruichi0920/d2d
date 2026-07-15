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
  addIntermediateElement,
  createChunk,
  createIntermediateDocument,
  deleteChunk,
  duplicateIntermediateElement,
  editElementText,
  editIntermediateElement,
  ensureIntermediateItemTraceLinks,
  estimateTokens,
  getChunk,
  getChunkText,
  insertExtractedItems,
  unlinkExtractedItems,
  reorderIntermediateItems,
  reorderChunks,
  changeIntermediateHierarchy,
  updateIntermediateItemStatuses,
  updateChunk,
  updateIntermediateSources,
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
    const sourceItems = db
      .prepare(`SELECT uid, resource_uid FROM extracted_item WHERE extracted_document_uid=? ORDER BY rowid LIMIT 3`)
      .all(extractedUid) as { uid: string; resource_uid: string }[]
    insertExtractedItems(
      db,
      projectUid,
      doc.intermediateDocumentUid,
      sourceItems.map((item) => item.uid),
      undefined,
      'below'
    )
    const source = { elements: sourceItems }
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
    const item1 = (
      db.prepare(`SELECT uid FROM extracted_item WHERE extracted_document_uid=? LIMIT 1`).get(extractedUid) as {
        uid: string
      }
    ).uid
    const item2 = (
      db
        .prepare(`SELECT uid FROM extracted_item WHERE extracted_document_uid=? LIMIT 1`)
        .get(stored2.extractedDocumentUid) as { uid: string }
    ).uid
    insertExtractedItems(db, projectUid, doc.intermediateDocumentUid, [item1, item2], undefined, 'below')
    const links = db
      .prepare(
        `SELECT t.from_uid,t.to_uid FROM trace_link t JOIN intermediate_item i ON i.uid=t.from_uid WHERE i.intermediate_document_uid=? AND t.basis_kind='extracted'`
      )
      .all(doc.intermediateDocumentUid) as { from_uid: string; to_uid: string }[]
    expect(links).toHaveLength(2)
    expect(new Set(links.map((link) => link.from_uid)).size).toBe(2)

    // 1つの統合元を別の成果物要素へ再利用でき、統合元単位で全based_onを解除できる。
    insertExtractedItems(db, projectUid, doc.intermediateDocumentUid, [item1], 'i1', 'below')
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS count FROM trace_link WHERE to_uid=? AND relation_type='based_on'`)
          .get(item1) as { count: number }
      ).count
    ).toBe(2)
    expect(unlinkExtractedItems(db, doc.intermediateDocumentUid, [item1])).toEqual({ unlinked: 2 })
    expect(ensureIntermediateItemTraceLinks(db, projectUid, doc.intermediateDocumentUid)).toBe(0)
    expect(
      (
        db
          .prepare(`SELECT COUNT(*) AS count FROM trace_link WHERE to_uid=? AND relation_type='based_on'`)
          .get(item1) as { count: number }
      ).count
    ).toBe(0)
    expect(structureOf(doc.intermediateDocumentUid).elements).toHaveLength(3)
  })

  it('Explorer取込で既存成果物の統合元と文書based_onを同期する', () => {
    const src2 = join(dir, 'source-update.docx')
    writeFileSync(src2, 'source-update')
    const imported2 = importSourceDocument(db, projectUid, root, src2)
    const work2 = join(dir, 'source-update-work')
    mkdirSync(work2, { recursive: true })
    const stored2 = storeExtractionResult(db, {
      projectUid,
      projectRoot: root,
      sourceDocumentUid: imported2.sourceDocumentUid,
      extraction: { ...EXTRACTION, metadata: { ...EXTRACTION.metadata, title: '追加仕様書' } },
      workDir: work2
    })
    db.prepare(`UPDATE entity_registry SET status='approved' WHERE uid=?`).run(stored2.extractedDocumentUid)
    const doc = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD',
      importItems: false
    })

    expect(
      updateIntermediateSources(db, projectUid, doc.intermediateDocumentUid, [
        extractedUid,
        stored2.extractedDocumentUid
      ])
    ).toEqual({ sourceCount: 2 })
    expect(structureOf(doc.intermediateDocumentUid).sources.map((source) => source.extracted_document_uid)).toEqual([
      extractedUid,
      stored2.extractedDocumentUid
    ])
    expect(
      db
        .prepare(
          `SELECT t.to_uid FROM trace_link t JOIN extracted_document x ON x.uid=t.to_uid
            WHERE t.from_uid=? AND t.relation_type='based_on' ORDER BY t.to_uid`
        )
        .all(doc.intermediateDocumentUid)
    ).toHaveLength(2)

    expect(
      updateIntermediateSources(db, projectUid, doc.intermediateDocumentUid, [stored2.extractedDocumentUid])
    ).toEqual({ sourceCount: 1 })
    expect(structureOf(doc.intermediateDocumentUid).sources[0]!.extracted_document_uid).toBe(
      stored2.extractedDocumentUid
    )
    const links = db
      .prepare(
        `SELECT t.to_uid FROM trace_link t JOIN extracted_document x ON x.uid=t.to_uid
          WHERE t.from_uid=? AND t.relation_type='based_on'`
      )
      .all(doc.intermediateDocumentUid) as { to_uid: string }[]
    expect(links).toEqual([{ to_uid: stored2.extractedDocumentUid }])
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

  it('単独編集で任意位置追加・複製・種別変更を非破壊で行う（P7-2 / MID-004/005）', () => {
    const doc = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    })
    const added = addIntermediateElement(db, projectUid, doc.intermediateDocumentUid, {
      targetElementId: 'i2',
      position: 'below',
      type: 'paragraph',
      text: '人手で追加した中間要素'
    })
    let structure = structureOf(doc.intermediateDocumentUid)
    expect(structure.elements.map((element) => element.id)).toEqual(['i1', 'i2', added.elementId, 'i3', 'i4'])
    expect(structure.elements[2]).toMatchObject({ type: 'paragraph', text: '人手で追加した中間要素' })

    const duplicated = duplicateIntermediateElement(db, projectUid, doc.intermediateDocumentUid, 'i2')
    structure = structureOf(doc.intermediateDocumentUid)
    const source = structure.elements.find((element) => element.id === 'i2')!
    const copy = structure.elements.find((element) => element.id === duplicated.elementId)!
    expect(copy.text).toBe(source.text)
    expect(copy.resource_uid).not.toBe(source.resource_uid)
    expect(
      db
        .prepare(`SELECT transform_note FROM trace_link WHERE from_uid=? AND to_uid=?`)
        .get(copy.resource_uid, source.resource_uid)
    ).toEqual({ transform_note: 'duplicate' })

    const beforeEditResource = copy.resource_uid!
    const edited = editIntermediateElement(db, projectUid, doc.intermediateDocumentUid, duplicated.elementId, {
      type: 'heading',
      text: '複製後に見出しへ変更'
    })
    structure = structureOf(doc.intermediateDocumentUid)
    expect(structure.elements.find((element) => element.id === duplicated.elementId)).toMatchObject({
      type: 'heading',
      text: '複製後に見出しへ変更',
      resource_uid: edited.resourceUid
    })
    expect(
      db
        .prepare(`SELECT transform_note FROM trace_link WHERE from_uid=? AND to_uid=?`)
        .get(edited.resourceUid, beforeEditResource)
    ).toEqual({ transform_note: 'edit' })
    expect(
      db
        .prepare(`SELECT item_type FROM intermediate_item WHERE intermediate_document_uid=? AND resource_uid=?`)
        .get(doc.intermediateDocumentUid, edited.resourceUid)
    ).toEqual({ item_type: 'resource_label' })
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

  it('非連続の複数要素を表示順先頭へマージし、全Resource・②由来を追跡する（MID-005）', () => {
    const doc = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [extractedUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    })
    const before = structureOf(doc.intermediateDocumentUid)
    const oldA = before.elements[1]!.resource_uid!
    const oldB = before.elements[3]!.resource_uid!

    const merged = mergeElements(db, projectUid, doc.intermediateDocumentUid, ['i4', 'i2'])
    const after = structureOf(doc.intermediateDocumentUid)
    expect(after.elements).toHaveLength(3)
    expect(after.elements[1]).toMatchObject({
      id: merged.newElementId,
      text: '応答は速いこと。\n対象A',
      section_path: '1. 概要'
    })
    expect(after.elements[2]!.id).toBe('i3')

    const links = db
      .prepare(`SELECT to_uid FROM trace_link WHERE from_uid = ? AND transform_note = 'merge' ORDER BY to_uid`)
      .all(merged.newResourceUid) as { to_uid: string }[]
    expect(links.map((link) => link.to_uid).sort()).toEqual([oldA, oldB].sort())
    const itemOrigins = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM intermediate_item i JOIN trace_link t ON t.from_uid=i.uid JOIN extracted_item x ON x.uid=t.to_uid WHERE i.intermediate_document_uid=? AND i.resource_uid=?`
        )
        .get(doc.intermediateDocumentUid, merged.newResourceUid) as { count: number }
    ).count
    expect(itemOrigins).toBe(2)
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

    const chunk2 = createChunk(db, projectUid, doc.intermediateDocumentUid, ['i4'])
    expect((listChunks(db, doc.intermediateDocumentUid) as { uid: string }[]).map((row) => row.uid)).toEqual([
      chunk.chunkUid,
      chunk2.chunkUid
    ])
    reorderChunks(db, doc.intermediateDocumentUid, [chunk2.chunkUid, chunk.chunkUid])
    expect((listChunks(db, doc.intermediateDocumentUid) as { uid: string }[]).map((row) => row.uid)).toEqual([
      chunk2.chunkUid,
      chunk.chunkUid
    ])

    deleteChunk(db, chunk.chunkUid)
    deleteChunk(db, chunk2.chunkUid)
    expect(listChunks(db, doc.intermediateDocumentUid)).toHaveLength(0)
    expect(() => getChunkText(db, chunk.chunkUid)).toThrowError(/見つかりません/)
  })
})
