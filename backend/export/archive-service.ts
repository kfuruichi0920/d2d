/**
 * ZIP アーカイブ生成・差分インポート（P12-3/P12-4、DATA-003/004/007/030〜033、NFR-014）。
 * - 生成: 成果物セット（project.db / blobs / exports / project.d2d）+ manifest を archives/ へ ZIP 化
 * - 差分インポート: 一時領域へ展開し manifest を検査、アーカイブ側 DB から DB to Text を
 *   再生成して現在正本の出力と比較する。正本（project.db / blobs/）は一切上書きしない（DATA-032）
 */
import AdmZip from 'adm-zip'
import BetterSqlite3, { type Database } from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'
import { exportDbToText, exportSqliteDump } from './db-to-text-service'

export const MANIFEST_NAME = 'manifest.json'

export type FileRole = 'db' | 'project_file' | 'blob' | 'export' | 'manifest'

/** DATA-003/004/033: manifest 構造 */
export interface ArchiveManifest {
  d2d_archive_version: '1'
  schema_version: string
  created_at: string
  project_uid: string
  project_name: string
  /** 原本ハッシュ（DATA-003/033） */
  source_hashes: { code: string; file_name: string; hash: string }[]
  /** 抽出器バージョン（extracted_document.extractor_version の distinct） */
  extractor_versions: string[]
  /** 成果物一覧（②③④の件数サマリ） */
  artifact_summary: { extracted_documents: number; intermediate_documents: number; design_elements: number }
  /** ファイル役割識別（DATA-004） */
  files: { path: string; role: FileRole; size: number }[]
}

function walkFiles(dir: string, base: string, out: { abs: string; rel: string }[]): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    const st = statSync(abs)
    if (st.isDirectory()) walkFiles(abs, base, out)
    else out.push({ abs, rel: relative(base, abs).replaceAll('\\', '/') })
  }
}

function roleOf(rel: string): FileRole {
  if (rel === 'project.db') return 'db'
  if (rel === 'project.d2d') return 'project_file'
  if (rel.startsWith('blobs/')) return 'blob'
  return 'export'
}

export interface CreateArchiveResult {
  zipPath: string
  fileName: string
  fileCount: number
  size: number
}

/**
 * 成果物セットの ZIP アーカイブを archives/ へ生成する（DATA-030）。
 * 生成前に DB to Text / SQLite dump を再生成して同梱する（DATA-024 の保存 Hook）。
 */
