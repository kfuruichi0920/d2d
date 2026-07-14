/** 共通Resource Editor API（P7-2/P7-3、MID-002/004/005、EDIT-004）。 */
import type { ApiRouter } from './router'
import type { JobManager } from '../jobs/job-manager'
import { BackendError } from './errors'
import { requireProject } from '../project/project-service'
import {
  getResource,
  getResourceMergeContext,
  mergeResourceValues,
  RESOURCE_TYPE_DEFINITIONS,
  reviseResource
} from '../resource/resource-service'

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new BackendError('validation', 'パラメータオブジェクトが必要です', '')
  return value as Record<string, unknown>
}
function stringValue(value: Record<string, unknown>, key: string): string {
  if (typeof value[key] !== 'string' || !value[key]) throw new BackendError('validation', `${key}は必須です`, '')
  return value[key] as string
}
export function registerResourceApi(router: ApiRouter, jobs: JobManager): void {
  router.register('resource.types', () => RESOURCE_TYPE_DEFINITIONS)
  router.register('resource.get', (params) => {
    const p = record(params)
    const { db } = requireProject()
    return getResource(db, stringValue(p, 'uid'))
  })
  router.register('resource.getMergeContext', (params) => {
    const p = record(params)
    const { db } = requireProject()
    return getResourceMergeContext(
      db,
      stringValue(p, 'intermediateDocumentUid'),
      stringValue(p, 'intermediateItemUid'),
      stringValue(p, 'resourceUid')
    )
  })
  router.register('resource.mergePreview', (params) => {
    const p = record(params)
    requireProject()
    const sources = Array.isArray(p.sources) ? p.sources.map(record) : []
    return mergeResourceValues(
      stringValue(p, 'targetType'),
      sources.map((source) => ({ type: stringValue(source, 'type'), values: record(source.values) }))
    )
  })
  router.register('resource.generateMergeCandidate', (params) => {
    const p = record(params)
    requireProject()
    const sources = Array.isArray(p.sources) ? p.sources.map(record) : []
    if (sources.length === 0) throw new BackendError('validation', 'マージ元Resourceがありません', '')
    return jobs.enqueue('resource.mergeCandidate', {
      targetType: stringValue(p, 'targetType'),
      sources: sources.map((source) => ({
        resourceUid: typeof source.resourceUid === 'string' ? source.resourceUid : undefined,
        type: stringValue(source, 'type'),
        values: record(source.values)
      }))
    })
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
      elementId: typeof p.elementId === 'string' ? p.elementId : undefined,
      basedOnResourceUids: Array.isArray(p.basedOnResourceUids) ? p.basedOnResourceUids.map(String) : undefined,
      transformNote: p.transformNote === 'merge' || p.transformNote === 'llm-merge' ? p.transformNote : 'edit-resource',
      llmRunUid: typeof p.llmRunUid === 'string' ? p.llmRunUid : undefined
    })
  })
}
