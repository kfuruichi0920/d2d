import type { ApiRouter } from './router'
import { BackendError } from './errors'
import { requireProject } from '../project/project-service'
import type { SettingsService } from '../settings/settings-service'
import { rebuildSearchIndex, searchElements, type SearchSettings } from '../search/search-service'
import { bundledMecab, bundledUnidic } from '../runtime-paths'

function params(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new BackendError('validation', 'パラメータが必要です', '')
  return value as Record<string, unknown>
}
function searchSettings(settings: SettingsService, useMecab: boolean): SearchSettings {
  const userDictionaryPaths = settings.get('search.userDictionaryPaths')
  const mecabPath = settings.get('search.mecabPath')
  const dictionaryPath = settings.get('search.dictionaryPath')
  return {
    useMecab,
    // 設定未指定時は同梱 MeCab + UniDic を既定にする（P14-5、TBD-03）
    mecabPath: typeof mecabPath === 'string' && mecabPath ? mecabPath : (bundledMecab() ?? undefined),
    dictionaryPath:
      typeof dictionaryPath === 'string' && dictionaryPath ? dictionaryPath : (bundledUnidic() ?? undefined),
    userDictionaryPaths: Array.isArray(userDictionaryPaths)
      ? userDictionaryPaths.filter((x): x is string => typeof x === 'string')
      : []
  }
}
export function registerSearchApi(router: ApiRouter, settings: SettingsService): void {
  router.register('search.rebuildIndex', (value) => {
    const { db, info } = requireProject()
    return rebuildSearchIndex(db, info.projectUid, searchSettings(settings, Boolean(params(value).useMecab)))
  })
  router.register('search.elements', (value) => {
    const p = params(value)
    const { db, info } = requireProject()
    return searchElements(db, info.projectUid, String(p.query ?? ''), searchSettings(settings, p.useMecab === true), {
      entityType: typeof p.entityType === 'string' && p.entityType ? p.entityType : undefined,
      limit: typeof p.limit === 'number' ? p.limit : undefined
    })
  })
}
