/**
 * 評価用サンプルプロジェクトのデータ投入（EVAL-001）。
 * 開いているプロジェクトへ「温度監視装置」の①原本（docx）→②抽出→③中間→チャンク→
 * ④正解設計モデル・関係（approved）を決定論的にシードする。
 * ④は評価①（LLM変換精度）の期待値、および評価②（影響分析精度）の分析対象グラフを兼ねる。
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { importSourceDocument } from '../import/import-service'
import { storeExtractionResult } from '../extract/store-extraction'
import { createChunk, createIntermediateDocument } from '../intermediate/intermediate-service'
import { createDesignElement, createTraceLink } from '../design/design-service'
import { setProjectSetting } from '../settings/settings-service'
import { buildDocx } from './sample-docx'
import {
  SAMPLE_DOC_TITLES,
  SAMPLE_ELEMENTS,
  SAMPLE_RELATIONS,
  SAMPLE_SECTIONS,
  buildDocumentOutline,
  type SampleSectionKey
} from './sample-design'

export interface SeedSampleResult {
  documentCount: number
  extractedCount: number
  intermediateDocumentUid: string
  chunkCount: number
  elementCount: number
  relationCount: number
  basedOnCount: number
}

/** チャンク↔セクション対応の保存先（評価①が参照。プロジェクト設定） */
export const SAMPLE_CHUNK_SETTING_KEY = 'eval.sampleChunkSections'
/** 要素キー↔UID 対応の保存先（評価②が参照） */
export const SAMPLE_ELEMENT_SETTING_KEY = 'eval.sampleElementUids'

