/** 共通Resource Editor API（P7-2/P7-3、MID-002/004/005、EDIT-004）。 */
import type { ApiRouter } from './router'
import type { JobManager } from '../jobs/job-manager'
import { BackendError } from './errors'
import { requireProject } from '../project/project-service'
import { listResourceAddresses } from '../navigation/resource-address-service'
import {
  getResource,
  getResourceMergeContext,
  mergeResourceValues,
  linkDerivedResource,
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
  /** scheme:// の全UIDリンク一覧（P3-7、UI-057）。 */
  router.register('resource.listAddresses', (params) => {
    const p = record(params)
    const { db, info } = requireProject()
    return listResourceAddresses(db, info.projectUid, stringValue(p, 'scheme'))
  })
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
  router.register('resource.linkDerived', (params) => {
    const p = record(params)
    const { db, info } = requireProject()
    const relationType = String(p.relationType ?? 'relates_to')
    if (!['contains', 'uses', 'relates_to'].includes(relationType))
      throw new BackendError('validation', '未対応の関係種別です', relationType)
    return linkDerivedResource(db, info.projectUid, {
      sourceUid: stringValue(p, 'sourceUid'),
      relationType: relationType as 'contains' | 'uses' | 'relates_to',
      targetUid: typeof p.targetUid === 'string' && p.targetUid ? p.targetUid.replace(/^resource:\/\//, '') : undefined,
      newText: typeof p.newText === 'string' ? p.newText : undefined
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
      llmRunUid: typeof p.llmRunUid === 'string' ? p.llmRunUid : undefined,
      administrativeNotes: typeof p.administrativeNotes === 'string' ? p.administrativeNotes : undefined
    })
  })
}
