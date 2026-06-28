import { ipcMain, dialog } from 'electron'
import {
  openProject,
  createProject,
  getCurrentProject,
  closeProject
} from '../../project/project-manager'
import type { CreateProjectOptions } from '../../project/project-manager'

export function registerProjectHandlers(): void {
  ipcMain.handle('project:open', (_event, filePath: string) => openProject(filePath))

  ipcMain.handle('project:create', (_event, opts: CreateProjectOptions) => createProject(opts))

  ipcMain.handle('project:getCurrent', () => getCurrentProject())

  ipcMain.handle('project:close', () => {
    closeProject()
  })

  ipcMain.handle('project:openDialog', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'プロジェクトを開く',
      filters: [{ name: 'D2D Project', extensions: ['d2d'] }],
      properties: ['openFile'],
    })
    if (canceled || filePaths.length === 0) return null
    return openProject(filePaths[0])
  })

  ipcMain.handle('project:selectDir', async () => {
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: 'プロジェクトを作成するフォルダを選択',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (canceled || filePaths.length === 0) return null
    return filePaths[0]
  })
}
