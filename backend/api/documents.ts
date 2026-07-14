/**
 * 原本・抽出データ API（P4/P5）。取込・抽出はジョブとして実行する（CORE-020）。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import { requireProject } from '../project/project-service'
import { getSourceDocument, listSourceDocuments } from '../import/import-service'
import { generateMarkdown, type MarkdownVariant } from '../extract/markdown-gen'
import { eventBus } from '../events/event-bus'
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'
import { updateExtractedItemStatuses } from '../extract/review-service'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', String(params))
  }
  return params as Record<string, unknown>
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new BackendError('validation', `${key} は必須の文字列です`, '')
  }
  return value
}

function requireStringArray(params: Record<string, unknown>, key: string): string[] {
  const value = params[key]
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new BackendError('validation', `${key} は文字列配列で指定してください`, '')
  }
  return value as string[]
}
export function registerDocumentApi(router: ApiRouter, jobs: JobManager): void {
  // ---- ①原本（P4） ----

  router.register('document.import', (params) => {
    const p = asRecord(params)
    requireProject()
    return jobs.enqueue('import.source', { filePath: requireString(p, 'filePath') })
  })

  router.register('document.list', () => {
    const { db, info } = requireProject()
    return listSourceDocuments(db, info.projectUid)
  })

  router.register('document.get', (params) => {
    const { db } = requireProject()
    return getSourceDocument(db, requireString(asRecord(params), 'uid'))
  })

  /** 原本から②抽出ジョブを開始（現状 Word のみ。他形式は P5 後続） */
  router.register('document.extract', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const doc = getSourceDocument(db, requireString(p, 'uid'))
    if (doc.file_type !== 'word') {
      throw new BackendError(
        'validation',
        `${doc.file_type} 形式の抽出は未実装です（P5 後続で対応）`,
        '現在は Word (.docx) のみ抽出できます'
      )
    }
    return jobs.enqueue('extract.word', { sourceDocumentUid: doc.uid })
  })

  // ---- ②抽出データ（P5） ----

  router.register('extracted.list', () => {
    const { db, info } = requireProject()
    return db
      .prepare(
        `SELECT e.uid, e.code, e.title, e.status, x.extraction_status, x.extractor_name, x.extractor_version,
                x.extracted_at, x.source_document_uid,
                (SELECT COUNT(*) FROM extracted_item i WHERE i.extracted_document_uid = x.uid) AS item_count
           FROM extracted_document x
           JOIN entity_registry e ON e.uid = x.uid
          WHERE e.project_uid = ? AND e.status <> 'deleted'
          ORDER BY x.extracted_at DESC`
      )
      .all(info.projectUid)
  })

  /** 抽出文書の要素一覧（レビュー用。UI-011 / EXT-020） */
  router.register('extracted.get', (params) => {
    const p = asRecord(params)
    const uid = requireString(p, 'uid')
    const { db } = requireProject()
    const doc = db
      .prepare(
        `SELECT e.uid, e.code, e.title, e.status, x.structure_json, x.extractor_name, x.extractor_version, x.source_document_uid
           FROM extracted_document x JOIN entity_registry e ON e.uid = x.uid WHERE x.uid = ?`
      )
      .get(uid) as { structure_json: string } | undefined
    if (!doc) {
      throw new BackendError('not_found', `抽出文書が見つかりません: ${uid}`, '')
    }
    const structure = JSON.parse(doc.structure_json) as {
      metadata: Record<string, unknown>
      elements: { resource_uid?: string }[]
    }
    // 要素ごとのレビュー状態（entity_registry.status）を合成する
    const statusByUid = new Map<string, { status: string; code: string }>(
      (
        db
          .prepare(
            `SELECT r.resource_uid AS uid, e.status, e.code
               FROM extracted_item r JOIN entity_registry e ON e.uid = r.resource_uid
              WHERE r.extracted_document_uid = ?`
          )
          .all(uid) as { uid: string; status: string; code: string }[]
      ).map((row) => [row.uid, { status: row.status, code: row.code }])
    )
    return {
      ...doc,
      structure_json: undefined,
      structure,
      metadata: structure.metadata,
      elements: structure.elements.map((e) => ({
        ...e,
        review: e.resource_uid ? statusByUid.get(e.resource_uid) : undefined
      }))
    }
  })

  /** 派生 Markdown の再生成（EXT-018/019。正本を置き換えない） */
  router.register('extracted.getMarkdown', (params) => {
    const p = asRecord(params)
    const uid = requireString(p, 'uid')
    const variant = (p.variant === 'clean' ? 'clean' : 'review') as MarkdownVariant
    const { db } = requireProject()
    const doc = db.prepare(`SELECT structure_json FROM extracted_document WHERE uid = ?`).get(uid) as
      { structure_json: string } | undefined
    if (!doc) {
      throw new BackendError('not_found', `抽出文書が見つかりません: ${uid}`, '')
    }
    const structure = JSON.parse(doc.structure_json) as { elements: never[] }
    return { markdown: generateMarkdown(structure.elements, variant), variant }
  })

  /** 抽出要素へのレビュー状態付与（単一／複数共通、EXT-021/022/024） */
  router.register('extracted.updateItemStatus', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const result = updateExtractedItemStatuses(
      db,
      requireString(p, 'extractedDocumentUid'),
      [requireString(p, 'resourceUid')],
      requireString(p, 'status')
    )
    return { updated: result.updatedCount === 1 }
  })

  router.register('extracted.updateItemStatuses', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    return updateExtractedItemStatuses(
      db,
      requireString(p, 'extractedDocumentUid'),
      requireStringArray(p, 'resourceUids'),
      requireString(p, 'status')
    )
  })

  /** resource_figure の正規化済み画像をプレビュー用 data URL で返す（EXT-020/023）。 */
  router.register('extracted.getFigurePreview', (params) => {
    const resourceUid = requireString(asRecord(params), 'resourceUid')
    const { db, paths } = requireProject()
    const row = db.prepare(`SELECT image_uri FROM resource_figure WHERE uid = ?`).get(resourceUid) as
      { image_uri: string } | undefined
    if (!row) throw new BackendError('not_found', `図要素が見つかりません: ${resourceUid}`, '')
    const root = resolve(paths.root)
    const filePath = resolve(root, row.image_uri)
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
      throw new BackendError('validation', 'プロジェクト外の画像は表示できません', row.image_uri)
    }
    if (!existsSync(filePath)) throw new BackendError('io', '図ファイルが見つかりません', row.image_uri)
    const mime =
      extname(filePath).toLowerCase() === '.svg'
        ? 'image/svg+xml'
        : extname(filePath).toLowerCase() === '.jpg' || extname(filePath).toLowerCase() === '.jpeg'
          ? 'image/jpeg'
          : extname(filePath).toLowerCase() === '.gif'
            ? 'image/gif'
            : 'image/png'
    return { dataUrl: `data:${mime};base64,${readFileSync(filePath).toString('base64')}` }
  })

  /** 抽出結果の採用確定 → ②正本化（棄却済み以外を approved に。EXT-024 / §8.2） */
  router.register('extracted.approve', (params) => {
    const p = asRecord(params)
    const uid = requireString(p, 'uid')
    const { db } = requireProject()
    const ts = new Date().toISOString()
    const txn = db.transaction(() => {
      const doc = db
        .prepare(`UPDATE entity_registry SET status = 'approved', updated_by = 'user', updated_at = ? WHERE uid = ?`)
        .run(ts, uid)
      if (doc.changes === 0) {
        throw new BackendError('not_found', `抽出文書が見つかりません: ${uid}`, '')
      }
      const items = db
        .prepare(
          `UPDATE entity_registry SET status = 'approved', updated_by = 'user', updated_at = ?
            WHERE status <> 'rejected'
              AND uid IN (SELECT resource_uid FROM extracted_item WHERE extracted_document_uid = ?)`
        )
        .run(ts, uid)
      // 根拠リンクも確定
      db.prepare(
        `UPDATE trace_link SET review_status = 'approved', updated_at = ? WHERE from_uid = ? AND relation_type = 'based_on'`
      ).run(ts, uid)
      return items.changes
    })
    const approvedCount = txn()
    eventBus.emit('extraction.completed', { extractedDocumentUid: uid, approvedCount })
    return { approved: true, approvedCount }
  })
}
