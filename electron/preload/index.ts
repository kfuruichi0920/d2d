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
