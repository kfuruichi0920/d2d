import { ipcMain } from 'electron'
import {
  findSubgraph,
  findImpacted,
  findRoots,
  buildMatrix,
  linkStats,
} from '../../traceability/trace-query'
import {
  exportSubgraphJson,
  exportMatrixJson,
  exportMatrixCsv,
  exportMatrixMarkdown,
  exportSubgraphMarkdown,
} from '../../traceability/trace-exporter'
import { generateDbToText, generateSqliteDump } from '../../store/db-to-text'
import type { RelationType } from '../../design/trace-manager'

export function registerTraceabilityHandlers(): void {
  // ---- query ----
  ipcMain.handle(
    'trace:subgraph',
    (
      _e,
      rootUid: string,
      opts?: { maxDepth?: number; direction?: 'forward' | 'backward' | 'both'; relationTypes?: RelationType[]; entityTypes?: string[] }
    ) => findSubgraph(rootUid, opts)
  )

  ipcMain.handle('trace:impacted', (_e, uid: string, maxDepth?: number) =>
    findImpacted(uid, maxDepth)
  )

  ipcMain.handle('trace:roots', (_e, uid: string, maxDepth?: number) =>
    findRoots(uid, maxDepth)
  )

  ipcMain.handle(
    'trace:matrix',
    (_e, fromTypes?: string[], toTypes?: string[], relationTypes?: RelationType[]) =>
      buildMatrix(fromTypes, toTypes, relationTypes)
  )

  ipcMain.handle('trace:stats', () => linkStats())

  // ---- export ----
  ipcMain.handle('trace:exportJson', (_e, rootUid: string, maxDepth?: number) =>
    exportSubgraphJson(rootUid, maxDepth)
  )
  ipcMain.handle(
    'trace:exportMatrixJson',
    (_e, fromTypes?: string[], toTypes?: string[], relationTypes?: RelationType[]) =>
      exportMatrixJson(fromTypes, toTypes, relationTypes)
  )
  ipcMain.handle(
    'trace:exportMatrixCsv',
    (_e, fromTypes?: string[], toTypes?: string[], relationTypes?: RelationType[]) =>
      exportMatrixCsv(fromTypes, toTypes, relationTypes)
  )
  ipcMain.handle(
    'trace:exportMatrixMarkdown',
    (_e, fromTypes?: string[], toTypes?: string[], relationTypes?: RelationType[]) =>
      exportMatrixMarkdown(fromTypes, toTypes, relationTypes)
  )
  ipcMain.handle('trace:exportSubgraphMarkdown', (_e, rootUid: string, maxDepth?: number) =>
    exportSubgraphMarkdown(rootUid, maxDepth)
  )

  // ---- DB to Text ----
  ipcMain.handle('store:dbToText', () => generateDbToText())
  ipcMain.handle('store:sqliteDump', () => generateSqliteDump())
}
