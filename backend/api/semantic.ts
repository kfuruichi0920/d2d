/** セマンティック入力支援 API（P10-7、EDIT-057〜071）。 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import { requireProject } from '../project/project-service'
import {
  analyzeSemanticText,
  getSemanticText,
  parseStructuredSemanticText,
  saveSemanticText,
  searchSemanticCandidates,
  type SemanticInputPolicy,
  type SemanticTextDocument
} from '../edit/semantic-input-service'
import { eventBus } from '../events/event-bus'
import type { SettingsService } from '../settings/settings-service'
import { JapaneseTokenizer } from '../search/search-service'
function record(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object') throw new BackendError('validation', 'パラメータが必要です', '')
  return params as Record<string, unknown>
}
function text(p: Record<string, unknown>, key: string, fallback?: string): string {
  if (p[key] === undefined && fallback !== undefined) return fallback
  if (typeof p[key] !== 'string') throw new BackendError('validation', `${key} は文字列で指定してください`, '')
  return p[key] as string
}
export function registerSemanticApi(router: ApiRouter, settings: SettingsService): void {
  router.register('semantic.get', (params) => {
    const p = record(params),
      { db, info } = requireProject()
    return getSemanticText(db, info.projectUid, text(p, 'ownerUid'), text(p, 'fieldName'), text(p, 'fallbackText', ''))
  })
  router.register('semantic.search', (params) => {
    const p = record(params),
      { db, info } = requireProject()
    return searchSemanticCandidates(
      db,
      info.projectUid,
      text(p, 'prefix'),
      (p.policy as Partial<SemanticInputPolicy>) ?? {}
    )
  })
  router.register('semantic.analyze', (params) => {
    const p = record(params),
      { db, info } = requireProject()
    const input = text(p, 'text')
    const tokenizer = new JapaneseTokenizer({
      useMecab: true,
      mecabPath:
        typeof settings.get('search.mecabPath') === 'string' ? String(settings.get('search.mecabPath')) : undefined,
      dictionaryPath:
        typeof settings.get('search.dictionaryPath') === 'string'
          ? String(settings.get('search.dictionaryPath'))
          : undefined,
      userDictionaryPaths: Array.isArray(settings.get('search.userDictionaryPaths'))
        ? (settings.get('search.userDictionaryPaths') as string[])
        : []
    })
    return {
      ...analyzeSemanticText(db, info.projectUid, input, tokenizer.tokenize(input).split(/\s+/)),
      tokenizer: tokenizer.mode,
      warning: tokenizer.warning
    }
  })
  router.register('semantic.validateStructured', (params) => {
    const p = record(params),
      { db, info } = requireProject()
    return parseStructuredSemanticText(db, info.projectUid, text(p, 'ownerUid'), text(p, 'fieldName'), text(p, 'json'))
  })
  router.register('semantic.save', (params) => {
    const p = record(params),
      { db, info } = requireProject()
    const document = p.document as Omit<SemanticTextDocument, 'history'>
    if (!document || typeof document !== 'object') throw new BackendError('validation', 'document が必要です', '')
    const result = saveSemanticText(db, info.projectUid, document)
    eventBus.emit('semantic.updated', { ownerUid: document.ownerUid, fieldName: document.fieldName })
    return result
  })
}
