/**
 * レポート出力（P13、EXP-001〜006）。
 * ②抽出データ（原本由来情報）・③中間データ（本文・章構成・図表）・④設計モデル
 * （要素・関係）から文書風レポートを構築し、Markdown / HTML で exports/reports/ へ
 * 出力する。出力は派生成果物であり DB 正本を置き換えない。
 */
import type { Database } from 'better-sqlite3'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { marked } from 'marked'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'
import type { IntermediateStructure } from '../intermediate/intermediate-service'

export type ReportFormat = 'markdown' | 'html'

/** EXP-003/004: 出力対象のフィルタ・範囲・表示/非表示 */
export interface ReportOptions {
  format: ReportFormat
  /** 表示/非表示（EXP-004）。省略時はすべて出力 */
  sections?: {
    sources?: boolean
    intermediate?: boolean
    design?: boolean
    relations?: boolean
  }
  filters?: {
    /** ③の成果物種別 ID（design_doc 等） */
    artifactTypeId?: string
    /** ③の章・節（section_path 前方一致） */
    sectionPath?: string
    /** ③の情報種別（heading/paragraph/list_item/table/figure/caption） */
    infoTypes?: string[]
    /** ④の設計観点（13分類） */
    categories?: string[]
    /** レビュー状態（entity_registry.status: draft/approved 等） */
    status?: string
    /** 設計要素コード（REQ-000001 等。指定時は④をこの集合に限定） */
    elementCodes?: string[]
  }
  /** LLM 要約を冒頭へ挿入する（任意機能。ジョブ側で生成して渡す） */
  summaryText?: string
  /** タイトル（省略時はプロジェクト名から生成） */
  title?: string
}

export interface ReportBuildResult {
  markdown: string
  stats: {
    sourceDocuments: number
    intermediateDocuments: number
    designElements: number
    relations: number
  }
}

const md = (v: unknown): string =>
  v == null ? '' : String(v).replaceAll('|', '\\|').replaceAll('\r\n', ' ').replaceAll('\n', ' ')

