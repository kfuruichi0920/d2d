import { ipcMain } from 'electron'
import { extractDocument, getExtractionStatus } from '../../extract/extract-manager'

export function registerExtractHandlers(): void {
  ipcMain.handle('extract:document', async (_event, sourceDocumentUid: string) => {
    return extractDocument(sourceDocumentUid)
  })

  ipcMain.handle('extract:status', (_event, extractedDocumentUid: string) => {
    return getExtractionStatus(extractedDocumentUid)
  })
}
