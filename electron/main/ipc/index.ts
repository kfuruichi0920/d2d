import { registerProjectHandlers } from './handlers/project'
import { registerStoreHandlers } from './handlers/store'
import { registerJobHandlers } from './handlers/jobs'
import { registerSettingsHandlers } from './handlers/settings'
import { registerImportHandlers } from './handlers/import'
import { registerExtractHandlers } from './handlers/extract'

export function registerAllIpcHandlers(): void {
  registerProjectHandlers()
  registerStoreHandlers()
  registerJobHandlers()
  registerSettingsHandlers()
  registerImportHandlers()
  registerExtractHandlers()
}
