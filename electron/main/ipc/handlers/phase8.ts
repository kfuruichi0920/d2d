// Phase 8: レポート / Git / ストア / PlantUML / ライセンス / 設定I/O

import { ipcMain, dialog, shell } from 'electron'
import { generateMarkdownReport, generateHtmlReport, saveReport } from '../../reports/report-generator'
import {
  initGit, gitStatus, gitLog, gitCommit, gitDiff, gitShow, gitFileLog,
} from '../../git/git-manager'
import {
  generateStateDiagram, generateClassDiagram, generateIdMap, toKrokiUrl, savePuml,
} from '../../plantuml/plantuml-generator'
import {
  listDependencies, exportLicensesMarkdown, exportLicensesJson,
} from '../../system/license-reporter'
import { exportSettingsToFile, importSettingsFromFile } from '../../settings/settings-io'
import { getDatabase } from '../../db/database'
import fs from 'fs'
import path from 'path'
import { getProjectRoot } from '../../project/project-manager'

export function registerPhase8Handlers(): void {
  // ---- T801: レポート -------------------------------------------------------
  ipcMain.handle('reports:generateMarkdown', (_e, opts) => generateMarkdownReport(opts))
  ipcMain.handle('reports:generateHtml', (_e, opts) => generateHtmlReport(opts))
  ipcMain.handle('reports:saveMarkdown', async (_e, opts) => {
    const content = generateMarkdownReport(opts)
    const now = new Date().toISOString().slice(0, 10)
    return saveReport(content, `report-${now}.md`)
  })
  ipcMain.handle('reports:saveHtml', async (_e, opts) => {
    const content = generateHtmlReport(opts)
    const now = new Date().toISOString().slice(0, 10)
    return saveReport(content, `report-${now}.html`)
  })

  // ---- T802: Git -----------------------------------------------------------
  ipcMain.handle('git:init', () => initGit())
  ipcMain.handle('git:status', () => gitStatus())
  ipcMain.handle('git:log', (_e, limit?: number) => gitLog(limit))
  ipcMain.handle('git:commit', (_e, message: string, addAll?: boolean) => gitCommit(message, addAll))
  ipcMain.handle('git:diff', (_e, fromHash?: string, toHash?: string) => gitDiff(fromHash, toHash))
  ipcMain.handle('git:show', (_e, hash: string) => gitShow(hash))
  ipcMain.handle('git:fileLog', (_e, filePath: string, limit?: number) => gitFileLog(filePath, limit))

  // ---- T803: ストアブラウザ -------------------------------------------------
  ipcMain.handle('store:listTables', () => {
    const db = getDatabase()
    return (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>)
      .map((r) => r.name)
  })
  ipcMain.handle('store:previewTable', (_e, tableName: string, limit = 100) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) throw new Error('Invalid table name')
    const db = getDatabase()
    const rows = db.prepare(`SELECT * FROM ${tableName} LIMIT ?`).all(limit)
    const count = (db.prepare(`SELECT COUNT(*) as c FROM ${tableName}`).get() as { c: number }).c
    return { rows, totalCount: count }
  })
  ipcMain.handle('store:listExportFiles', () => {
    const exportDir = path.join(getProjectRoot(), 'exports')
    if (!fs.existsSync(exportDir)) return []
    const result: Array<{ path: string; name: string; size: number; mtime: string }> = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name)
        if (entry.isDirectory()) { walk(fullPath); continue }
        const stat = fs.statSync(fullPath)
        result.push({ path: fullPath, name: path.relative(exportDir, fullPath), size: stat.size, mtime: stat.mtime.toISOString() })
      }
    }
    walk(exportDir)
    return result.sort((a, b) => b.mtime.localeCompare(a.mtime))
  })
  ipcMain.handle('store:readExportFile', (_e, filePath: string) => {
    const exportDir = path.join(getProjectRoot(), 'exports')
    if (!filePath.startsWith(exportDir)) throw new Error('Access denied')
    return fs.readFileSync(filePath, 'utf-8')
  })
  ipcMain.handle('store:openExportDir', () => {
    const exportDir = path.join(getProjectRoot(), 'exports')
    fs.mkdirSync(exportDir, { recursive: true })
    shell.openPath(exportDir)
  })

  // ---- T806: PlantUML -------------------------------------------------------
  ipcMain.handle('plantuml:stateDiagram', (_e, uid: string) => generateStateDiagram(uid))
  ipcMain.handle('plantuml:classDiagram', () => generateClassDiagram())
  ipcMain.handle('plantuml:idMap', () => generateIdMap())
  ipcMain.handle('plantuml:krokiUrl', (_e, puml: string) => toKrokiUrl(puml))
  ipcMain.handle('plantuml:save', (_e, content: string, filename: string) => savePuml(content, filename))

  // ---- T807: ライセンス -------------------------------------------------------
  ipcMain.handle('system:listDependencies', (_e, devIncluded?: boolean) => listDependencies(devIncluded))
  ipcMain.handle('system:exportLicensesMarkdown', (_e, devIncluded?: boolean) => exportLicensesMarkdown(devIncluded))
  ipcMain.handle('system:exportLicensesJson', (_e, devIncluded?: boolean) => exportLicensesJson(devIncluded))
  ipcMain.handle('system:saveLicenses', async (_e, devIncluded?: boolean) => {
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: 'ライセンス一覧を保存',
      defaultPath: 'licenses.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }, { name: 'JSON', extensions: ['json'] }],
    })
    if (canceled || !filePath) return null
    const content = filePath.endsWith('.json')
      ? exportLicensesJson(devIncluded)
      : exportLicensesMarkdown(devIncluded)
    fs.writeFileSync(filePath, content, 'utf-8')
    return filePath
  })

  // ---- T808: 設定 I/O -------------------------------------------------------
  ipcMain.handle('settings:exportToFile', () => exportSettingsToFile())
  ipcMain.handle('settings:importFromFile', () => importSettingsFromFile())
}
