import type { ApiRouter } from './router'
import { BackendError } from './errors'
import { requireProject } from '../project/project-service'
import { getProjectSettings } from '../settings/settings-service'
import { rebuildSearchIndex, searchElements, type SearchSettings } from '../search/search-service'

function params(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new BackendError('validation', 'パラメータが必要です', '')
  return value as Record<string, unknown>
}
function searchSettings(rootPath: string, useMecab: boolean): SearchSettings {
  const all = getProjectSettings(rootPath)
  return {
    useMecab,
    mecabPath: typeof all['search.mecabPath'] === 'string' ? all['search.mecabPath'] : undefined,
    dictionaryPath: typeof all['search.dictionaryPath'] === 'string' ? all['search.dictionaryPath'] : undefined,
    userDictionaryPaths: Array.isArray(all['search.userDictionaryPaths'])
      ? all['search.userDictionaryPaths'].filter((x): x is string => typeof x === 'string')
      : []
  }
}
export function registerSearchApi(router: ApiRouter): void {
  router.register('search.rebuildIndex', (value) => {
    const { db, info } = requireProject()
    return rebuildSearchIndex(db, info.projectUid, searchSettings(info.rootPath, Boolean(params(value).useMecab)))
  })
  router.register('search.elements', (value) => {
    const p = params(value)
    const { db, info } = requireProject()
    return searchElements(
      db,
      info.projectUid,
      String(p.query ?? ''),
      searchSettings(info.rootPath, p.useMecab === true),
      {
        entityType: typeof p.entityType === 'string' && p.entityType ? p.entityType : undefined,
        limit: typeof p.limit === 'number' ? p.limit : undefined
      }
    )
  })
}
