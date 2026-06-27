import { ipcMain } from 'electron'
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
}
