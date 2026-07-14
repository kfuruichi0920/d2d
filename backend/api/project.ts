import type { ApiRouter } from './router'
import { BackendError } from './errors'
import { eventBus } from '../events/event-bus'
import { closeProject, createProject, currentProject, openProject, requireProject } from '../project/project-service'
import {
  addArtifactRelation,
  deactivateArtifactRelation,
  deactivateArtifactSetting,
  deleteArtifactSetting,
  deleteDevPhase,
  listArtifactRelations,
  listArtifactSettings,
  listDevPhases,
  saveArtifactSetting,
  saveDevPhase,
  type SaveArtifactSettingInput,
  type SaveDevPhaseInput
} from '../project/project-settings'

interface CreateParams {
  rootPath: string
  name: string
  description?: string
}

interface OpenParams {
  path: string
}

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', String(params))
  }
  return params as Record<string, unknown>
}

/** プロジェクト操作 API（P1-3。設定 CRUD は P2-1 で拡張する） */
export function registerProjectApi(router: ApiRouter): void {
  router.register('project.create', (params) => {
    const p = asRecord(params)
    return createProject({
      rootPath: String(p.rootPath ?? ''),
      name: String(p.name ?? ''),
      description: p.description === undefined ? undefined : String(p.description)
    } satisfies CreateParams)
  })

  router.register('project.open', (params) => {
    const p = asRecord(params)
    return openProject({ path: String(p.path ?? '') } satisfies OpenParams)
  })

  router.register('project.close', () => {
    closeProject()
    return { closed: true }
  })

  router.register('project.getInfo', () => {
    return currentProject()?.info ?? null
  })

  /** Pipeline Navigator 用のステージ集計（sdd_ui_design §3.1） */
  router.register('project.getPipelineStats', () => {
    const { db } = requireProject()
    const countByType = (type: string): number =>
      (
        db
          .prepare(`SELECT COUNT(*) AS n FROM entity_registry WHERE entity_type = ? AND status <> 'deleted'`)
          .get(type) as { n: number }
      ).n
    const designElements = (
      db
        .prepare(`SELECT COUNT(*) AS n FROM entity_registry WHERE design_category IS NOT NULL AND status <> 'deleted'`)
        .get() as { n: number }
    ).n
    const candidates = (
      db.prepare(`SELECT COUNT(*) AS n FROM llm_run_ref WHERE status IN ('success', 'partial')`).get() as {
        n: number
      }
    ).n
    return {
      sources: countByType('source_document'),
      extracted: countByType('extracted_document'),
      intermediate: countByType('intermediate_document'),
      designElements,
      traceLinks: countByType('trace_link'),
      candidates
    }
  })

  // ---- プロジェクト設定 CRUD（P2-1、CORE-012） ----

  router.register('project.listArtifactSettings', () => {
    const { db, info } = requireProject()
    return listArtifactSettings(db, info.projectUid)
  })

  router.register('project.saveArtifactSetting', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const saved = saveArtifactSetting(db, info.projectUid, {
      uid: p.uid === undefined ? undefined : String(p.uid),
      artifactName: String(p.artifactName ?? ''),
      artifactTypeId: String(p.artifactTypeId ?? ''),
      devPhaseId: p.devPhaseId === undefined ? undefined : String(p.devPhaseId),
      sortOrder: p.sortOrder === undefined ? undefined : Number(p.sortOrder),
      isActive: p.isActive === undefined ? undefined : Boolean(p.isActive)
    } satisfies SaveArtifactSettingInput)
    eventBus.emit('artifact.updated', { kind: 'artifact-setting' })
    return saved
  })

  router.register('project.deactivateArtifactSetting', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    deactivateArtifactSetting(db, info.projectUid, String(p.uid ?? ''))
    return { deactivated: true }
  })

  router.register('project.deleteArtifactSetting', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const result = deleteArtifactSetting(db, info.projectUid, String(p.uid ?? ''))
    eventBus.emit('artifact.updated', { kind: 'artifact-deleted' })
    return result
  })

  router.register('project.deleteDevPhase', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const result = deleteDevPhase(db, info.projectUid, String(p.uid ?? ''))
    eventBus.emit('artifact.updated', { kind: 'phase-deleted' })
    return result
  })

  router.register('project.listArtifactRelations', () => {
    const { db, info } = requireProject()
    return listArtifactRelations(db, info.projectUid)
  })

  router.register('project.addArtifactRelation', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return addArtifactRelation(db, info.projectUid, {
      parentArtifactUid: String(p.parentArtifactUid ?? ''),
      childArtifactUid: String(p.childArtifactUid ?? ''),
      sortOrder: p.sortOrder === undefined ? undefined : Number(p.sortOrder)
    })
  })

  router.register('project.deactivateArtifactRelation', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    deactivateArtifactRelation(db, info.projectUid, String(p.uid ?? ''))
    return { deactivated: true }
  })

  router.register('project.listDevPhases', () => {
    const { db, info } = requireProject()
    return listDevPhases(db, info.projectUid)
  })

  router.register('project.saveDevPhase', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const saved = saveDevPhase(db, info.projectUid, {
      uid: p.uid === undefined ? undefined : String(p.uid),
      devPhaseId: String(p.devPhaseId ?? ''),
      devPhaseName: String(p.devPhaseName ?? ''),
      sortOrder: p.sortOrder === undefined ? undefined : Number(p.sortOrder),
      isActive: p.isActive === undefined ? undefined : Boolean(p.isActive)
    } satisfies SaveDevPhaseInput)
    eventBus.emit('artifact.updated', { kind: 'dev-phase-setting' })
    return saved
  })
}
