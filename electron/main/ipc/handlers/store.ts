import { ipcMain } from 'electron'
import { queryAll, execute } from '../../store/store-access'

export function registerStoreHandlers(): void {
  // 読み取り専用クエリ（SELECT のみを想定）
  ipcMain.handle('store:query', (_event, sql: string, params: unknown[] = []) => {
    if (!/^\s*SELECT\b/i.test(sql)) throw new Error('store:query accepts only SELECT statements')
    return queryAll(sql, params)
  })

  // 書き込みクエリ（INSERT / UPDATE / DELETE）
  ipcMain.handle('store:execute', (_event, sql: string, params: unknown[] = []) => {
    if (/^\s*SELECT\b/i.test(sql)) throw new Error('store:execute does not accept SELECT; use store:query')
    const result = execute(sql, params)
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid }
  })
}
