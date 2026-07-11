/**
 * ②抽出データの保存（P5-2/P5-3、DATA-001/008、EXT-013）。
 * ワーカー出力（structure_json 相当）を、extracted_document + extracted_item +
 * resource_* + source_location へ同一トランザクションで登録する。
 *
 * 登録直後は entity_registry.status='draft'（候補）。抽出レビューで採用確定した時点で
 * approved（②正本確定）となる（SRS §2.2 原則 9〜10、sdd_function_architecture §8.2）。
 */
import type { Database } from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { BackendError } from '../api/errors'
import { registerEntity } from '../store/entity-registry'
import { sha256OfFile, mimeTypeOf } from '../store/blob-store'
import { statSync } from 'node:fs'

export interface ExtractionElement {
  id: string
  type: 'heading' | 'paragraph' | 'list_item' | 'table' | 'figure' | 'caption'
  text?: string
  level?: number
  style?: string | null
  section_path?: string
  rows?: { text: string; colspan?: number; v_merge?: string }[][]
  row_count?: number
  column_count?: number
  image?: string
  caption?: string | null
}

export interface ExtractionOutput {
  metadata: Record<string, unknown> & { extractor_name?: string; extractor_version?: string }
  elements: ExtractionElement[]
}

export interface StoreExtractionInput {
  projectUid: string
  projectRoot: string
  sourceDocumentUid: string
  extraction: ExtractionOutput
  /** ワーカー作業ディレクトリ（画像等の相対参照の基点） */
  workDir: string
  batchOperationUid?: string
}

export interface StoreExtractionResult {
  extractedDocumentUid: string
  code: string
  elementCount: number
  figureCount: number
}

/** element.type → item_type（resource_* テーブル名） */
function itemTypeOf(element: ExtractionElement): string {
  switch (element.type) {
    case 'heading':
    case 'caption':
      return 'resource_label'
    case 'list_item':
      return 'resource_list'
    case 'table':
      return 'resource_table'
    case 'figure':
      return 'resource_figure'
    default:
      return 'resource_text'
  }
}