/** ②③④からの文書風レポート本文（Markdown）を構築する（EXP-001/002/003/004） */
export function buildReportMarkdown(db: Database, projectUid: string, options: ReportOptions): ReportBuildResult {
  const sections = {
    sources: options.sections?.sources ?? true,
    intermediate: options.sections?.intermediate ?? true,
    design: options.sections?.design ?? true,
    relations: options.sections?.relations ?? true
  }
  const filters = options.filters ?? {}

  const project = db.prepare(`SELECT name FROM project`).get() as { name: string }
  const lines: string[] = [`# ${options.title ?? `設計レポート: ${project.name}`}`, '']

  if (options.summaryText) {
    lines.push('> **LLM 要約（候補・未確定）**', ...options.summaryText.split('\n').map((l) => `> ${l}`), '')
  }

  // ---- ② 原本・抽出データ（EXP-002: 原本由来情報） ----
  const sourceRows = db
    .prepare(
      `SELECT e.code, e.status, s.file_name, s.file_hash, s.imported_at,
              x.uid AS extracted_uid, xe.code AS extracted_code, xe.status AS extracted_status,
              x.extractor_name, x.extractor_version
         FROM source_document s
         JOIN entity_registry e ON e.uid = s.uid
         LEFT JOIN extracted_document x ON x.source_document_uid = s.uid
         LEFT JOIN entity_registry xe ON xe.uid = x.uid
        WHERE e.project_uid = ? AND e.status <> 'deleted'
        ORDER BY e.code, xe.code`
    )
    .all(projectUid) as {
    code: string
    status: string
    file_name: string
    file_hash: string
    imported_at: string
    extracted_code: string | null
    extracted_status: string | null
    extractor_name: string | null
    extractor_version: string | null
  }[]
  if (sections.sources) {
    lines.push('## ① 原本 / ② 抽出データ（由来情報）', '')
    if (sourceRows.length === 0) {
      lines.push('（原本はありません）', '')
    } else {
      lines.push(
        '| 原本 | ファイル | ハッシュ | 取込日時 | ②抽出 | 抽出器 | 状態 |',
        '| --- | --- | --- | --- | --- | --- | --- |',
        ...sourceRows.map(
          (s) =>
            `| ${s.code} | ${md(s.file_name)} | \`${s.file_hash.slice(0, 12)}…\` | ${s.imported_at} | ` +
            `${s.extracted_code ?? '—'} | ${md(s.extractor_name ?? '')} ${md(s.extractor_version ?? '')} | ${s.extracted_status ?? '—'} |`
        ),
        ''
      )
    }
  }

  // ---- ③ 中間データ（EXP-002: 本文・章構成・図表。EXP-003: 成果物/章節/情報種別） ----
  const intermediateParams: unknown[] = [projectUid]
  let intermediateWhere = `e.project_uid = ? AND e.status <> 'deleted'`
  if (filters.status) {
    intermediateWhere += ` AND e.status = ?`
    intermediateParams.push(filters.status)
  }
  if (filters.artifactTypeId) {
    intermediateWhere += ` AND i.artifact_type_id = ?`
    intermediateParams.push(filters.artifactTypeId)
  }
  const intermediateDocs = db
    .prepare(
      `SELECT i.uid, e.code, e.title, e.status, i.artifact_type_id, i.dev_phase_id, i.structure_json
         FROM intermediate_document i JOIN entity_registry e ON e.uid = i.uid
        WHERE ${intermediateWhere} ORDER BY e.code`
    )
    .all(...intermediateParams) as {
    uid: string
    code: string
    title: string | null
    status: string
    artifact_type_id: string
    dev_phase_id: string
    structure_json: string
  }[]

  let intermediateCount = 0
  if (sections.intermediate) {
    lines.push('## ③ 中間データ（文書風表示）', '')
    for (const doc of intermediateDocs) {
      intermediateCount++
      lines.push(
        `### ${doc.code} ${md(doc.title ?? '')}`,
        '',
        `- 成果物種別: ${doc.artifact_type_id} / フェーズ: ${doc.dev_phase_id} / レビュー状態: ${doc.status}`,
        ''
      )
      const structure = JSON.parse(doc.structure_json) as IntermediateStructure
      for (const element of structure.elements) {
        // EXP-003: 章・節（前方一致）と情報種別のフィルタ
        if (filters.sectionPath && !(element.section_path ?? '').startsWith(filters.sectionPath)) continue
        if (filters.infoTypes && filters.infoTypes.length > 0 && !filters.infoTypes.includes(element.type)) continue

        switch (element.type) {
          case 'heading':
            lines.push(`${'#'.repeat(Math.min((element.level ?? 1) + 3, 6))} ${md(element.text ?? '')}`, '')
            break
          case 'paragraph':
          case 'caption':
            lines.push(element.text ?? '', '')
            break
          case 'list_item':
            lines.push(`- ${md(element.text ?? '')}`)
            break
          case 'table': {
            const rows = element.rows ?? []
            if (rows.length > 0) {
              const header = rows[0]!.map((c) => md(c.text))
              lines.push(
                `| ${header.join(' | ')} |`,
                `| ${header.map(() => '---').join(' | ')} |`,
                ...rows.slice(1).map((r) => `| ${r.map((c) => md(c.text)).join(' | ')} |`),
                ''
              )
            }
            break
          }
          case 'figure':
            lines.push(`（図: ${md(element.caption ?? element.image ?? element.id)}）`, '')
            break
        }
      }
      lines.push('')
    }
    if (intermediateCount === 0) lines.push('（対象の③中間データはありません）', '')
  }

  // ---- ④ 設計モデル（EXP-002: 設計要素・関係。EXP-003: 設計観点/状態/要素コード） ----
  const elementParams: unknown[] = [projectUid]
  let elementWhere = `e.project_uid = ? AND e.entity_type LIKE 'model_%' AND e.status <> 'deleted'`
  if (filters.categories && filters.categories.length > 0) {
    elementWhere += ` AND e.entity_type IN (${filters.categories.map(() => '?').join(',')})`
    elementParams.push(...filters.categories)
  }
  if (filters.status) {
    elementWhere += ` AND e.status = ?`
    elementParams.push(filters.status)
  }
  if (filters.elementCodes && filters.elementCodes.length > 0) {
    elementWhere += ` AND e.code IN (${filters.elementCodes.map(() => '?').join(',')})`
    elementParams.push(...filters.elementCodes)
  }
  const elementRows = db
    .prepare(
      `SELECT e.uid, e.code, e.entity_type AS model_type, e.title, e.status
       FROM entity_registry e WHERE ${elementWhere} ORDER BY e.entity_type, e.code`
    )
    .all(...elementParams) as { uid: string; code: string; model_type: string; title: string | null; status: string }[]
  const elements = elementRows.map((row) => {
    const detail = db.prepare(`SELECT summary FROM "${row.model_type}" WHERE uid=?`).get(row.uid) as
      { summary: string } | undefined
    return { ...row, description: detail?.summary ?? null }
  })

  if (sections.design) {
    lines.push('## ④ 設計モデル（設計要素）', '')
    if (elements.length === 0) {
      lines.push('（対象の設計要素はありません）', '')
    } else {
      let currentCategory = ''
      for (const el of elements) {
        if (el.model_type !== currentCategory) {
          currentCategory = el.model_type
          lines.push(`### ${currentCategory}`, '')
        }
        lines.push(`#### ${el.code} ${md(el.title ?? '')}`, '', `- レビュー状態: ${el.status}`, '')
        if (el.description) lines.push(el.description, '')
      }
    }
  }

  // 関係一覧は④の対象集合に絞る（フィルタ指定時、EXP-003 の設計要素条件が関係にも効く）
  const elementUids = new Set(elements.map((e) => e.uid))
  const relations = (
    db
      .prepare(
        `SELECT l.relation_type, ef.code AS from_code, et.code AS to_code, l.review_status, l.rationale,
                l.from_uid, l.to_uid
           FROM trace_link l
           JOIN entity_registry le ON le.uid = l.uid AND le.status <> 'deleted'
           LEFT JOIN entity_registry ef ON ef.uid = l.from_uid
           LEFT JOIN entity_registry et ON et.uid = l.to_uid
          WHERE le.project_uid = ? AND l.relation_type <> 'based_on'
          ORDER BY l.relation_type, from_code, to_code`
      )
      .all(projectUid) as {
      relation_type: string
      from_code: string | null
      to_code: string | null
      review_status: string
      rationale: string | null
      from_uid: string
      to_uid: string
    }[]
  ).filter((r) => elementUids.has(r.from_uid) || elementUids.has(r.to_uid))

  if (sections.relations) {
    lines.push('## 関係一覧', '')
    if (relations.length === 0) {
      lines.push('（対象の関係はありません）', '')
    } else {
      lines.push(
        '| 関係 | from | to | レビュー | 根拠 |',
        '| --- | --- | --- | --- | --- |',
        ...relations.map(
          (r) =>
            `| ${r.relation_type} | ${r.from_code ?? '?'} | ${r.to_code ?? '?'} | ${r.review_status} | ${md(r.rationale ?? '')} |`
        ),
        ''
      )
    }
  }

  return {
    markdown: lines.join('\n'),
    stats: {
      sourceDocuments: sourceRows.length,
      intermediateDocuments: intermediateCount,
      designElements: elements.length,
      relations: relations.length
    }
  }
}

