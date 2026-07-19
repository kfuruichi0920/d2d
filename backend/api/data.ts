/**
 * データ出力・履歴・差分 API（P12）。
 * DB to Text / SQLite dump / ZIP アーカイブ / Git 履歴参照 / ストア閲覧。
 */
import { join } from 'node:path'
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import { requireProject } from '../project/project-service'
import { eventBus } from '../events/event-bus'
import { getProjectSettings } from '../settings/settings-service'
import { callMain } from '../main-bridge'
import { exportDbToText, exportSqliteDump, listDbToTextFiles, listExportTables } from '../export/db-to-text-service'
import {
  getArchiveDiffContent,
  getLastArchiveDiff,
  importArchiveForDiff,
  listArchives
} from '../export/archive-service'
import {
  checkoutGitBranch,
  commitGitChanges,
  createGitBranch,
  getGitBranches,
  getGitComparisonFilePair,
  getGitComparisonFiles,
  getGitFileAt,
  getGitLog,
  getGitShow,
  getGitStatus,
  getGitWorkingFilePair,
  isGitRepo,
  stageGitFiles,
  unstageGitFiles
} from '../git/git-service'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', String(params))
  }
  return params as Record<string, unknown>
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new BackendError('validation', `${key} は必須の文字列です`, '')
  }
  return value
}

