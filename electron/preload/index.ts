/**
 * Preload: contextBridge で許可した API のみを window.api.* として公開する
 * （sdd_function_architecture §2.2）。Renderer は Node.js API に直接触れない。
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { ApiResult, RendererApi } from '../../src/types/ipc'

const api: RendererApi = {
  invoke<T = unknown>(method: string, params?: unknown): Promise<ApiResult<T>> {
    return ipcRenderer.invoke('api:invoke', method, params) as Promise<ApiResult<T>>
  },

  onEvent(listener: (event: string, payload: unknown) => void): () => void {
    const wrapped = (_e: Electron.IpcRendererEvent, event: string, payload: unknown): void => {
      listener(event, payload)
    }
    ipcRenderer.on('api:event', wrapped)
    return () => ipcRenderer.removeListener('api:event', wrapped)
  },

  getVersions(): Promise<{ app: string; electron: string; chrome: string; node: string }> {
    return ipcRenderer.invoke('system:getVersions') as Promise<{
      app: string
      electron: string
      chrome: string
      node: string
    }>
  },

  showOpenDialog(options): Promise<string | null> {
    return ipcRenderer.invoke('system:showOpenDialog', options) as Promise<string | null>
  },

  showOpenFilesDialog(options): Promise<string[]> {
    return ipcRenderer.invoke('system:showOpenFilesDialog', options) as Promise<string[]>
  }
}

contextBridge.exposeInMainWorld('api', api)
