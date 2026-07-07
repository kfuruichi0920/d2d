/**
 * Main（OS統合）側のシステム情報ハンドラ。
 * ファイル選択ダイアログ等の OS 統合は P4（原本取込）以降でここへ追加する。
 */
import { app, ipcMain } from 'electron'

export function registerSystemHandlers(): void {
  ipcMain.handle('system:getVersions', () => ({
    app: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node
  }))
}