export function storeExtractionResult(db: Database, input: StoreExtractionInput): StoreExtractionResult {
  const { projectUid, sourceDocumentUid, extraction } = input
  if (!Array.isArray(extraction.elements)) {
    throw new BackendError('validation', '抽出結果に elements がありません', '')
  }

  const txn = db.transaction((): StoreExtractionResult => {
    const meta = extraction.metadata ?? {}
    const doc = registerEntity(db, {
      projectUid,
      entityType: 'extracted_document',
      title: String(meta.title ?? meta.source_file ?? '抽出文書'),
      createdBy: 'rule',
      batchOperationUid: input.batchOperationUid
    })
    // extracted_item の FK 先となる extracted_document 行を先に作成する
    // （structure_json は要素↔リソース対応の確定後に更新する）
    db.prepare(
      `INSERT INTO extracted_document (uid, source_document_uid, extraction_status, extractor_name, extractor_version, structure_json)
       VALUES (?, ?, 'running', ?, ?, '{}')`
    ).run(
      doc.uid,
      sourceDocumentUid,
      String(extraction.metadata?.extractor_name ?? 'unknown'),
      String(extraction.metadata?.extractor_version ?? '0')
    )

    // structure_json には原本構造と要素↔リソース対応を保持する（sdd_data_structure §2.7）
    const resourceUidByElementId = new Map<string, string>()
    let figureCount = 0

    for (const element of extraction.elements) {
      const itemType = itemTypeOf(element)

      // 1) resource_* 登録
      const resource = registerEntity(db, {
        projectUid,
        entityType: itemType as never,
        title: (element.text ?? element.caption ?? element.image ?? '').slice(0, 80) || null || undefined,
        createdBy: 'rule',
        batchOperationUid: input.batchOperationUid
      })
      resourceUidByElementId.set(element.id, resource.uid)

      switch (itemType) {
        case 'resource_label':
          db.prepare(
            `INSERT INTO resource_label (uid, label_text, label_kind, level, style_name) VALUES (?, ?, ?, ?, ?)`
          ).run(
            resource.uid,
            element.text ?? '',
            element.type === 'heading'
              ? element.level === 1
                ? 'chapter'
                : 'section'
              : element.type === 'caption'
                ? 'table'
                : 'other',
            element.level ?? null,
            element.style ?? null
          )
          break
        case 'resource_text':
          db.prepare(`INSERT INTO resource_text (uid, text_body, text_role, language) VALUES (?, ?, 'body', 'ja')`).run(
            resource.uid,
            element.text ?? ''
          )
          break
        case 'resource_list':
          db.prepare(
            `INSERT INTO resource_list (uid, list_kind, item_count, items_json, max_level) VALUES (?, 'unordered', 1, ?, ?)`
          ).run(
            resource.uid,
            JSON.stringify([{ text: element.text ?? '', level: element.level ?? 0 }]),
            element.level ?? 0
          )
          break
        case 'resource_table':
          db.prepare(`INSERT INTO resource_table (uid, row_count, column_count, cells_json) VALUES (?, ?, ?, ?)`).run(
            resource.uid,
            element.row_count ?? 0,
            element.column_count ?? 0,
            JSON.stringify(element.rows ?? [])
          )
          break
        case 'resource_figure': {
          // 画像を blobs/extracted/（抽出中間物）へ正規コピーし blob_resource 登録
          const imageRel = element.image ?? ''
          const srcPath = join(input.workDir, imageRel)
          let imageUri = imageRel
          if (imageRel && existsSync(srcPath)) {
            const blobEntity = registerEntity(db, {
              projectUid,
              entityType: 'blob_resource',
              title: imageRel,
              createdBy: 'rule'
            })
            const relativePath = `blobs/extracted/${blobEntity.uid}${imageRel.slice(imageRel.lastIndexOf('.'))}`
            const destPath = join(input.projectRoot, relativePath)
            mkdirSync(join(destPath, '..'), { recursive: true })
            copyFileSync(srcPath, destPath)
            db.prepare(
              `INSERT INTO blob_resource (uid, relative_path, mime_type, byte_size, sha256) VALUES (?, ?, ?, ?, ?)`
            ).run(blobEntity.uid, relativePath, mimeTypeOf(imageRel), statSync(destPath).size, sha256OfFile(destPath))
            imageUri = relativePath
          }
          db.prepare(`INSERT INTO resource_figure (uid, image_uri, figure_kind) VALUES (?, ?, 'other')`).run(
            resource.uid,
            imageUri
          )
          figureCount++
          break
        }
      }

      // 2) source_location（原本内位置。Word は章節パスと段落連番で表現）
      const location = registerEntity(db, {
        projectUid,
        entityType: 'source_location',
        createdBy: 'rule'
      })
      db.prepare(`INSERT INTO source_location (uid, source_document_uid, section_path, note) VALUES (?, ?, ?, ?)`).run(
        location.uid,
        sourceDocumentUid,
        element.section_path ?? '',
        `element:${element.id}`
      )

      // 3) extracted_item（文書構成 JSON 内要素とリソースの対応。トレース端点にはしない）
      const item = registerEntity(db, {
        projectUid,
        entityType: 'extracted_item',
        createdBy: 'rule'
      })
      db.prepare(
        `INSERT INTO extracted_item (uid, extracted_document_uid, source_document_uid, source_location_uid, item_type, resource_uid)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(item.uid, doc.uid, sourceDocumentUid, location.uid, itemType, resource.uid)
    }

    // 4) structure_json を確定（要素→リソース UID 対応を含めて保持）し、抽出完了へ
    const structureJson = JSON.stringify({
      metadata: extraction.metadata,
      elements: extraction.elements.map((e) => ({ ...e, resource_uid: resourceUidByElementId.get(e.id) }))
    })
    db.prepare(`UPDATE extracted_document SET structure_json = ?, extraction_status = 'success' WHERE uid = ?`).run(
      structureJson,
      doc.uid
    )

    // 5) 根拠関係: ②抽出文書 → ①原本（based_on、basis_kind=extracted。sdd §5.1）
    const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'rule' })
    db.prepare(
      `INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, basis_kind, created_by, review_status)
       VALUES (?, ?, ?, 'based_on', 'extracted', 'rule', 'draft')`
    ).run(link.uid, doc.uid, sourceDocumentUid)

    return { extractedDocumentUid: doc.uid, code: doc.code, elementCount: extraction.elements.length, figureCount }
  })

  return txn()
}
