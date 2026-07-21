/**
 * Excel抽出グループ候補 API（P5-19、EXT-049〜055）。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import { requireProject } from '../project/project-service'
import {
  buildExcelCandidateLlmMessages,
  confirmExcelDraft,
  getExcelDraft,
  saveExcelCandidates
} from '../extract/excel-draft-service'
import type { ChatMessage } from '../llm/providers'
import { eventBus } from '../events/event-bus'

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
