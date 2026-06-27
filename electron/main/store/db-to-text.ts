import { getDatabase } from '../db/database'
import { getCurrentProjectRoot } from '../project/project-manager'
import { join } from 'path'
import { mkdirSync, writeFileSync, existsSync } from 'fs'

// DB to Text 出力対象テーブル（Git diff 主媒体）
const TEXT_TABLES = [
  'entity_registry',
  'source_document',
  'blob_resource',
  'extracted_document',
  'extracted_item',
  'intermediate_document',
  'intermediate_item',
  'chunk',
  'chunk_item',
  'resource_label',
  'resource_text',
  'resource_list',
  'resource_figure',
  'resource_table',
  'resource_formula',
  'resource_code',
  'resource_model',
  'resource_scenario',
  'resource_interface',
  'resource_state_transition',
  'resource_data_structure',
  'resource_reference',
  'resource_metadata',
  'resource_glossary',
  'resource_glossary_synonym',
  'trace_link',
  'llm_run_ref',
  'project_artifact_setting',
] as const

export interface DbToTextResult {
  outputDir: string
  tableCount: number
  totalRows: number
  manifestPath: string
}

export function generateDbToText(): DbToTextResult {
  const root = getCurrentProjectRoot()
  if (!root) throw new Error('プロジェクトが開かれていません')

  const db = getDatabase()
  const outputDir = join(root, 'exports', 'db_to_text')
  if (!existsSync(outputDir)) mkdirSync(outputDir, { recursive: true })

  let totalRows = 0
  const manifest: Record<string, { rowCount: number; file: string }> = {}

  for (const table of TEXT_TABLES) {
    try {
      const rows = db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[]
      const jsonl = rows.map((r) => JSON.stringify(r)).join('\n')
      const fileName = `${table}.jsonl`
      writeFileSync(join(outputDir, fileName), jsonl, 'utf-8')
      manifest[table] = { rowCount: rows.length, file: fileName }
      totalRows += rows.length
    } catch {
      // テーブルが存在しない場合は skip
    }
  }

  const manifestPath = join(root, 'exports', 'manifest', 'db_to_text_manifest.json')
  const manifestDir = join(root, 'exports', 'manifest')
  if (!existsSync(manifestDir)) mkdirSync(manifestDir, { recursive: true })

  writeFileSync(
    manifestPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        tables: manifest,
        total_rows: totalRows,
      },
      null,
      2
    ),
    'utf-8'
  )

  return { outputDir, tableCount: TEXT_TABLES.length, totalRows, manifestPath }
}

export function generateSqliteDump(): { schemaPath: string; dataPath: string } {
  const root = getCurrentProjectRoot()
  if (!root) throw new Error('プロジェクトが開かれていません')

  const db = getDatabase()
  const dumpDir = join(root, 'exports', 'sqlite_dump')
  if (!existsSync(dumpDir)) mkdirSync(dumpDir, { recursive: true })

  // スキーマ
  const schemaSql = (
    db
      .prepare(`SELECT sql FROM sqlite_master WHERE type IN ('table','index','view') AND sql IS NOT NULL ORDER BY type, name`)
      .all() as { sql: string }[]
  )
    .map((r) => r.sql + ';')
    .join('\n\n')

  const schemaPath = join(dumpDir, 'schema.sql')
  writeFileSync(schemaPath, schemaSql, 'utf-8')

  // データ（INSERT 形式）
  const tables = (
    db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[]
  ).map((r) => r.name)

  const dataLines: string[] = []
  for (const table of tables) {
    const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
    if (rows.length === 0) continue
    dataLines.push(`-- ${table}`)
    for (const row of rows) {
      const cols = Object.keys(row)
        .map((c) => `"${c}"`)
        .join(', ')
      const vals = Object.values(row)
        .map((v) =>
          v === null ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
        )
        .join(', ')
      dataLines.push(`INSERT INTO "${table}" (${cols}) VALUES (${vals});`)
    }
  }

  const dataPath = join(dumpDir, 'data.sql')
  writeFileSync(dataPath, dataLines.join('\n'), 'utf-8')

  return { schemaPath, dataPath }
}
