import type { ApiRouter } from './router'
import { BackendError } from './errors'
import { closeProject, createProject, currentProject, openProject, requireProject } from '../project/project-service'
import {
  addArtifactRelation,
  deactivateArtifactRelation,
  deactivateArtifactSetting,
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

  // ---- プロジェクト設定 CRUD（P2-1、CORE-012） ----

  router.register('project.listArtifactSettings', () => {
    const { db, info } = requireProject()
    return listArtifactSettings(db, info.projectUid)
  })

  router.register('project.saveArtifactSetting', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return saveArtifactSetting(db, info.projectUid, {
      uid: p.uid === undefined ? undefined : String(p.uid),
      artifactName: String(p.artifactName ?? ''),
      artifactTypeId: String(p.artifactTypeId ?? ''),
      sortOrder: p.sortOrder === undefined ? undefined : Number(p.sortOrder),
      isActive: p.isActive === undefined ? undefined : Boolean(p.isActive)
    } satisfies SaveArtifactSettingInput)
  })

  router.register('project.deactivateArtifactSetting', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    deactivateArtifactSetting(db, info.projectUid, String(p.uid ?? ''))
    return { deactivated: true }
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
    return saveDevPhase(db, info.projectUid, {
      uid: p.uid === undefined ? undefined : String(p.uid),
      devPhaseId: String(p.devPhaseId ?? ''),
      devPhaseName: String(p.devPhaseName ?? ''),
      sortOrder: p.sortOrder === undefined ? undefined : Number(p.sortOrder),
      isActive: p.isActive === undefined ? undefined : Boolean(p.isActive)
    } satisfies SaveDevPhaseInput)
  })
}
