/**
 * PDF抽出領域候補 API（P5-20、IMP-005/EXT-027〜029）。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import { requireProject } from '../project/project-service'
import {
  buildPdfOcrMessages,
  buildPdfRegionLlmMessages,
  getPdfDraft,
  savePdfRegions,
  PDF_EXCLUDED_TYPES,
  type PdfOcrMode
} from '../extract/pdf-draft-service'
import { runWorker } from '../workers/worker-runner'
import type { ChatMessage } from '../llm/providers'
import { eventBus } from '../events/event-bus'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null)
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', '')
  return params as Record<string, unknown>
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || !value) throw new BackendError('validation', `${key} は必須の文字列です`, '')
  return value
}

function requireStringArray(params: Record<string, unknown>, key: string): string[] {
  const value = params[key]
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !item))
    throw new BackendError('validation', `${key} は1件以上の文字列配列です`, '')
  return value as string[]
}

/** 送信前確認済みメッセージ。Vision OCR の画像添付（base64）も保持する */
function asMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new BackendError('validation', 'messages は1件以上必要です', '')
  return value.map((message) => {
    const item = message as {
      role?: string
      content?: string
      attachments?: Array<{ mediaType?: string; data?: string }>
    }
    if (!item.role || !['system', 'user', 'assistant'].includes(item.role) || typeof item.content !== 'string')
      throw new BackendError('validation', 'LLMメッセージ形式が不正です', '')
    const attachments = item.attachments?.map((attachment) => {
      if (typeof attachment.mediaType !== 'string' || typeof attachment.data !== 'string')
        throw new BackendError('validation', 'LLM添付データの形式が不正です', '')
      return { mediaType: attachment.mediaType, data: attachment.data }
    })
    return {
      role: item.role as ChatMessage['role'],
      content: item.content,
      ...(attachments?.length ? { attachments } : {})
    }
  })
}

function asOcrMode(value: unknown): PdfOcrMode {
  if (value !== 'text' && value !== 'table' && value !== 'formula')
    throw new BackendError('validation', `未対応のOCRモードです: ${String(value)}`, '')
  return value
}

