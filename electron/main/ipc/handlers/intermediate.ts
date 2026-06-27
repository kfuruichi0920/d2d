import { ipcMain } from 'electron'
import {
  createIntermediateDocument,
  listIntermediateDocuments,
  getIntermediateDocument,
  listIntermediateItems,
  promoteFromExtracted,
} from '../../intermediate/intermediate-manager'
import { createChunk, listChunks, deleteChunk } from '../../intermediate/chunk-manager'

export function registerIntermediateHandlers(): void {
  ipcMain.handle('intermediate:create', (_e, opts: { sourceExtractedDocumentUid?: string; title?: string }) =>
    createIntermediateDocument(opts)
  )

  ipcMain.handle('intermediate:list', () => listIntermediateDocuments())

  ipcMain.handle('intermediate:get', (_e, uid: string) => getIntermediateDocument(uid) ?? null)

  ipcMain.handle('intermediate:listItems', (_e, uid: string) => listIntermediateItems(uid))

  ipcMain.handle(
    'intermediate:promoteFromExtracted',
    (_e, extractedDocumentUid: string, intermediateDocumentUid: string) =>
      promoteFromExtracted(extractedDocumentUid, intermediateDocumentUid)
  )

  ipcMain.handle('intermediate:listChunks', (_e, uid: string) => listChunks(uid))

  ipcMain.handle(
    'intermediate:createChunk',
    (_e, intermediateDocumentUid: string, itemUids: string[], tokenCount?: number) =>
      createChunk(intermediateDocumentUid, itemUids, tokenCount)
  )

  ipcMain.handle('intermediate:deleteChunk', (_e, uid: string) => {
    deleteChunk(uid)
  })
}
