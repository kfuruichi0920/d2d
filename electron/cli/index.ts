#!/usr/bin/env node
// T805: D2D CLI インターフェース
// 使用例:
//   node dist/cli/index.js version
//   node dist/cli/index.js db-to-text --project /path/to/project.d2d
//   node dist/cli/index.js zip --project /path/to/project.d2d --label backup
//   node dist/cli/index.js terms --project /path/to/project.d2d --search API
//   node dist/cli/index.js query --project /path/to/project.d2d --sql "SELECT * FROM entity_registry LIMIT 10"

import path from 'path'
import fs from 'fs'

const args = process.argv.slice(2)
const command = args[0] ?? 'help'

function parseArgs(argv: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      result[argv[i].slice(2)] = argv[i + 1]
      i++
    }
  }
  return result
}

function getProjectPath(opts: Record<string, string>): string {
  const p = opts['project'] ?? process.env['D2D_PROJECT'] ?? ''
  if (!p) {
    console.error('Error: --project <path/to/project.d2d> が必要です')
    process.exit(1)
  }
  return path.resolve(p)
}

function openDb(projectPath: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  const dbPath = path.join(projectPath, 'project.db')
  if (!fs.existsSync(dbPath)) {
    console.error(`Error: ${dbPath} が存在しません`)
    process.exit(1)
  }
  return new Database(dbPath, { readonly: true })
}

const opts = parseArgs(args.slice(1))

switch (command) {
  case 'version': {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pkg = require('../../package.json') as { version: string }
    console.log(`d2d v${pkg.version}`)
    break
  }

  case 'query': {
    const projectPath = getProjectPath(opts)
    const sql = opts['sql']
    if (!sql) { console.error('Error: --sql "SELECT ..." が必要です'); process.exit(1) }
    if (!/^\s*SELECT\b/i.test(sql)) { console.error('Error: SELECT 文のみ使用できます'); process.exit(1) }
    const db = openDb(projectPath)
    const rows = db.prepare(sql).all()
    console.log(JSON.stringify(rows, null, 2))
    db.close()
    break
  }

  case 'terms': {
    const projectPath = getProjectPath(opts)
    const search = opts['search'] ?? ''
    const db = openDb(projectPath)
    const rows = db.prepare(`
      SELECT e.code, g.term_text, g.definition, g.abbreviation
      FROM resource_glossary g
      JOIN entity_registry e ON e.uid=g.uid
      WHERE e.status='active'
      ${search ? "AND (g.term_text LIKE ? OR g.definition LIKE ?)" : ''}
      ORDER BY g.term_text
    `).all(...(search ? [`%${search}%`, `%${search}%`] : []))
    if (opts['format'] === 'json') {
      console.log(JSON.stringify(rows, null, 2))
    } else {
      for (const r of rows as Array<{ code: string; term_text: string; definition: string | null; abbreviation: string | null }>) {
        console.log(`${r.code}\t${r.term_text}${r.abbreviation ? ` (${r.abbreviation})` : ''}\t${r.definition?.slice(0, 80) ?? ''}`)
      }
    }
    db.close()
    break
  }

  case 'db-to-text': {
    const projectPath = getProjectPath(opts)
    console.log(`DB to Text: ${projectPath}`)
    const db = openDb(projectPath)
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name)
    const outDir = path.join(projectPath, 'exports', 'db_to_text')
    fs.mkdirSync(outDir, { recursive: true })
    let total = 0
    for (const table of tables) {
      const rows = db.prepare(`SELECT * FROM ${table}`).all()
      const jsonl = rows.map((r) => JSON.stringify(r)).join('\n')
      fs.writeFileSync(path.join(outDir, `${table}.jsonl`), jsonl, 'utf-8')
      total += rows.length
      console.log(`  ${table}: ${rows.length} 行`)
    }
    db.close()
    console.log(`完了: ${tables.length} テーブル, ${total} 行 → ${outDir}`)
    break
  }

  case 'help':
  default: {
    console.log(`
D2D CLI

使用法: d2d <command> [options]

コマンド:
  version                          バージョンを表示
  query --project <path> --sql <SQL>   SELECT クエリを実行して JSON 出力
  terms --project <path> [--search <keyword>] [--format json]
                                   用語集を検索・出力
  db-to-text --project <path>      全テーブルを JSONL に出力
  help                             このヘルプを表示

環境変数:
  D2D_PROJECT  --project のデフォルト値
`)
    break
  }
}
