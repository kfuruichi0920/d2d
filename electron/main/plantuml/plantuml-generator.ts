// T806: PlantUML / SysMLv2 生成

import { getDatabase } from '../db/database'
import fs from 'fs'
import path from 'path'
import { getProjectRoot } from '../project/project-manager'

// ---- 状態遷移図（PlantUML state diagram） ------------------------------------

export function generateStateDiagram(stateTransitionUid: string): string {
  const db = getDatabase()
  const entity = db.prepare('SELECT code, title FROM entity_registry WHERE uid=?').get(stateTransitionUid) as
    | { code: string; title: string } | undefined

  const row = db.prepare('SELECT * FROM resource_state_transition WHERE uid=?').get(stateTransitionUid) as
    | { states_json?: string; transitions_json?: string; initial_state?: string } | undefined

  if (!row) return `' 状態遷移データが見つかりません: ${stateTransitionUid}`

  const states: string[] = row.states_json ? (JSON.parse(row.states_json) as string[]) : []
  const transitions: Array<{ from: string; to: string; trigger: string; guard?: string; action?: string }> =
    row.transitions_json ? (JSON.parse(row.transitions_json) as typeof transitions) : []

  const lines: string[] = [
    `@startuml`,
    `title ${entity?.title ?? stateTransitionUid}`,
    ``,
    `[*] --> ${row.initial_state ?? (states[0] ?? 'Start')}`,
  ]

  for (const s of states) {
    lines.push(`state "${s}" as ${sanitizeId(s)}`)
  }

  for (const t of transitions) {
    const label = [t.trigger, t.guard ? `[${t.guard}]` : null, t.action ? `/ ${t.action}` : null]
      .filter(Boolean).join(' ')
    lines.push(`${sanitizeId(t.from)} --> ${sanitizeId(t.to)} : ${label}`)
  }

  lines.push(`@enduml`)
  return lines.join('\n')
}

// ---- クラス図（resource_data_structure から） --------------------------------

export function generateClassDiagram(): string {
  const db = getDatabase()
  const structs = db.prepare(`
    SELECT e.uid, e.code, e.title, ds.fields_json
    FROM resource_data_structure ds
    JOIN entity_registry e ON e.uid = ds.uid
    WHERE e.status='active'
    ORDER BY e.code
  `).all() as Array<{ uid: string; code: string; title: string; fields_json: string | null }>

  const lines = [`@startuml`, `skinparam classAttributeIconSize 0`, ``]

  for (const s of structs) {
    const fields: Array<{ name: string; type?: string; required?: boolean }> =
      s.fields_json ? (JSON.parse(s.fields_json) as typeof fields) : []
    lines.push(`class "${s.title}" as ${sanitizeId(s.code)} {`)
    for (const f of fields) {
      lines.push(`  ${f.required ? '+' : '-'}${f.name}${f.type ? ` : ${f.type}` : ''}`)
    }
    lines.push(`}`)
  }

  // トレースリンク → 依存矢印
  const links = db.prepare(`
    SELECT f.code fc, t.code tc, tl.relation_type
    FROM trace_link tl
    JOIN entity_registry f ON f.uid=tl.from_uid AND f.entity_type='resource_data_structure'
    JOIN entity_registry t ON t.uid=tl.to_uid   AND t.entity_type='resource_data_structure'
    WHERE f.status='active' AND t.status='active'
  `).all() as Array<{ fc: string; tc: string; relation_type: string }>

  for (const l of links) {
    lines.push(`${sanitizeId(l.fc)} ..> ${sanitizeId(l.tc)} : ${l.relation_type}`)
  }

  lines.push(`@enduml`)
  return lines.join('\n')
}

// ---- 要素 ID 対応表（Markdown） ----------------------------------------------

export function generateIdMap(): string {
  const db = getDatabase()
  const rows = db.prepare(`
    SELECT code, title, entity_type, uid
    FROM entity_registry
    WHERE status='active' AND entity_type LIKE 'resource_%'
    ORDER BY entity_type, code
  `).all() as Array<{ code: string; title: string; entity_type: string; uid: string }>

  const lines = [
    `# 設計要素 ID 対応表`,
    ``,
    `| コード | タイトル | 種別 | UID |`,
    `|--------|----------|------|-----|`,
  ]
  for (const r of rows) {
    lines.push(`| ${r.code} | ${r.title} | ${r.entity_type.replace('resource_', '')} | \`${r.uid}\` |`)
  }
  return lines.join('\n')
}

// ---- Kroki URL 生成 ---------------------------------------------------------

export function toKrokiUrl(puml: string): string {
  const encoded = Buffer.from(puml, 'utf-8').toString('base64url')
  return `https://kroki.io/plantuml/svg/${encoded}`
}

// ---- ファイル保存 -----------------------------------------------------------

export function savePuml(content: string, filename: string): string {
  const dir = path.join(getProjectRoot(), 'exports', 'plantuml')
  fs.mkdirSync(dir, { recursive: true })
  const filePath = path.join(dir, filename)
  fs.writeFileSync(filePath, content, 'utf-8')
  return filePath
}

// ---- helper -----------------------------------------------------------------

function sanitizeId(s: string): string {
  return s.replace(/[^A-Za-z0-9_]/g, '_')
}
