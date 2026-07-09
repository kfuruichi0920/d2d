/**
 * Main（OS統合）側のシステム情報ハンドラ。
 * ファイル選択ダイアログ等の OS 統合は P4（原本取込）以降でここへ追加する。
 */
import { app, dialog, ipcMain, BrowserWindow } from 'electron'

export function registerSystemHandlers(): void {
  ipcMain.handle('system:getVersions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))

  /** ファイル・フォルダ選択（OS 統合は Main の責務。sdd_function_architecture §2） */
  ipcMain.handle(
    'system:showOpenDialog',
    async (
      event,
      options: { title?: string; mode: 'file' | 'directory'; filters?: { name: string; extensions: string[] }[] }
    ) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      const result = await dialog.showOpenDialog(win ?? BrowserWindow.getAllWindows()[0]!, {
        title: options.title,
        properties: options.mode === 'directory' ? ['openDirectory', 'createDirectory'] : ['openFile'],
        filters: options.filters
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  )
}
