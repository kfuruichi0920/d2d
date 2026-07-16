/** Workbench共通Secondary Side Bar API（P3-9、UI-026/040）。 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import { eventBus } from '../events/event-bus'
import { requireProject } from '../project/project-service'
import { addReviewComment, listItemRelations, listReviewComments } from '../secondary/secondary-service'

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

export function registerSecondaryApi(router: ApiRouter): void {
  router.register('secondary.listRelations', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return listItemRelations(db, info.projectUid, requireString(p, 'itemUid'))
  })
  router.register('secondary.listReviews', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return listReviewComments(db, info.projectUid, requireString(p, 'itemUid'))
  })
  router.register('secondary.addReview', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const result = addReviewComment(db, info.projectUid, requireString(p, 'itemUid'), requireString(p, 'comment'))
    eventBus.emit('secondary.updated', { itemUid: requireString(p, 'itemUid') })
    return result
  })
}
