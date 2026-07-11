/**
 * DB to Text（P12-1/P12-2、DATA-020〜024、GIT-001）。
 * DB 内容を安定した順序でテキスト化し exports/ 配下へ出力する。
 * 出力は派生成果物であり DB 正本を置き換えない（DATA-023）。
 * タイムスタンプを含めず、同一 DB 内容からは常に同一バイト列を生成する
 * （Git 差分・アーカイブ差分・LLM 入力に利用するため。DATA-022）。
 */
import type { Database } from 'better-sqlite3'
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getTraceMatrix } from '../traceability/trace-service'

interface TableInfo {
  name: string
  columns: string[]
  orderBy: string
}

/** エクスポート対象テーブルを列挙する（FTS 仮想テーブルとその影テーブルは除外） */
export function listExportTables(db: Database): TableInfo[] {
  const rows = db
    .prepare(`SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as { name: string; sql: string | null }[]
  const virtualNames = rows.filter((r) => /CREATE VIRTUAL TABLE/i.test(r.sql ?? '')).map((r) => r.name)
  const isShadow = (name: string): boolean => virtualNames.some((v) => name === v || name.startsWith(`${v}_`))

  const tables: TableInfo[] = []
  for (const row of rows) {
    if (isShadow(row.name)) continue
    const cols = db.prepare(`PRAGMA table_info(${row.name})`).all() as { name: string; pk: number }[]
    const columns = cols.map((c) => c.name)
    // 安定順序（DATA-020）: uid 列があれば uid、なければ主キー、どちらも無ければ全列
    const pkCols = cols.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk)
    const orderCols = columns.includes('uid') ? ['uid'] : pkCols.length > 0 ? pkCols.map((c) => c.name) : columns
    tables.push({ name: row.name, columns, orderBy: orderCols.map((c) => `"${c}"`).join(', ') })
  }
  return tables
}

function toJsonValue(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { $blob: value.toString('base64') }
  return value
}

export interface DbToTextResult {
  outDir: string
  files: string[]
}

/**
 * DB 内容を exports/db_to_text/ へ安定順序で出力する（DATA-020/021）。
 * - <table>.jsonl: 全テーブル（1 行 = 1 レコード、列順 JSON）
 * - elements.md / elements.csv: ④設計要素一覧
 * - relations.md / relations.csv: 関係一覧
 * - matrix.csv: トレースマトリクス（REQ×FUNC 既定）
 */
export function exportDbToText(db: Database, projectUid: string, projectRoot: string): DbToTextResult {
  const outDir = join(projectRoot, 'exports', 'db_to_text')
  // 前回の出力を消してから再生成（消えたテーブル・要素の残骸で差分が汚れないように）
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })

  const files: string[] = []
  for (const table of listExportTables(db)) {
    const rows = db
      .prepare(`SELECT ${table.columns.map((c) => `"${c}"`).join(', ')} FROM ${table.name} ORDER BY ${table.orderBy}`)
      .all() as Record<string, unknown>[]
    const lines = rows.map((row) =>
      JSON.stringify(Object.fromEntries(table.columns.map((c) => [c, toJsonValue(row[c])])))
    )
    const fileName = `${table.name}.jsonl`
    writeFileSync(join(outDir, fileName), lines.length > 0 ? `${lines.join('\n')}\n` : '', 'utf-8')
    files.push(fileName)
  }

  files.push(...exportSummaries(db, projectUid, outDir))
  return { outDir, files }
}

/** 要素一覧・関係一覧・マトリクスの Markdown/CSV 出力（DATA-021） */
function exportSummaries(db: Database, projectUid: string, outDir: string): string[] {
  const elements = db
    .prepare(
      `SELECT e.code, e.design_category, e.title, e.status, t.text_body AS description
         FROM entity_registry e LEFT JOIN resource_text t ON t.uid = e.uid
        WHERE e.design_category IS NOT NULL AND e.status <> 'deleted'
        ORDER BY e.code`
    )
    .all() as {
    code: string
    design_category: string
    title: string | null
    status: string
    description: string | null
  }[]

  const relations = db
    .prepare(
      `SELECT l.relation_type, ef.code AS from_code, et.code AS to_code, l.review_status, l.transform_note
         FROM trace_link l
         JOIN entity_registry le ON le.uid = l.uid
         LEFT JOIN entity_registry ef ON ef.uid = l.from_uid
         LEFT JOIN entity_registry et ON et.uid = l.to_uid
        WHERE le.status <> 'deleted'
        ORDER BY l.relation_type, from_code, to_code, l.uid`
    )
    .all() as {
    relation_type: string
    from_code: string | null
    to_code: string | null
    review_status: string
    transform_note: string | null
  }[]

  const csv = (v: unknown): string => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
  }
  const md = (v: unknown): string => (v == null ? '' : String(v).replaceAll('|', '\\|').replaceAll('\n', ' '))

  writeFileSync(
    join(outDir, 'elements.csv'),
    [
      'code,category,title,status,description',
      ...elements.map((e) => [e.code, e.design_category, e.title, e.status, e.description].map(csv).join(','))
    ].join('\n') + '\n',
    'utf-8'
  )
  writeFileSync(
    join(outDir, 'elements.md'),
    [
      '# 設計要素一覧',
      '',
      '| code | category | title | status |',
      '| --- | --- | --- | --- |',
      ...elements.map((e) => `| ${e.code} | ${e.design_category} | ${md(e.title)} | ${e.status} |`),
      ''
    ].join('\n'),
    'utf-8'
  )
  writeFileSync(
    join(outDir, 'relations.csv'),
    [
      'relation_type,from,to,review_status,transform_note',
      ...relations.map((r) =>
        [r.relation_type, r.from_code, r.to_code, r.review_status, r.transform_note].map(csv).join(',')
      )
    ].join('\n') + '\n',
    'utf-8'
  )
  writeFileSync(
    join(outDir, 'relations.md'),
    [
      '# 関係一覧',
      '',
      '| relation | from | to | review |',
      '| --- | --- | --- | --- |',
      ...relations.map((r) => `| ${r.relation_type} | ${md(r.from_code)} | ${md(r.to_code)} | ${r.review_status} |`),
      ''
    ].join('\n'),
    'utf-8'
  )

  // トレースマトリクス（既定 REQ 行 × FUNC 列。P9 のマトリクスと同一ロジック）
  const matrix = getTraceMatrix(db, projectUid, 'REQ', 'FUNC')
  const matrixLines = [
    ['', ...matrix.cols.map((c) => c.code)].map(csv).join(','),
    ...matrix.rows.map((row) =>
      [row.code, ...matrix.cols.map((col) => (matrix.cells[row.uid]?.[col.uid] ?? []).join(';'))].map(csv).join(',')
    )
  ]
  writeFileSync(join(outDir, 'matrix_REQ_FUNC.csv'), matrixLines.join('\n') + '\n', 'utf-8')

  return ['elements.csv', 'elements.md', 'relations.csv', 'relations.md', 'matrix_REQ_FUNC.csv']
}

/** SQLite dump（P12-2）: schema.sql / data.sql を exports/sqlite_dump/ へ出力する */
export function exportSqliteDump(db: Database, projectRoot: string): { outDir: string; files: string[] } {
  const outDir = join(projectRoot, 'exports', 'sqlite_dump')
  mkdirSync(outDir, { recursive: true })

  const schemaRows = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY type DESC, name`
    )
    .all() as { sql: string }[]
  writeFileSync(join(outDir, 'schema.sql'), schemaRows.map((r) => `${r.sql};`).join('\n\n') + '\n', 'utf-8')

  const sqlValue = (v: unknown): string => {
    if (v == null) return 'NULL'
    if (typeof v === 'number' || typeof v === 'bigint') return String(v)
    if (Buffer.isBuffer(v)) return `X'${v.toString('hex')}'`
    return `'${String(v).replaceAll("'", "''")}'`
  }
  const lines: string[] = []
  for (const table of listExportTables(db)) {
    const rows = db
      .prepare(`SELECT ${table.columns.map((c) => `"${c}"`).join(', ')} FROM ${table.name} ORDER BY ${table.orderBy}`)
      .all() as Record<string, unknown>[]
    for (const row of rows) {
      lines.push(
        `INSERT INTO ${table.name} (${table.columns.map((c) => `"${c}"`).join(', ')}) VALUES (${table.columns.map((c) => sqlValue(row[c])).join(', ')});`
      )
    }
  }
  writeFileSync(join(outDir, 'data.sql'), lines.join('\n') + '\n', 'utf-8')
  return { outDir, files: ['schema.sql', 'data.sql'] }
}

/** exports/db_to_text の現在のファイル一覧（差分比較・UI 表示用） */
export function listDbToTextFiles(projectRoot: string): string[] {
  try {
    return readdirSync(join(projectRoot, 'exports', 'db_to_text')).sort()
  } catch {
    return []
  }
}
