/**
 * Excel抽出グループ候補 API（P5-19、EXT-049〜062）。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import { requireProject } from '../project/project-service'
import {
  buildExcelCandidateLlmMessages,
  buildExcelRangeLlmMessages,
  confirmExcelDraft,
  getExcelDraft,
  saveExcelCandidates
} from '../extract/excel-draft-service'
import type { ChatMessage } from '../llm/providers'
import { eventBus } from '../events/event-bus'
import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'

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
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item))
    throw new BackendError('validation', `${key} は文字列配列です`, '')
  return value as string[]
}

function asMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new BackendError('validation', 'messages は1件以上必要です', '')
  return value.map((message) => {
    if (
      typeof message !== 'object' ||
      message === null ||
      !['system', 'user', 'assistant'].includes(String((message as Record<string, unknown>).role)) ||
      typeof (message as Record<string, unknown>).content !== 'string'
    ) {
      throw new BackendError('validation', 'LLMメッセージ形式が不正です', '')
    }
    const item = message as Record<string, unknown>
    return { role: item.role as ChatMessage['role'], content: item.content as string }
  })
}

export function registerExcelApi(router: ApiRouter, jobs: JobManager): void {
  router.register('excelDraft.get', (params) => {
    const { db } = requireProject()
    return getExcelDraft(db, requireString(asRecord(params), 'sourceDocumentUid'))
  })

  router.register('excelDraft.getDrawingPreview', (params) => {
    const p = asRecord(params)
    const sourceDocumentUid = requireString(p, 'sourceDocumentUid')
    const drawingUid = requireString(p, 'drawingUid')
    const { db, info } = requireProject()
    const draft = getExcelDraft(db, sourceDocumentUid)
    const drawing = draft.physical.workbook.sheets
      .flatMap((sheet) => sheet.drawings ?? [])
      .find((item) => item.drawing_uid === drawingUid)
    if (!drawing?.preview_path) throw new BackendError('not_found', `図プレビューがありません: ${drawingUid}`, '')
    const root = resolve(info.rootPath)
    const filePath = resolve(root, drawing.preview_path)
    if (filePath !== root && !filePath.startsWith(`${root}${sep}`))
      throw new BackendError('validation', 'プロジェクト外の図は表示できません', drawing.preview_path)
    if (!existsSync(filePath))
      throw new BackendError('io', '図プレビューファイルが見つかりません', drawing.preview_path)
    const extension = extname(filePath).toLowerCase()
    const mime =
      extension === '.svg'
        ? 'image/svg+xml'
        : extension === '.jpg' || extension === '.jpeg'
          ? 'image/jpeg'
          : extension === '.gif'
            ? 'image/gif'
            : 'image/png'
    return { dataUrl: `data:${mime};base64,${readFileSync(filePath).toString('base64')}` }
  })
  router.register('excelDraft.saveCandidates', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    if (!Array.isArray(p.candidates)) throw new BackendError('validation', 'candidates は配列です', '')
    const result = saveExcelCandidates(db, requireString(p, 'sourceDocumentUid'), p.candidates)
    eventBus.emit('excelDraft.updated', { sourceDocumentUid: p.sourceDocumentUid, kind: 'saved' })
    return result
  })

  router.register('excelDraft.prepareLlm', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const sourceDocumentUid = requireString(p, 'sourceDocumentUid')
    const candidateUids = requireStringArray(p, 'candidateUids')
    return {
      operation: 'excel-candidates',
      purpose: 'classify',
      processName: 'excel-candidate-refinement',
      jsonMode: true,
      messages: buildExcelCandidateLlmMessages(db, sourceDocumentUid, candidateUids)
    }
  })

  router.register('excelDraft.prepareRangeLlm', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const sourceDocumentUid = requireString(p, 'sourceDocumentUid')
    const sheetName = requireString(p, 'sheetName')
    const startCell = requireString(p, 'startCell').toUpperCase()
    const endCell = requireString(p, 'endCell').toUpperCase()
    return {
      operation: 'excel-range-grouping',
      purpose: 'classify',
      processName: 'excel-range-grouping',
      jsonMode: true,
      messages: buildExcelRangeLlmMessages(db, sourceDocumentUid, sheetName, startCell, endCell)
    }
  })

  router.register('excelDraft.runRangeLlmConfirmed', (params) => {
    const p = asRecord(params)
    requireProject()
    return jobs.enqueue('excel.rangeLlm', {
      sourceDocumentUid: requireString(p, 'sourceDocumentUid'),
      sheetName: requireString(p, 'sheetName'),
      startCell: requireString(p, 'startCell').toUpperCase(),
      endCell: requireString(p, 'endCell').toUpperCase(),
      messages: asMessages(p.messages),
      promptTemplateUid: typeof p.promptTemplateUid === 'string' ? p.promptTemplateUid : undefined
    })
  })
  router.register('excelDraft.runLlmConfirmed', (params) => {
    const p = asRecord(params)
    requireProject()
    return jobs.enqueue('excel.candidateLlm', {
      sourceDocumentUid: requireString(p, 'sourceDocumentUid'),
      candidateUids: requireStringArray(p, 'candidateUids'),
      messages: asMessages(p.messages),
      promptTemplateUid: typeof p.promptTemplateUid === 'string' ? p.promptTemplateUid : undefined
    })
  })

  router.register('excelDraft.confirm', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const result = confirmExcelDraft(db, {
      projectUid: info.projectUid,
      projectRoot: info.rootPath,
      sourceDocumentUid: requireString(p, 'sourceDocumentUid')
    })
    eventBus.emit('extraction.completed', {
      sourceDocumentUid: p.sourceDocumentUid,
      extractedDocumentUid: result.extractedDocumentUid
    })
    eventBus.emit('artifact.updated', { extractedDocumentUid: result.extractedDocumentUid })
    return result
  })
}
