// T801: レポート出力 — Markdown / HTML

import { getDatabase } from '../db/database'
import fs from 'fs'
import path from 'path'
import { getProjectRoot } from '../project/project-manager'

export interface ReportOptions {
  includeResources?: boolean
  includeTraceLinks?: boolean
  includeGlossary?: boolean
  entityTypes?: string[]
  format?: 'markdown' | 'html'
}

// ---- Markdown 生成 ----------------------------------------------------------

export function generateMarkdownReport(opts: ReportOptions = {}): string {
  const db = getDatabase()
  const lines: string[] = []
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ')

  const project = db.prepare('SELECT * FROM project LIMIT 1').get() as
    | { name: string; schema_version: string }
    | undefined

  lines.push(`# D2D プロジェクトレポート`)
  lines.push(``)
  lines.push(`**プロジェクト**: ${project?.name ?? '—'}  `)
  lines.push(`**生成日時**: ${now}  `)
  lines.push(`**スキーマ**: ${project?.schema_version ?? '—'}`)
  lines.push(``)

  // ---- 設計要素 ----
  if (opts.includeResources !== false) {
    const entityTypes = opts.entityTypes ?? [
      'resource_label', 'resource_text', 'resource_list', 'resource_table',
      'resource_code', 'resource_model', 'resource_scenario', 'resource_interface',
      'resource_state_transition', 'resource_data_structure',
    ]
    const placeholders = entityTypes.map(() => '?').join(',')
    const rows = db.prepare(`
      SELECT code, title, entity_type, status FROM entity_registry
      WHERE entity_type IN (${placeholders}) AND status='active'
      ORDER BY entity_type, code
    `).all(...entityTypes) as Array<{ code: string; title: string; entity_type: string; status: string }>

    lines.push(`## 設計要素 (${rows.length} 件)`)
    lines.push(``)

    let lastType = ''
    for (const r of rows) {
      if (r.entity_type !== lastType) {
        lines.push(`### ${r.entity_type.replace('resource_', '')}`)
        lines.push(``)
        lastType = r.entity_type
      }
      lines.push(`- **${r.code}** ${r.title}`)
    }
    lines.push(``)
  }

  // ---- トレースリンク ----
  if (opts.includeTraceLinks !== false) {
    const links = db.prepare(`
      SELECT
        f.code   AS from_code, f.title AS from_title, f.entity_type AS from_type,
        t.code   AS to_code,   t.title AS to_title,   t.entity_type AS to_type,
        tl.relation_type, tl.confidence
      FROM trace_link tl
      JOIN entity_registry f ON f.uid = tl.from_uid
      JOIN entity_registry t ON t.uid = tl.to_uid
      ORDER BY tl.relation_type, from_code
      LIMIT 500
    `).all() as Array<{
      from_code: string; from_title: string; from_type: string
      to_code: string; to_title: string; to_type: string
      relation_type: string; confidence: number | null
    }>

    lines.push(`## トレースリンク (${links.length} 件)`)
    lines.push(``)
    lines.push(`| 起点 | 関係 | 終点 | 信頼度 |`)
    lines.push(`|------|------|------|--------|`)
    for (const l of links) {
      const conf = l.confidence != null ? l.confidence.toFixed(2) : '—'
      lines.push(`| ${l.from_code} ${l.from_title} | \`${l.relation_type}\` | ${l.to_code} ${l.to_title} | ${conf} |`)
    }
    lines.push(``)
  }

  // ---- 用語集 ----
  if (opts.includeGlossary !== false) {
    const terms = db.prepare(`
      SELECT e.code, g.term_text, g.definition, g.abbreviation, g.is_prohibited, g.confirmed_at
      FROM resource_glossary g
      JOIN entity_registry e ON e.uid = g.uid
      ORDER BY g.term_text
    `).all() as Array<{
      code: string; term_text: string; definition: string | null
      abbreviation: string | null; is_prohibited: number; confirmed_at: string | null
    }>

    lines.push(`## 用語集 (${terms.length} 件)`)
    lines.push(``)
    for (const t of terms) {
      const flags = [
        t.abbreviation ? `略: ${t.abbreviation}` : null,
        t.is_prohibited ? '⛔禁止語' : null,
        t.confirmed_at ? '✅確認済' : null,
      ].filter(Boolean).join(' · ')
      lines.push(`### ${t.code} ${t.term_text}${flags ? `  \n_${flags}_` : ''}`)
      if (t.definition) lines.push(``)
      if (t.definition) lines.push(t.definition)
      lines.push(``)
    }
  }

  return lines.join('\n')
}

// ---- HTML 生成（最小限スタイル付き） ----------------------------------------

export function generateHtmlReport(opts: ReportOptions = {}): string {
  const md = generateMarkdownReport(opts)
  const escaped = md
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // 見出し
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    // 太字
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // コード
    .replace(/`(.+?)`/g, '<code>$1</code>')
    // テーブル行
    .replace(/^\|(.+)\|$/gm, (_m, cells: string) => {
      const tds = cells.split('|').map((c) => `<td>${c.trim()}</td>`).join('')
      return `<tr>${tds}</tr>`
    })
    // リスト
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    // 改行
    .replace(/\n/g, '\n')

  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>D2D Report</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 960px; margin: 0 auto; padding: 32px; color: #111; }
  h1 { border-bottom: 2px solid #2563eb; padding-bottom: 8px; }
  h2 { border-bottom: 1px solid #e0e0e0; margin-top: 32px; }
  h3 { margin-top: 20px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #e0e0e0; padding: 6px 10px; }
  tr:nth-child(even) { background: #f9fafb; }
  code { background: #f3f4f6; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; }
  li { margin: 2px 0; }
</style>
</head>
<body>
<pre style="white-space:pre-wrap;font-family:inherit">${escaped}</pre>
</body>
</html>`
}

// ---- ファイル保存 -----------------------------------------------------------

export function saveReport(content: string, filename: string): string {
  const projectRoot = getProjectRoot()
  const dir = path.join(projectRoot, 'exports', 'reports')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}