export function createArchive(
  db: Database,
  projectUid: string,
  projectRoot: string,
  options?: { name?: string; onProgress?: (percent: number, message: string) => void }
): CreateArchiveResult {
  const progress = options?.onProgress ?? ((): void => undefined)

  progress(10, 'DB to Text を再生成中')
  exportDbToText(db, projectUid, projectRoot)
  exportSqliteDump(db, projectRoot)

  // WAL の内容を本体へ反映してから DB ファイルを取り込む
  db.pragma('wal_checkpoint(TRUNCATE)')

  progress(30, '対象ファイルを収集中')
  const targets: { abs: string; rel: string }[] = []
  for (const rel of ['project.db', 'project.d2d']) {
    const abs = join(projectRoot, rel)
    if (existsSync(abs)) targets.push({ abs, rel })
  }
  for (const dir of ['blobs', 'exports']) {
    const abs = join(projectRoot, dir)
    if (existsSync(abs)) walkFiles(abs, projectRoot, targets)
  }

  const project = db.prepare(`SELECT uid, name, schema_version FROM project`).get() as {
    uid: string
    name: string
    schema_version: string
  }
  const sources = db
    .prepare(
      `SELECT e.code, s.file_name, s.file_hash FROM source_document s
         JOIN entity_registry e ON e.uid = s.uid ORDER BY e.code`
    )
    .all() as { code: string; file_name: string; file_hash: string }[]
  const extractorVersions = (
    db.prepare(`SELECT DISTINCT extractor_version AS v FROM extracted_document ORDER BY v`).all() as {
      v: string | null
    }[]
  )
    .map((r) => r.v)
    .filter((v): v is string => !!v)
  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n

  const manifest: ArchiveManifest = {
    d2d_archive_version: '1',
    schema_version: project.schema_version,
    created_at: new Date().toISOString(),
    project_uid: project.uid,
    project_name: project.name,
    source_hashes: sources.map((s) => ({ code: s.code, file_name: s.file_name, hash: s.file_hash })),
    extractor_versions: extractorVersions,
    artifact_summary: {
      extracted_documents: count(`SELECT COUNT(*) AS n FROM extracted_document`),
      intermediate_documents: count(`SELECT COUNT(*) AS n FROM intermediate_document`),
      design_elements: count(
        `SELECT COUNT(*) AS n FROM entity_registry WHERE entity_type LIKE 'model_%' AND status <> 'deleted'`
      )
    },
    files: targets.map((t) => ({ path: t.rel, role: roleOf(t.rel), size: statSync(t.abs).size }))
  }

  progress(50, 'ZIP を作成中')
  const zip = new AdmZip()
  zip.addFile(MANIFEST_NAME, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf-8'))
  for (const t of targets) {
    zip.addFile(t.rel, readFileSync(t.abs))
  }

  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 19)
  const fileName = `${options?.name?.trim() || project.name || 'archive'}_${stamp}.zip`.replaceAll(/[\\/:*?"<>|]/g, '_')
  const archivesDir = join(projectRoot, 'archives')
  mkdirSync(archivesDir, { recursive: true })
  const zipPath = join(archivesDir, fileName)
  zip.writeZip(zipPath)

  progress(95, '完了処理中')
  const result: CreateArchiveResult = {
    zipPath,
    fileName,
    fileCount: targets.length + 1,
    size: statSync(zipPath).size
  }
  // DATA-033 / sdd: アーカイブ作成完了イベント
  eventBus.emit('archive.created', { fileName, size: result.size, fileCount: result.fileCount })
  return result
}

export interface ArchiveListItem {
  fileName: string
  size: number
  modifiedAt: string
}

export function listArchives(projectRoot: string): ArchiveListItem[] {
  const dir = join(projectRoot, 'archives')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith('.zip'))
    .map((f) => {
      const st = statSync(join(dir, f))
      return { fileName: f, size: st.size, modifiedAt: st.mtime.toISOString() }
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export interface TableDiff {
  file: string
  added: number
  removed: number
  changed: number
}

export interface ArchiveDiffResult {
  archiveFileName: string
  manifest: Pick<ArchiveManifest, 'schema_version' | 'created_at' | 'project_name' | 'artifact_summary'>
  warnings: string[]
  tables: TableDiff[]
}

/** 差分インポートの展開・比較結果（Diff ビューが後から本文を取得する。プロセス内保持） */
interface LastDiffState {
  archiveFileName: string
  /** アーカイブ側 db_to_text ディレクトリ */
  leftDir: string
  /** 現在正本側 db_to_text ディレクトリ */
  rightDir: string
  result: ArchiveDiffResult
}

let lastDiff: LastDiffState | null = null

function keyOfLine(line: string): string {
  try {
    const obj = JSON.parse(line) as Record<string, unknown>
    if (typeof obj.uid === 'string') return `uid:${obj.uid}`
  } catch {
    // JSONL 以外（CSV/MD）は行そのものをキーにする
  }
  return `line:${line}`
}

function diffFiles(leftPath: string, rightPath: string): { added: number; removed: number; changed: number } {
  const read = (p: string): Map<string, string> => {
    const map = new Map<string, string>()
    if (!existsSync(p)) return map
    for (const line of readFileSync(p, 'utf-8').split('\n')) {
      if (line.trim() === '') continue
      map.set(keyOfLine(line), line)
    }
    return map
  }
  const left = read(leftPath) // アーカイブ（過去）
  const right = read(rightPath) // 現在正本
  let added = 0
  let removed = 0
  let changed = 0
  for (const [key, value] of right) {
    if (!left.has(key)) added++
    else if (left.get(key) !== value) changed++
  }
  for (const key of left.keys()) {
    if (!right.has(key)) removed++
  }
  return { added, removed, changed }
}

/**
 * ZIP を一時領域へ展開し、現在正本との差分を比較する（DATA-007/031、NFR-014）。
 * 正本成果物（project.db、blobs/）は直接上書きしない（DATA-032）。
 */
export function importArchiveForDiff(
  db: Database,
  projectUid: string,
  projectRoot: string,
  archiveFileName: string
): ArchiveDiffResult {
  const zipPath = join(projectRoot, 'archives', basename(archiveFileName))
  if (!existsSync(zipPath)) {
    throw new BackendError('not_found', `アーカイブが見つかりません: ${archiveFileName}`, '')
  }

  // 一時展開領域（archives/.diff/。正本ツリーの外側として扱い、毎回作り直す）
  const tempDir = join(projectRoot, 'archives', '.diff')
  rmSync(tempDir, { recursive: true, force: true })
  mkdirSync(tempDir, { recursive: true })

  const zip = new AdmZip(zipPath)
  const manifestEntry = zip.getEntry(MANIFEST_NAME)
  if (!manifestEntry) {
    throw new BackendError('validation', 'manifest.json を含まない ZIP は差分インポートできません（DATA-003）', '')
  }
  const manifest = JSON.parse(manifestEntry.getData().toString('utf-8')) as ArchiveManifest
  const warnings: string[] = []
  if (manifest.d2d_archive_version !== '1') {
    warnings.push(`未知のアーカイブ版数です: ${String(manifest.d2d_archive_version)}`)
  }

  // 展開は DB と db_to_text のみ（差分比較に必要な範囲。blob は展開しない）
  zip.extractEntryTo('project.db', tempDir, true, true)
  for (const entry of zip.getEntries()) {
    if (entry.entryName.startsWith('exports/db_to_text/')) {
      zip.extractEntryTo(entry.entryName, tempDir, true, true)
    }
  }

  const currentSchema = (db.prepare(`SELECT schema_version FROM project`).get() as { schema_version: string })
    .schema_version
  if (manifest.schema_version !== currentSchema) {
    warnings.push(
      `schema_version が異なります（アーカイブ: ${manifest.schema_version} / 現在: ${currentSchema}）。差分は参考情報です`
    )
  }

  // アーカイブ側 DB から DB to Text を再生成する（GIT-001 と同じ比較系。読み取り専用で開く）
  const leftDir = join(tempDir, 'exports', 'db_to_text')
  const archivedDbPath = join(tempDir, 'project.db')
  if (existsSync(archivedDbPath) && manifest.schema_version === currentSchema) {
    const archivedDb = new BetterSqlite3(archivedDbPath, { readonly: true })
    try {
      const archivedProjectUid = (archivedDb.prepare(`SELECT uid FROM project`).get() as { uid: string }).uid
      exportDbToText(archivedDb, archivedProjectUid, tempDir)
    } finally {
      archivedDb.close()
    }
  } else if (!existsSync(leftDir)) {
    warnings.push('アーカイブに db_to_text が含まれず、DB からの再生成もできないため差分を計算できません')
  }

  // 現在正本側を最新化（DATA-024: 差分確認処理からの Hook 呼び出し）
  const { outDir: rightDir } = exportDbToText(db, projectUid, projectRoot)

  const names = new Set<string>()
  for (const dir of [leftDir, rightDir]) {
    if (existsSync(dir)) for (const f of readdirSync(dir)) names.add(f)
  }
  const tables: TableDiff[] = [...names].sort().map((file) => ({
    file,
    ...diffFiles(join(leftDir, file), join(rightDir, file))
  }))

  const result: ArchiveDiffResult = {
    archiveFileName: basename(archiveFileName),
    manifest: {
      schema_version: manifest.schema_version,
      created_at: manifest.created_at,
      project_name: manifest.project_name,
      artifact_summary: manifest.artifact_summary
    },
    warnings,
    tables
  }
  lastDiff = { archiveFileName: basename(archiveFileName), leftDir, rightDir, result }
  return result
}

export function getLastArchiveDiff(): ArchiveDiffResult | null {
  return lastDiff?.result ?? null
}

/** Diff ビュー用に左右のテキストを返す（左=アーカイブ、右=現在正本） */
export function getArchiveDiffContent(file: string): { file: string; left: string; right: string } {
  if (!lastDiff) {
    throw new BackendError(
      'validation',
      '差分インポートが実行されていません',
      'archive.importForDiff を先に実行してください'
    )
  }
  const name = basename(file)
  const read = (dir: string): string => {
    const p = join(dir, name)
    return existsSync(p) ? readFileSync(p, 'utf-8') : ''
  }
  return { file: name, left: read(lastDiff.leftDir), right: read(lastDiff.rightDir) }
}
