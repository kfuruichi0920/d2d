/**
 * Electron Main エントリポイント（Gateway / Shell）。
 * 責務は Renderer IPC 中継、OS 統合、Local Backend の起動・停止・接続監視に限定し、
 * 業務ロジック（DB操作・文書解析・LLM通信等）を実装しない
 * （sdd_function_architecture §2 初期実装方針）。
 */
import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { BackendProcessManager } from './backend/backend-process'
import { registerApiHandlers, forwardBackendEvents } from './ipc/handlers/api'
import { registerSystemHandlers } from './ipc/handlers/system'
import { applyCsp, hardenNavigation } from './system/security'

const isDev = !app.isPackaged && !!process.env.ELECTRON_RENDERER_URL

const backend = new BackendProcessManager()

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      // sdd_function_architecture §2.2 の規定値
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, '../preload/index.js')
    }
  })

  win.on('ready-to-show', () => win.show())

  if (isDev) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL as string)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

void app.whenReady().then(() => {
  applyCsp(isDev)
  hardenNavigation()

  backend.start()
  registerApiHandlers(backend)
  registerSystemHandlers()
  forwardBackendEvents(backend, () => BrowserWindow.getAllWindows().map((w) => w.webContents))

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // Windows 前提（APP-001）。macOS 対応時はプラットフォーム分岐を追加する
  app.quit()
})

app.on('before-quit', () => {
  backend.stop()
})