export function registerPdfApi(router: ApiRouter, jobs: JobManager): void {
  router.register('pdfDraft.get', (params) => {
    const { db } = requireProject()
    return getPdfDraft(db, requireString(asRecord(params), 'sourceDocumentUid'))
  })

  /** ページ画像（オーバーレイレビューの背景）。プロジェクト内相対パスだけを許可する */
  router.register('pdfDraft.getPageImage', (params) => {
    const p = asRecord(params)
    const sourceDocumentUid = requireString(p, 'sourceDocumentUid')
    const pageIndex = Number(p.pageIndex)
    const { db, info } = requireProject()
    const draft = getPdfDraft(db, sourceDocumentUid)
    const page = draft.physical.document.pages.find((entry) => entry.page_index === pageIndex)
    if (!page?.image_file) throw new BackendError('not_found', `ページ画像がありません: ${p.pageIndex}`, '')
    const root = resolve(info.rootPath)
    const filePath = resolve(root, page.image_file)
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`))
      throw new BackendError('validation', 'プロジェクト外の画像は表示できません', page.image_file)
    if (!existsSync(filePath)) throw new BackendError('io', 'ページ画像ファイルが見つかりません', page.image_file)
    return { dataUrl: `data:image/png;base64,${readFileSync(filePath).toString('base64')}` }
  })

  router.register('pdfDraft.saveRegions', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    if (!Array.isArray(p.regions)) throw new BackendError('validation', 'regions は配列です', '')
    const result = savePdfRegions(db, requireString(p, 'sourceDocumentUid'), p.regions)
    eventBus.emit('pdfDraft.updated', { sourceDocumentUid: p.sourceDocumentUid, kind: 'saved' })
    return result
  })

  /** 選択領域限定のLLM分類支援入力を作る（P5-20D、検討資料 §16.3。送信前確認へ渡す） */
  router.register('pdfDraft.prepareLlm', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const sourceDocumentUid = requireString(p, 'sourceDocumentUid')
    const regionUids = requireStringArray(p, 'regionUids')
    return {
      operation: 'pdf-regions',
      purpose: 'classify',
      processName: 'pdf-region-refinement',
      jsonMode: true,
      messages: buildPdfRegionLlmMessages(db, sourceDocumentUid, regionUids)
    }
  })

  router.register('pdfDraft.runLlmConfirmed', (params) => {
    const p = asRecord(params)
    requireProject()
    return jobs.enqueue('pdf.regionLlm', {
      sourceDocumentUid: requireString(p, 'sourceDocumentUid'),
      regionUids: requireStringArray(p, 'regionUids'),
      messages: asMessages(p.messages),
      promptTemplateUid: typeof p.promptTemplateUid === 'string' ? p.promptTemplateUid : undefined
    })
  })

  /** 選択領域のVision OCR入力を作る（P5-20D、EXT-030）。領域切出しPNGだけを添付する */
  router.register('pdfDraft.prepareOcr', async (params) => {
    const p = asRecord(params)
    const { db, info, paths } = requireProject()
    const sourceDocumentUid = requireString(p, 'sourceDocumentUid')
    const regionUid = requireString(p, 'regionUid')
    const mode = asOcrMode(p.mode)
    const draft = getPdfDraft(db, sourceDocumentUid)
    if (draft.status === 'confirmed') throw new BackendError('conflict', '確定済みの領域は更新できません', '')
    const region = draft.regions.find((entry) => entry.region_uid === regionUid)
    if (!region) throw new BackendError('not_found', `領域が見つかりません: ${regionUid}`, '')
    const doc = db
      .prepare(
        `SELECT b.relative_path FROM source_document d LEFT JOIN blob_resource b ON b.uid=d.blob_uid WHERE d.uid=?`
      )
      .get(sourceDocumentUid) as { relative_path: string | null } | undefined
    if (!doc?.relative_path) throw new BackendError('not_found', '原本ファイルの blob 参照がありません', '')
    // OCR入力画像は監査できるよう blobs/extracted/pdf-ocr/ へ残す
    const workDir = join(paths.blobsDir, 'extracted', 'pdf-ocr', sourceDocumentUid)
    const workerResult = await runWorker({
      request: {
        job_id: `ocr-prepare-${Date.now()}`,
        project_uid: info.projectUid,
        worker_name: 'd2d-worker',
        command: 'extract.pdf.region',
        parameters: {
          file_path: join(info.rootPath, doc.relative_path),
          work_dir: workDir,
          regions: [{ page_index: region.page_index, bbox: region.bbox, mode: 'crop' }],
          scale: 3
        }
      }
    })
    const output = workerResult.output as { results?: Array<Record<string, unknown>> } | undefined
    const entry = output?.results?.[0]
    if (!entry || typeof entry.image_file !== 'string')
      throw new BackendError('worker', '領域画像の切出しに失敗しました', String(entry?.error ?? ''))
    const imagePath = join(workDir, entry.image_file)
    if (!existsSync(imagePath)) throw new BackendError('io', '切出し画像が見つかりません', entry.image_file)
    const attachment = { mediaType: 'image/png', data: readFileSync(imagePath).toString('base64') }
    return {
      operation: 'pdf-region-ocr',
      purpose: 'other',
      processName: 'pdf-region-ocr',
      jsonMode: true,
      messages: buildPdfOcrMessages(region, mode, attachment)
    }
  })

  router.register('pdfDraft.runOcrConfirmed', (params) => {
    const p = asRecord(params)
    requireProject()
    return jobs.enqueue('pdf.regionOcr', {
      sourceDocumentUid: requireString(p, 'sourceDocumentUid'),
      regionUid: requireString(p, 'regionUid'),
      mode: asOcrMode(p.mode),
      messages: asMessages(p.messages),
      promptTemplateUid: typeof p.promptTemplateUid === 'string' ? p.promptTemplateUid : undefined
    })
  })

  /** 人間確定した採用領域から②抽出データを生成するジョブを登録する（P5-20C、EXT-031） */
  router.register('pdfDraft.confirm', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const sourceDocumentUid = requireString(p, 'sourceDocumentUid')
    const draft = getPdfDraft(db, sourceDocumentUid)
    if (draft.status === 'confirmed') throw new BackendError('conflict', 'PDF候補は確定済みです', '')
    const hasTarget = draft.regions.some(
      (region) => region.review_status === 'approved' && !PDF_EXCLUDED_TYPES.includes(region.region_type)
    )
    if (!hasTarget) throw new BackendError('validation', '抽出対象の採用領域がありません', '')
    return jobs.enqueue('pdf.confirm', { sourceDocumentUid })
  })

  /** 領域単位の部分再解析（表・テキスト。EXT-029、検討資料 §14） */
  router.register('pdfDraft.reanalyzeRegion', (params) => {
    const p = asRecord(params)
    requireProject()
    const mode = requireString(p, 'mode')
    if (mode !== 'table' && mode !== 'text')
      throw new BackendError('validation', `未対応の再解析モードです: ${mode}`, '')
    return jobs.enqueue('pdf.regionReanalyze', {
      sourceDocumentUid: requireString(p, 'sourceDocumentUid'),
      regionUid: requireString(p, 'regionUid'),
      mode
    })
  })
}
