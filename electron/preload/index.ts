import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { D2DApi } from '../main/ipc/types'

const api: D2DApi = {
  project: {
    open: (filePath) => ipcRenderer.invoke('project:open', filePath),
    create: (opts) => ipcRenderer.invoke('project:create', opts),
    getCurrent: () => ipcRenderer.invoke('project:getCurrent'),
    close: () => ipcRenderer.invoke('project:close')
  },
  store: {
    query: (sql, params) => ipcRenderer.invoke('store:query', sql, params),
    execute: (sql, params) => ipcRenderer.invoke('store:execute', sql, params)
  },
  jobs: {
    list: () => ipcRenderer.invoke('jobs:list'),
    getLog: (jobId) => ipcRenderer.invoke('jobs:getLog', jobId),
    retry: (jobId) => ipcRenderer.invoke('jobs:retry', jobId),
    cancel: (jobId) => ipcRenderer.invoke('jobs:cancel', jobId)
  },
  settings: {
    getApp: () => ipcRenderer.invoke('settings:getApp'),
    setApp: (settings) => ipcRenderer.invoke('settings:setApp', settings),
    getProject: () => ipcRenderer.invoke('settings:getProject'),
    setProject: (settings) => ipcRenderer.invoke('settings:setProject', settings),
    getApiKey: (service, account) => ipcRenderer.invoke('settings:getApiKey', service, account),
    setApiKey: (service, account, key) =>
      ipcRenderer.invoke('settings:setApiKey', service, account, key),
    deleteApiKey: (service, account) =>
      ipcRenderer.invoke('settings:deleteApiKey', service, account)
  },
  import: {
    document: (filePath) => ipcRenderer.invoke('import:document', filePath),
    openDialog: () => ipcRenderer.invoke('import:openDialog'),
    listDocuments: () => ipcRenderer.invoke('import:listDocuments'),
    getDocument: (uid) => ipcRenderer.invoke('import:getDocument', uid)
  },
  extract: {
    document: (sourceDocumentUid) => ipcRenderer.invoke('extract:document', sourceDocumentUid),
    status: (extractedDocumentUid) => ipcRenderer.invoke('extract:status', extractedDocumentUid)
  },
  intermediate: {
    create: (opts) => ipcRenderer.invoke('intermediate:create', opts),
    list: () => ipcRenderer.invoke('intermediate:list'),
    get: (uid) => ipcRenderer.invoke('intermediate:get', uid),
    listItems: (uid) => ipcRenderer.invoke('intermediate:listItems', uid),
    promoteFromExtracted: (extractedDocumentUid, intermediateDocumentUid) =>
      ipcRenderer.invoke('intermediate:promoteFromExtracted', extractedDocumentUid, intermediateDocumentUid),
    listChunks: (uid) => ipcRenderer.invoke('intermediate:listChunks', uid),
    createChunk: (intermediateDocumentUid, itemUids, tokenCount) =>
      ipcRenderer.invoke('intermediate:createChunk', intermediateDocumentUid, itemUids, tokenCount),
    deleteChunk: (uid) => ipcRenderer.invoke('intermediate:deleteChunk', uid)
  },
  artifacts: {
    listSettings: () => ipcRenderer.invoke('artifacts:listSettings'),
    createSetting: (name, typeId, sortOrder) =>
      ipcRenderer.invoke('artifacts:createSetting', name, typeId, sortOrder),
    deleteSetting: (uid) => ipcRenderer.invoke('artifacts:deleteSetting', uid),
    generateArchive: (label) => ipcRenderer.invoke('artifacts:generateArchive', label),
    listArchives: () => ipcRenderer.invoke('artifacts:listArchives')
  },
  trace: {
    subgraph: (rootUid, opts) => ipcRenderer.invoke('trace:subgraph', rootUid, opts),
    impacted: (uid, maxDepth) => ipcRenderer.invoke('trace:impacted', uid, maxDepth),
    roots: (uid, maxDepth) => ipcRenderer.invoke('trace:roots', uid, maxDepth),
    matrix: (fromTypes, toTypes, relationTypes) => ipcRenderer.invoke('trace:matrix', fromTypes, toTypes, relationTypes),
    stats: () => ipcRenderer.invoke('trace:stats'),
    exportJson: (rootUid, maxDepth) => ipcRenderer.invoke('trace:exportJson', rootUid, maxDepth),
    exportMatrixJson: (fromTypes, toTypes, relationTypes) => ipcRenderer.invoke('trace:exportMatrixJson', fromTypes, toTypes, relationTypes),
    exportMatrixCsv: (fromTypes, toTypes, relationTypes) => ipcRenderer.invoke('trace:exportMatrixCsv', fromTypes, toTypes, relationTypes),
    exportMatrixMarkdown: (fromTypes, toTypes, relationTypes) => ipcRenderer.invoke('trace:exportMatrixMarkdown', fromTypes, toTypes, relationTypes),
    exportSubgraphMarkdown: (rootUid, maxDepth) => ipcRenderer.invoke('trace:exportSubgraphMarkdown', rootUid, maxDepth),
    dbToText: () => ipcRenderer.invoke('store:dbToText'),
    sqliteDump: () => ipcRenderer.invoke('store:sqliteDump'),
  },
  design: {
    listResources: (entityType, limit) => ipcRenderer.invoke('design:listResources', entityType, limit),
    getResource: (uid) => ipcRenderer.invoke('design:getResource', uid),
    deleteResource: (uid) => ipcRenderer.invoke('design:deleteResource', uid),
    updateStatus: (uid, status) => ipcRenderer.invoke('design:updateStatus', uid, status),
    updateField: (uid, entityType, fields) => ipcRenderer.invoke('design:updateField', uid, entityType, fields),
    createLabel: (opts) => ipcRenderer.invoke('design:createLabel', opts),
    createText: (opts) => ipcRenderer.invoke('design:createText', opts),
    createList: (opts) => ipcRenderer.invoke('design:createList', opts),
    createTable: (opts) => ipcRenderer.invoke('design:createTable', opts),
    createCode: (opts) => ipcRenderer.invoke('design:createCode', opts),
    createModel: (opts) => ipcRenderer.invoke('design:createModel', opts),
    createScenario: (opts) => ipcRenderer.invoke('design:createScenario', opts),
    createInterface: (opts) => ipcRenderer.invoke('design:createInterface', opts),
    createStateTransition: (opts) => ipcRenderer.invoke('design:createStateTransition', opts),
    createDataStructure: (opts) => ipcRenderer.invoke('design:createDataStructure', opts),
    createTraceLink: (fromUid, toUid, relationType, opts) =>
      ipcRenderer.invoke('design:createTraceLink', fromUid, toUid, relationType, opts),
    listTraceLinks: (uid, direction) => ipcRenderer.invoke('design:listTraceLinks', uid, direction),
    deleteTraceLink: (uid) => ipcRenderer.invoke('design:deleteTraceLink', uid),
    getTraceSubgraph: (rootUid, maxDepth, relationTypes) =>
      ipcRenderer.invoke('design:getTraceSubgraph', rootUid, maxDepth, relationTypes),
    createGlossaryTerm: (opts) => ipcRenderer.invoke('design:createGlossaryTerm', opts),
    listGlossaryTerms: (opts) => ipcRenderer.invoke('design:listGlossaryTerms', opts),
    getGlossaryTerm: (uid) => ipcRenderer.invoke('design:getGlossaryTerm', uid),
    updateGlossaryTerm: (uid, updates) => ipcRenderer.invoke('design:updateGlossaryTerm', uid, updates),
    deleteGlossaryTerm: (uid) => ipcRenderer.invoke('design:deleteGlossaryTerm', uid),
    confirmGlossaryTerm: (uid) => ipcRenderer.invoke('design:confirmGlossaryTerm', uid),
    addSynonym: (glossaryUid, synonymText, synonymKind) =>
      ipcRenderer.invoke('design:addSynonym', glossaryUid, synonymText, synonymKind),
    listSynonyms: (glossaryUid) => ipcRenderer.invoke('design:listSynonyms', glossaryUid),
    deleteSynonym: (uid) => ipcRenderer.invoke('design:deleteSynonym', uid),
  },
  events: {
    on: (channel, listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
        listener(...args)
      ipcRenderer.on(channel, wrapped)
      return () => ipcRenderer.removeListener(channel, wrapped)
    }
  }
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
