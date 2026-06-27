import { ipcMain } from 'electron'
import {
  listArtifactSettings,
  createArtifactSetting,
  deleteArtifactSetting,
} from '../../artifacts/artifact-manager'
import { generateArchive, listArchives } from '../../artifacts/archive-manager'
import { getCurrentProject } from '../../project/project-manager'

export function registerArtifactsHandlers(): void {
  ipcMain.handle('artifacts:listSettings', () => listArtifactSettings())

  ipcMain.handle('artifacts:createSetting', (_e, name: string, typeId: string, sortOrder?: number) => {
    const project = getCurrentProject()
    if (!project) throw new Error('プロジェクトが開かれていません')
    return createArtifactSetting(project.uid, name, typeId, sortOrder)
  })

  ipcMain.handle('artifacts:deleteSetting', (_e, uid: string) => {
    deleteArtifactSetting(uid)
  })

  ipcMain.handle('artifacts:generateArchive', (_e, label?: string) => generateArchive(label))

  ipcMain.handle('artifacts:listArchives', () => listArchives())
}