function requireStringArray(params: Record<string, unknown>, key: string): string[] {
  const value = params[key]
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new BackendError('validation', `${key} は文字列配列です`, '')
  }
  return value
}
export function registerDataApi(router: ApiRouter, jobs: JobManager): void {
  // ---- DB to Text / SQLite dump（P12-1/P12-2） ----

  /** DB 内容の安定順序テキスト出力（DATA-020〜023）。派生成果物として exports/ へ */
  router.register('export.dbToText', () => {
    const { db, info } = requireProject()
    const result = exportDbToText(db, info.projectUid, info.rootPath)
    eventBus.emit('export.dbToText.completed', { fileCount: result.files.length })
    return { relDir: 'exports/db_to_text', files: result.files }
  })

  router.register('export.sqliteDump', () => {
    const { db, info } = requireProject()
    const result = exportSqliteDump(db, info.rootPath)
    return { relDir: 'exports/sqlite_dump', files: result.files }
  })

  router.register('export.listDbToText', () => {
    const { info } = requireProject()
    return { files: listDbToTextFiles(info.rootPath) }
  })

  router.register('export.openFolder', async () => {
    const { info } = requireProject()
    const path = join(info.rootPath, 'exports')
    const error = await callMain<string>('shell.openPath', { path })
    if (error) throw new BackendError('io', 'exportsフォルダを開けませんでした', error)
    return { path }
  })

  // ---- ZIP アーカイブ（P12-3/P12-4） ----

  /** アーカイブ生成はジョブとして実行（CORE-020。blob 量に応じて長時間化するため） */
  router.register('archive.create', (params) => {
    const p = asRecord(params)
    requireProject()
    return jobs.enqueue('archive.create', { name: typeof p.name === 'string' ? p.name : undefined })
  })

  router.register('archive.list', () => {
    const { info } = requireProject()
    return listArchives(info.rootPath)
  })

  /** 差分インポート（DATA-007/031/032、NFR-014）。正本は上書きしない */
  router.register('archive.importForDiff', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return importArchiveForDiff(db, info.projectUid, info.rootPath, requireString(p, 'fileName'))
  })

  router.register('archive.lastDiff', () => {
    requireProject()
    return getLastArchiveDiff()
  })

  /** Diff ビュー用: 左=アーカイブ / 右=現在正本 のテキストペア（UI-017） */
  router.register('archive.getDiffContent', (params) => {
    const p = asRecord(params)
    requireProject()
    return getArchiveDiffContent(requireString(p, 'file'))
  })

  // ---- Git連携（P12-5、GIT-001〜007） ----

  router.register('git.info', async () => {
    const { info } = requireProject()
    return { isRepo: await isGitRepo(info.rootPath) }
  })

  router.register('git.log', async (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    if (!(await isGitRepo(info.rootPath))) {
      return { isRepo: false, commits: [] }
    }
    const maxCount = p.maxCount === undefined ? 50 : Number(p.maxCount)
    return { isRepo: true, commits: await getGitLog(info.rootPath, maxCount) }
  })

  router.register('git.status', async () => {
    const { info } = requireProject()
    if (!(await isGitRepo(info.rootPath))) return { isRepo: false, files: [] }
    return { isRepo: true, files: await getGitStatus(info.rootPath) }
  })

  router.register('git.branches', async () => {
    const { info } = requireProject()
    return getGitBranches(info.rootPath)
  })

  router.register('git.stage', async (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    await stageGitFiles(info.rootPath, requireStringArray(p, 'paths'))
    return { files: await getGitStatus(info.rootPath) }
  })

  router.register('git.unstage', async (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    await unstageGitFiles(info.rootPath, requireStringArray(p, 'paths'))
    return { files: await getGitStatus(info.rootPath) }
  })

  router.register('git.branchCreate', async (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    return createGitBranch(info.rootPath, requireString(p, 'name'))
  })

  router.register('git.checkout', async (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    return checkoutGitBranch(info.rootPath, requireString(p, 'name'))
  })

  /** GIT-004/007: コミット直前に両テキスト出力を再生成し、必ずコミットへ含める。 */
  router.register('git.commit', async (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const dbToText = exportDbToText(db, info.projectUid, info.rootPath)
    const sqliteDump = exportSqliteDump(db, info.rootPath)
    await stageGitFiles(info.rootPath, ['exports/db_to_text', 'exports/sqlite_dump'])
    const commit = await commitGitChanges(
      info.rootPath,
      requireString(p, 'message'),
      requireString(p, 'authorName'),
      requireString(p, 'authorEmail')
    )
    eventBus.emit('git.committed', { hash: commit.hash })
    return { commit, dbToTextFiles: dbToText.files.length, sqliteDumpFiles: sqliteDump.files.length }
  })
  /** コミットの --stat + patch（GIT-005） */
  router.register('git.show', async (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    return { text: await getGitShow(info.rootPath, requireString(p, 'hash')) }
  })

  /**
   * 過去コミット時点の DB to Text 等と現在ファイルの比較用ペア（GIT-001/006）。
   * 左=コミット時点、右=作業ツリーの現在内容
   */
  router.register('git.workingFileDiffPair', async (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    return getGitWorkingFilePair(info.rootPath, requireString(p, 'path'))
  })

  router.register('git.compare', async (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    const fromHash = requireString(p, 'fromHash')
    const toHash = requireString(p, 'toHash')
    return { fromHash, toHash, files: await getGitComparisonFiles(info.rootPath, fromHash, toHash) }
  })

  router.register('git.comparisonFilePair', async (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    return getGitComparisonFilePair(
      info.rootPath,
      requireString(p, 'fromHash'),
      requireString(p, 'toHash'),
      requireString(p, 'path')
    )
  })

  router.register('git.getFileDiffPair', async (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    const relPath = requireString(p, 'path')
    const hash = requireString(p, 'hash')
    const left = await getGitFileAt(info.rootPath, hash, relPath)
    let right = ''
    try {
      const { readFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      right = readFileSync(join(info.rootPath, relPath), 'utf-8')
    } catch {
      right = ''
    }
    return { path: relPath, hash, left, right }
  })

  // ---- ストア閲覧（P12-7、UI-020） ----

  router.register('store.listTables', () => {
    const { db } = requireProject()
    return listExportTables(db).map((t) => ({
      name: t.name,
      columns: t.columns,
      rowCount: (db.prepare(`SELECT COUNT(*) AS n FROM ${t.name}`).get() as { n: number }).n
    }))
  })

  router.register('store.getRows', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const name = requireString(p, 'table')
    // SQL 直組みのため、実在テーブル名のホワイトリストで検査する
    const table = listExportTables(db).find((t) => t.name === name)
    if (!table) {
      throw new BackendError('validation', `閲覧できないテーブルです: ${name}`, '')
    }
    const limit = Math.min(Math.max(Number(p.limit ?? 200), 1), 1000)
    const offset = Math.max(Number(p.offset ?? 0), 0)
    const rows = db
      .prepare(
        `SELECT ${table.columns.map((c) => `"${c}"`).join(', ')} FROM ${table.name} ORDER BY ${table.orderBy} LIMIT ? OFFSET ?`
      )
      .all(limit, offset) as Record<string, unknown>[]
    const total = (db.prepare(`SELECT COUNT(*) AS n FROM ${table.name}`).get() as { n: number }).n
    return { table: table.name, columns: table.columns, rows, limit, offset, total }
  })
}

/**
 * 保存系イベントからの DB to Text 自動出力 Hook（DATA-024）。
 * プロジェクト設定 export.autoDbToText = true の場合のみ、成果物更新イベントを
 * デバウンスして再出力する。
 */
export function registerDbToTextHook(): void {
  let timer: NodeJS.Timeout | null = null
  const trigger = (): void => {
    const project = ((): ReturnType<typeof requireProject> | null => {
      try {
        return requireProject()
      } catch {
        return null
      }
    })()
    if (!project) return
    if (getProjectSettings(project.info.rootPath)['export.autoDbToText'] !== true) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      try {
        const result = exportDbToText(project.db, project.info.projectUid, project.info.rootPath)
        eventBus.emit('export.dbToText.completed', { fileCount: result.files.length, auto: true })
      } catch (error) {
        console.error('[data] DB to Text 自動出力に失敗しました:', error)
      }
    }, 1500)
  }
  for (const event of ['artifact.updated', 'intermediate.updated', 'design.updated', 'trace.updated']) {
    eventBus.on(event, trigger)
  }
}