export function seedSampleProject(db: Database, projectUid: string, rootPath: string): SeedSampleResult {
  // 原本 title は file_name（拡張子付き）で登録されるため .docx 付きで照合する
  const already = db
    .prepare(`SELECT COUNT(*) AS n FROM entity_registry WHERE project_uid = ? AND title = ? AND status <> 'deleted'`)
    .get(projectUid, `${SAMPLE_DOC_TITLES[0]}.docx`) as { n: number }
  if (already.n > 0) {
    throw new BackendError('conflict', '評価用サンプルデータは投入済みです', SAMPLE_DOC_TITLES[0])
  }

  // 1) ①原本: docx を生成して取込む
  const tempDir = join(rootPath, 'temp', 'sample-import')
  mkdirSync(tempDir, { recursive: true })
  const extractedDocUids: string[] = []
  for (const docIndex of [0, 1] as const) {
    const outline = buildDocumentOutline(docIndex)
    const docxPath = join(tempDir, `${outline.title}.docx`)
    writeFileSync(docxPath, buildDocx(outline.title, outline.blocks))
    const imported = importSourceDocument(db, projectUid, rootPath, docxPath)

    // 2) ②抽出: 構造 JSON を直接保存する（ワーカー不要の決定論的シード）
    const workDir = join(rootPath, 'blobs', 'extracted', `sample-doc${docIndex}`)
    mkdirSync(workDir, { recursive: true })
    const elements = outline.blocks.map((block, index) => ({
      id: `d${docIndex}-e${index + 1}`,
      type: (block.heading ? 'heading' : 'paragraph') as 'heading' | 'paragraph',
      text: block.heading ?? block.text ?? '',
      section_path: block.section ?? '',
      ...(block.heading ? { level: 2 } : {})
    }))
    const stored = storeExtractionResult(db, {
      projectUid,
      projectRoot: rootPath,
      sourceDocumentUid: imported.sourceDocumentUid,
      extraction: {
        metadata: { title: outline.title, extractor_name: 'd2d-sample-seed', extractor_version: '1.0' },
        elements
      },
      workDir
    })
    db.prepare(`UPDATE entity_registry SET status = 'approved' WHERE uid = ?`).run(stored.extractedDocumentUid)
    extractedDocUids.push(stored.extractedDocumentUid)
  }
  rmSync(tempDir, { recursive: true, force: true })

  // 3) ③中間データ: 両文書を統合する
  const intermediate = createIntermediateDocument(db, projectUid, {
    extractedDocumentUids: extractedDocUids,
    artifactTypeId: 'design_doc',
    devPhaseId: 'DD',
    title: '温度監視装置 統合設計書'
  })
  db.prepare(`UPDATE entity_registry SET status = 'approved' WHERE uid = ?`).run(intermediate.intermediateDocumentUid)

  // 4) チャンク: セクション単位に③要素をまとめる（評価①の LLM 入力単位）
  const structure = JSON.parse(
    (
      db
        .prepare(`SELECT structure_json FROM intermediate_document WHERE uid = ?`)
        .get(intermediate.intermediateDocumentUid) as { structure_json: string }
    ).structure_json
  ) as { elements: { id: string; text?: string; section_path?: string }[] }
  const chunkSections: Record<string, SampleSectionKey> = {}
  for (const section of SAMPLE_SECTIONS) {
    const ids = structure.elements
      .filter((element) => element.section_path === section.key)
      .map((element) => element.id)
    if (ids.length === 0) {
      throw new BackendError('internal', `セクションの③要素が見つかりません: ${section.key}`, '')
    }
    const chunk = createChunk(db, projectUid, intermediate.intermediateDocumentUid, ids)
    chunkSections[chunk.chunkUid] = section.key
  }

  // 5) ④正解設計モデル（approved）と関係・根拠リンク
  const uidByKey = new Map<string, string>()
  for (const element of SAMPLE_ELEMENTS) {
    const created = createDesignElement(db, projectUid, {
      modelType: element.modelType,
      title: element.title,
      summary: element.summary,
      createdBy: 'user'
    })
    db.prepare(`UPDATE entity_registry SET status = 'approved' WHERE uid = ?`).run(created.uid)
    uidByKey.set(element.key, created.uid)
  }
  let relationCount = 0
  for (const relation of SAMPLE_RELATIONS) {
    createTraceLink(db, projectUid, {
      fromUid: uidByKey.get(relation.from)!,
      toUid: uidByKey.get(relation.to)!,
      relationType: relation.relation,
      createdBy: 'human',
      reviewStatus: 'approved',
      attributes: {
        ...(relation.allocationKind ? { allocationKind: relation.allocationKind } : {}),
        ...(relation.usageKind ? { usageKind: relation.usageKind } : {})
      }
    })
    relationCount++
  }
  // 根拠リンク: 各設計モデル → 所属セクションのチャンク（based_on、basis_kind=human_approved）
  const chunkBySection = new Map<SampleSectionKey, string>(
    Object.entries(chunkSections).map(([chunkUid, section]) => [section, chunkUid])
  )
  let basedOnCount = 0
  for (const element of SAMPLE_ELEMENTS) {
    const chunkUid = chunkBySection.get(element.section)
    if (!chunkUid) continue
    createTraceLink(db, projectUid, {
      fromUid: uidByKey.get(element.key)!,
      toUid: chunkUid,
      relationType: 'based_on',
      createdBy: 'human',
      reviewStatus: 'approved',
      attributes: { basisKind: 'human_approved' }
    })
    basedOnCount++
  }

  // 6) 評価が参照する対応表をプロジェクト設定へ保存する
  setProjectSetting(rootPath, SAMPLE_CHUNK_SETTING_KEY, chunkSections)
  setProjectSetting(rootPath, SAMPLE_ELEMENT_SETTING_KEY, Object.fromEntries(uidByKey))

  return {
    documentCount: 2,
    extractedCount: extractedDocUids.length,
    intermediateDocumentUid: intermediate.intermediateDocumentUid,
    chunkCount: Object.keys(chunkSections).length,
    elementCount: uidByKey.size,
    relationCount,
    basedOnCount
  }
}
