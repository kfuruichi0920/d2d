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
import {
  renameExtractedDocument,
  syncExtractedDocumentStatus,
  updateExtractedItemStatuses
} from '../extract/review-service'
import { callMain } from '../main-bridge'

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

  router.register('document.list', (params) => {
    const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    const { db, info } = requireProject()
    return listSourceDocuments(db, info.projectUid, { includeArchived: p.includeArchived === true })
  })

  router.register('document.get', (params) => {
    const { db } = requireProject()
    return getSourceDocument(db, requireString(asRecord(params), 'uid'))
  })
  router.register('document.openExternal', async (params) => {
    const { db, paths } = requireProject()
    const doc = getSourceDocument(db, requireString(asRecord(params), 'uid'))
    if (!doc.blob_relative_path) throw new BackendError('not_found', '原本ファイルが見つかりません', doc.uid)
    const root = resolve(paths.root)
    const filePath = resolve(root, doc.blob_relative_path)
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`))
      throw new BackendError('validation', 'プロジェクト外のファイルは開けません', doc.blob_relative_path)
    if (!existsSync(filePath)) throw new BackendError('io', '原本ファイルが見つかりません', doc.blob_relative_path)
    const error = await callMain<string>('shell.openPath', { path: filePath })
    if (error) throw new BackendError('io', 'OSアプリで原本を開けませんでした', error)
    return { opened: true }
  })

  router.register('document.setArchived', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const result = db
      .prepare(
        `UPDATE entity_registry SET is_archived=?, updated_by='user', updated_at=? WHERE uid=? AND project_uid=? AND entity_type='source_document' AND status <> 'deleted'`
      )
      .run(p.archived === true ? 1 : 0, new Date().toISOString(), requireString(p, 'uid'), info.projectUid)
    if (result.changes !== 1) throw new BackendError('not_found', '原本が見つかりません', '')
    eventBus.emit('source.updated', { kind: 'archived' })
    return { archived: p.archived === true }
  })

  router.register('document.delete', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const result = db
      .prepare(
        `UPDATE entity_registry SET status='deleted', is_archived=0, updated_by='user', updated_at=? WHERE uid=? AND project_uid=? AND entity_type='source_document' AND status <> 'deleted'`
      )
      .run(new Date().toISOString(), requireString(p, 'uid'), info.projectUid)
    if (result.changes !== 1) throw new BackendError('not_found', '原本が見つかりません', '')
    eventBus.emit('source.updated', { kind: 'deleted' })
    return { deleted: true }
  })
  /** 論理削除した原本を復元する（W4、NFR-012 Undo）。復元後状態は削除前の値を指定する */
  router.register('document.restore', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const status = typeof p.status === 'string' && p.status !== 'deleted' ? p.status : 'draft'
    const result = db
      .prepare(
        `UPDATE entity_registry SET status=?, updated_by='user', updated_at=? WHERE uid=? AND project_uid=? AND entity_type='source_document' AND status = 'deleted'`
      )
      .run(status, new Date().toISOString(), requireString(p, 'uid'), info.projectUid)
    if (result.changes !== 1) throw new BackendError('not_found', '削除済みの原本が見つかりません', '')
    eventBus.emit('source.updated', { kind: 'restored' })
    return { restored: true }
  })

  /** 原本から②抽出ジョブを開始（P4-2 / P5、UI-010 / UI-046。現状 Word のみ） */
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
    if (doc.has_extracted_data) {
      throw new BackendError(
        'validation',
        'この原本の抽出データは既に存在します',
        '既存の②抽出データを使用してください'
      )
    }
    return jobs.enqueue('extract.word', { sourceDocumentUid: doc.uid })
  })

  // ---- ②抽出データ（P5） ----

  router.register('extracted.list', (params) => {
    const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    const { db, info } = requireProject()
    return db
      .prepare(
        `SELECT e.uid, e.code, e.title,
                CASE WHEN NOT EXISTS (SELECT 1 FROM extracted_item ai WHERE ai.extracted_document_uid=x.uid) OR EXISTS (SELECT 1 FROM extracted_item ai JOIN entity_registry ar ON ar.uid=ai.resource_uid WHERE ai.extracted_document_uid=x.uid AND ar.status NOT IN ('approved','deleted')) THEN 'draft' ELSE 'approved' END AS status,
                e.is_archived, x.extraction_status, x.extractor_name, x.extractor_version,
                x.extracted_at, x.source_document_uid,
                (SELECT COUNT(*) FROM extracted_item i WHERE i.extracted_document_uid = x.uid) AS item_count,
                (SELECT COUNT(*) FROM extracted_item i JOIN entity_registry ir ON ir.uid = i.resource_uid
                  WHERE i.extracted_document_uid = x.uid AND ir.status NOT IN ('approved', 'deleted')) AS unconfirmed_count
           FROM extracted_document x
           JOIN entity_registry e ON e.uid = x.uid
          WHERE e.project_uid = ? AND e.status <> 'deleted' AND (? = 1 OR e.is_archived = 0)
          ORDER BY x.extracted_at DESC`
      )
      .all(info.projectUid, p.includeArchived === true ? 1 : 0)
  })

  router.register('extracted.setArchived', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const result = db
      .prepare(
        `UPDATE entity_registry SET is_archived=?, updated_by='user', updated_at=? WHERE uid=? AND project_uid=? AND entity_type='extracted_document' AND status <> 'deleted'`
      )
      .run(p.archived === true ? 1 : 0, new Date().toISOString(), requireString(p, 'uid'), info.projectUid)
    if (result.changes !== 1) throw new BackendError('not_found', '抽出データが見つかりません', '')
    eventBus.emit('extracted.updated', { kind: 'archived' })
    return { archived: p.archived === true }
  })

  router.register('extracted.delete', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const result = db
      .prepare(
        `UPDATE entity_registry SET status='deleted', is_archived=0, updated_by='user', updated_at=? WHERE uid=? AND project_uid=? AND entity_type='extracted_document' AND status <> 'deleted'`
      )
      .run(new Date().toISOString(), requireString(p, 'uid'), info.projectUid)
    if (result.changes !== 1) throw new BackendError('not_found', '抽出データが見つかりません', '')
    eventBus.emit('extracted.updated', { kind: 'deleted' })
    return { deleted: true }
  })

  /** 論理削除した②抽出データを復元する（W4、NFR-012 Undo） */
  router.register('extracted.restore', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const status = typeof p.status === 'string' && p.status !== 'deleted' ? p.status : 'draft'
    const result = db
      .prepare(
        `UPDATE entity_registry SET status=?, updated_by='user', updated_at=? WHERE uid=? AND project_uid=? AND entity_type='extracted_document' AND status = 'deleted'`
      )
      .run(status, new Date().toISOString(), requireString(p, 'uid'), info.projectUid)
    if (result.changes !== 1) throw new BackendError('not_found', '削除済みの抽出データが見つかりません', '')
    eventBus.emit('extracted.updated', { kind: 'restored' })
    return { restored: true }
  })
  /** 抽出文書の表示名称変更（P5-15、EXT-040）。 */
  router.register('extracted.rename', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const uid = requireString(p, 'uid')
    const result = renameExtractedDocument(db, info.projectUid, uid, requireString(p, 'title'))
    eventBus.emit('extracted.renamed', { uid, title: result.title })
    return result
  })
  /** 抽出文書の要素一覧（レビュー用。UI-011 / EXT-020） */
  router.register('extracted.get', (params) => {
    const p = asRecord(params)
    const uid = requireString(p, 'uid')
    const { db } = requireProject()
    syncExtractedDocumentStatus(db, uid)
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
    const statusByUid = new Map<string, { status: string; code: string; item_uid: string }>(
      (
        db
          .prepare(
            `SELECT r.resource_uid AS uid, r.uid AS item_uid, e.status, e.code
               FROM extracted_item r JOIN entity_registry e ON e.uid = r.resource_uid
              WHERE r.extracted_document_uid = ?`
          )
          .all(uid) as { uid: string; status: string; code: string; item_uid: string }[]
      ).map((row) => [row.uid, { status: row.status, code: row.code, item_uid: row.item_uid }])
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
      syncExtractedDocumentStatus(db, uid)
      return items.changes
    })
    const approvedCount = txn()
    eventBus.emit('extraction.completed', { extractedDocumentUid: uid, approvedCount })
    return { approved: true, approvedCount }
  })
}
