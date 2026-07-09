import type { ApiRouter } from './router'
import { BackendError } from './errors'
import { closeProject, createProject, currentProject, openProject } from '../project/project-service'

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
}
