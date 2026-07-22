/**
 * PDF抽出領域候補 API（P5-20、IMP-005/EXT-027〜029）。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import { requireProject } from '../project/project-service'
import { getPdfDraft, savePdfRegions, PDF_EXCLUDED_TYPES } from '../extract/pdf-draft-service'
import { eventBus } from '../events/event-bus'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, sep } from 'node:path'

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
