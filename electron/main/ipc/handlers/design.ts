import { ipcMain } from 'electron'
import {
  listResources,
  getResource,
  deleteResource,
  updateResourceStatus,
  updateResourceField,
  createLabel,
  createText,
  createList,
  createTable,
  createCode,
  createModel,
  createScenario,
  createInterface,
  createStateTransition,
  createDataStructure,
  type ResourceEntityType,
} from '../../design/resource-manager'
import {
  createTraceLink,
  listTraceLinks,
  deleteTraceLink,
  getTraceSubgraph,
  type RelationType,
} from '../../design/trace-manager'
import {
  createGlossaryTerm,
  listGlossaryTerms,
  getGlossaryTerm,
  updateGlossaryTerm,
  deleteGlossaryTerm,
  addSynonym,
  listSynonyms,
  deleteSynonym,
  confirmGlossaryTerm,
  type CreateGlossaryOptions,
} from '../../design/glossary-manager'

export function registerDesignHandlers(): void {
  // ---- resources ----
  ipcMain.handle('design:listResources', (_e, entityType: ResourceEntityType, limit?: number) =>
    listResources(entityType, limit)
  )
  ipcMain.handle('design:getResource', (_e, uid: string) => getResource(uid) ?? null)
  ipcMain.handle('design:deleteResource', (_e, uid: string) => { deleteResource(uid) })
  ipcMain.handle('design:updateStatus', (_e, uid: string, status: 'active' | 'archived' | 'deleted') => {
    updateResourceStatus(uid, status)
  })
  ipcMain.handle('design:updateField', (_e, uid: string, entityType: ResourceEntityType, fields: Record<string, unknown>) => {
    updateResourceField(uid, entityType, fields)
  })

  // type-specific creators
  ipcMain.handle('design:createLabel', (_e, opts) => createLabel(opts))
  ipcMain.handle('design:createText', (_e, opts) => createText(opts))
  ipcMain.handle('design:createList', (_e, opts) => createList(opts))
  ipcMain.handle('design:createTable', (_e, opts) => createTable(opts))
  ipcMain.handle('design:createCode', (_e, opts) => createCode(opts))
  ipcMain.handle('design:createModel', (_e, opts) => createModel(opts))
  ipcMain.handle('design:createScenario', (_e, opts) => createScenario(opts))
  ipcMain.handle('design:createInterface', (_e, opts) => createInterface(opts))
  ipcMain.handle('design:createStateTransition', (_e, opts) => createStateTransition(opts))
  ipcMain.handle('design:createDataStructure', (_e, opts) => createDataStructure(opts))

  // ---- trace links ----
  ipcMain.handle(
    'design:createTraceLink',
    (_e, fromUid: string, toUid: string, relationType: RelationType, opts?) =>
      createTraceLink(fromUid, toUid, relationType, opts)
  )
  ipcMain.handle('design:listTraceLinks', (_e, uid: string, direction?: 'from' | 'to' | 'both') =>
    listTraceLinks(uid, direction)
  )
  ipcMain.handle('design:deleteTraceLink', (_e, uid: string) => { deleteTraceLink(uid) })
  ipcMain.handle('design:getTraceSubgraph', (_e, rootUid: string, maxDepth?: number, relationTypes?: RelationType[]) =>
    getTraceSubgraph(rootUid, maxDepth, relationTypes)
  )

  // ---- glossary ----
  ipcMain.handle('design:createGlossaryTerm', (_e, opts: CreateGlossaryOptions) => createGlossaryTerm(opts))
  ipcMain.handle('design:listGlossaryTerms', (_e, opts?) => listGlossaryTerms(opts))
  ipcMain.handle('design:getGlossaryTerm', (_e, uid: string) => getGlossaryTerm(uid) ?? null)
  ipcMain.handle('design:updateGlossaryTerm', (_e, uid: string, updates) => { updateGlossaryTerm(uid, updates) })
  ipcMain.handle('design:deleteGlossaryTerm', (_e, uid: string) => { deleteGlossaryTerm(uid) })
  ipcMain.handle('design:confirmGlossaryTerm', (_e, uid: string) => { confirmGlossaryTerm(uid) })
  ipcMain.handle('design:addSynonym', (_e, glossaryUid: string, synonymText: string, synonymKind?: string) =>
    addSynonym(glossaryUid, synonymText, synonymKind)
  )
  ipcMain.handle('design:listSynonyms', (_e, glossaryUid: string) => listSynonyms(glossaryUid))
  ipcMain.handle('design:deleteSynonym', (_e, uid: string) => { deleteSynonym(uid) })
}
