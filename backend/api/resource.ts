/** 共通Resource Editor API（P7-2/P7-3、MID-002/004/005、EDIT-004）。 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import { requireProject } from '../project/project-service'
import { getResource, RESOURCE_TYPE_DEFINITIONS, reviseResource } from '../resource/resource-service'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new BackendError('validation', 'パラメータオブジェクトが必要です', '')
  return value as Record<string, unknown>
}
function stringValue(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== 'string' || !value[key]) throw new BackendError('validation', `${key}は必須です`, '')
  return value[key] as string
}
export function registerResourceApi(router: ApiRouter): void {
  router.register('resource.types', () => RESOURCE_TYPE_DEFINITIONS)
  router.register('resource.get', (params) => {
    const p = record(params)
    const { db } = requireProject()
    return getResource(db, stringValue(p, 'uid'))
  })
  router.register('resource.revise', (params) => {
    const p = record(params)
    const { db, info } = requireProject()
    return reviseResource(db, info.projectUid, {
      resourceUid: stringValue(p, 'resourceUid'),
      targetType: stringValue(p, 'targetType'),
      values: record(p.values),
      intermediateDocumentUid: typeof p.intermediateDocumentUid === 'string' ? p.intermediateDocumentUid : undefined,
      intermediateItemUid: typeof p.intermediateItemUid === 'string' ? p.intermediateItemUid : undefined,
      elementId: typeof p.elementId === 'string' ? p.elementId : undefined
    })
  })
}
