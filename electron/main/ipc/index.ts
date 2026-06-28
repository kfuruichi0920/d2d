import { registerProjectHandlers } from './handlers/project'
import { registerStoreHandlers } from './handlers/store'
import { registerJobHandlers } from './handlers/jobs'
import { registerSettingsHandlers } from './handlers/settings'
import { registerImportHandlers } from './handlers/import'
import { registerExtractHandlers } from './handlers/extract'
import { registerIntermediateHandlers } from './handlers/intermediate'
import { registerArtifactsHandlers } from './handlers/artifacts'
import { registerDesignHandlers } from './handlers/design'
import { registerTraceabilityHandlers } from './handlers/traceability'
import { registerLlmHandlers } from './handlers/llm'
import { registerPhase8Handlers } from './handlers/phase8'

export function registerAllIpcHandlers(): void {
  registerProjectHandlers()
  registerStoreHandlers()
  registerJobHandlers()
  registerSettingsHandlers()
  registerImportHandlers()
  registerExtractHandlers()
  registerIntermediateHandlers()
  registerArtifactsHandlers()
  registerDesignHandlers()
  registerTraceabilityHandlers()
  registerLlmHandlers()
  registerPhase8Handlers()
}