/** HTML 出力（EXP-006）。オフライン前提の自己完結 HTML（外部参照なし） */
export function renderReportHtml(markdown: string, title: string): string {
  const body = marked.parse(markdown, { async: false })
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<title>${title.replaceAll('<', '&lt;')}</title>
<style>
body { font-family: "Yu Gothic UI", "Meiryo", sans-serif; max-width: 900px; margin: 24px auto; padding: 0 16px; line-height: 1.7; color: #222; }
h1 { border-bottom: 2px solid #345; padding-bottom: 6px; }
h2 { border-bottom: 1px solid #9ab; padding-bottom: 4px; margin-top: 32px; }
table { border-collapse: collapse; margin: 8px 0; }
th, td { border: 1px solid #bbb; padding: 4px 10px; font-size: 14px; }
th { background: #eef2f6; }
blockquote { border-left: 4px solid #9ab; margin: 8px 0; padding: 4px 12px; color: #446; background: #f4f7fa; }
code { background: #f0f0f0; padding: 1px 4px; border-radius: 3px; }
</style>
</head>
<body>
${body}
</body>
</html>
`
}

export interface GenerateReportResult {
  fileName: string
  relPath: string
  format: ReportFormat
  stats: ReportBuildResult['stats']
}

/** レポートを生成して exports/reports/ へ保存する（EXP-005/006、report.generated） */
export function generateReport(
  db: Database,
  projectUid: string,
  projectRoot: string,
  options: ReportOptions
): GenerateReportResult {
  const built = buildReportMarkdown(db, projectUid, options)
  const title = options.title ?? 'design-report'
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-').slice(0, 19)
  const ext = options.format === 'html' ? 'html' : 'md'
  const fileName = `report_${stamp}.${ext}`
  const dir = join(projectRoot, 'exports', 'reports')
  mkdirSync(dir, { recursive: true })
  const content = options.format === 'html' ? renderReportHtml(built.markdown, title) : built.markdown
  writeFileSync(join(dir, fileName), content, 'utf-8')

  const result: GenerateReportResult = {
    fileName,
    relPath: join('exports', 'reports', fileName),
    format: options.format,
    stats: built.stats
  }
  eventBus.emit('report.generated', result)
  return result
}

export interface ReportListItem {
  fileName: string
  format: ReportFormat
  size: number
  modifiedAt: string
}

export function listReports(projectRoot: string): ReportListItem[] {
  const dir = join(projectRoot, 'exports', 'reports')
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') || f.endsWith('.html'))
    .map((f) => {
      const st = statSync(join(dir, f))
      return {
        fileName: f,
        format: (f.endsWith('.html') ? 'html' : 'markdown') as ReportFormat,
        size: st.size,
        modifiedAt: st.mtime.toISOString()
      }
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export function getReportContent(
  projectRoot: string,
  fileName: string
): { fileName: string; format: ReportFormat; content: string } {
  const name = basename(fileName)
  const path = join(projectRoot, 'exports', 'reports', name)
  if (!existsSync(path)) {
    throw new BackendError('not_found', `レポートが見つかりません: ${name}`, '')
  }
  return {
    fileName: name,
    format: name.endsWith('.html') ? 'html' : 'markdown',
    content: readFileSync(path, 'utf-8')
  }
}
