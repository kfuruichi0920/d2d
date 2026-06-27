import { ipcMain, dialog, BrowserWindow } from 'electron'
import { importDocument, listDocuments, getDocument } from '../../import/import-manager'

export function registerImportHandlers(): void {
  ipcMain.handle('import:document', async (_event, filePath: string) => {
    return importDocument(filePath)
  })

  ipcMain.handle('import:openDialog', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win!, {
      title: '原本ファイルを選択',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '対応文書',
          extensions: ['docx', 'doc', 'xlsx', 'xls', 'pptx', 'ppt', 'vsdx', 'pdf', 'txt', 'md', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml', 'zip']
        },
        { name: 'すべてのファイル', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })

  ipcMain.handle('import:listDocuments', () => listDocuments())

  ipcMain.handle('import:getDocument', (_event, uid: string) => getDocument(uid))
}
