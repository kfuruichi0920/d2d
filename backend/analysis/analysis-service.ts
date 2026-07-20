/**
 * 設計分析機能（ANA-001〜006）。
 * オントロジーの推論規則の考え方に基づき、設計モデルの要素・関係定義へ
 * あらかじめ定義したクエリ規則（DSL）を適用し、影響確認範囲や意味的経路を
 * 決定論的に導出する。実行過程（各ステップの入出力）も記録し、レポートへ出力する。
 *
 * - ANA-001: クエリ規則 DSL（行ベース。FROM / TRAVERSE / FILTER / PATH、# コメント）
 * - ANA-002: 影響分析（TRAVERSE の連続適用による影響範囲の自動抽出）
 * - ANA-003: 経路検索（PATH。二要素間の意味的経路の列挙）
 * - ANA-006: 分析過程を含む Markdown レポート出力（exports/reports/、report:// で閲覧）
 *
 * DSL 仕様（キーワードは大文字小文字非区別、1行1命令）:
 *   FROM TYPE <model_req,...|*>            集合へ指定種別の全要素を追加（起点不要クエリ用）
 *   TRAVERSE <rel,...|*> <UP|DOWN|BOTH> [DEPTH n]
 *                                          集合の各要素から関係を辿り、到達要素を集合へ追加
 *                                          （DOWN=from→to 下流 / UP=to→from 上流）
 *   FILTER TYPE <types> / FILTER STATUS <statuses>
 *                                          集合を種別・状態で絞り込む
 *   PATH <rel,...|*> [MAXDEPTH n] [LIMIT m]
 *                                          起点→終点の意味的経路を列挙（方向自由、既定 6 / 50）
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'

// ---- DSL パーサ（ANA-001） ----

export type AnalysisDirection = 'up' | 'down' | 'both'

export type AnalysisCommand =
  | { kind: 'from'; line: number; text: string; types: string[] | '*' }
  | {
      kind: 'traverse'
      line: number
      text: string
      relations: string[] | '*'
      direction: AnalysisDirection
      depth: number
    }
  | { kind: 'filter'; line: number; text: string; target: 'type' | 'status'; values: string[] }
  | { kind: 'path'; line: number; text: string; relations: string[] | '*'; maxDepth: number; limit: number }

export interface DslValidation {
  ok: boolean
  errors: { line: number; message: string }[]
  /** TRAVERSE があり FROM TYPE がない場合は起点必須。PATH があれば起点・終点とも必須 */
  requiresStart: boolean
  requiresEnd: boolean
  commands: AnalysisCommand[]
}

const MAX_DEPTH = 10
const MAX_PATH_LIMIT = 200

function parseList(token: string): string[] | '*' {
  if (token === '*') return '*'
  return token
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean)
}

/** DSL を解析する。エラーがあっても解析可能な行は commands へ含める */
export function parseAnalysisDsl(dsl: string): DslValidation {
  const errors: { line: number; message: string }[] = []
  const commands: AnalysisCommand[] = []
  const lines = dsl.split(/\r?\n/)
  lines.forEach((raw, index) => {
    const line = index + 1
    const text = raw.replace(/#.*$/, '').trim()
    if (!text) return
    const tokens = text.split(/\s+/)
    const keyword = tokens[0]!.toUpperCase()
    if (keyword === 'FROM') {
      if (tokens[1]?.toUpperCase() !== 'TYPE' || !tokens[2]) {
        errors.push({ line, message: 'FROM TYPE <種別,...|*> の形式で指定してください' })
        return
      }
      commands.push({ kind: 'from', line, text, types: parseList(tokens[2]) })
      return
    }
    if (keyword === 'TRAVERSE') {
      const relations = tokens[1] ? parseList(tokens[1]) : []
      const directionToken = (tokens[2] ?? '').toUpperCase()
      const direction: AnalysisDirection | null =
        directionToken === 'UP' ? 'up' : directionToken === 'DOWN' ? 'down' : directionToken === 'BOTH' ? 'both' : null
      if (!tokens[1] || relations.length === 0 || !direction) {
        errors.push({ line, message: 'TRAVERSE <関係,...|*> <UP|DOWN|BOTH> [DEPTH n] の形式で指定してください' })
        return
      }
      let depth = 1
      if (tokens[3] !== undefined) {
        if (tokens[3].toUpperCase() !== 'DEPTH' || !tokens[4] || !/^\d+$/.test(tokens[4])) {
          errors.push({ line, message: 'DEPTH には 1〜10 の整数を指定してください' })
          return
        }
        depth = Number(tokens[4])
      }
      if (depth < 1 || depth > MAX_DEPTH) {
        errors.push({ line, message: `DEPTH は 1〜${MAX_DEPTH} で指定してください` })
        return
      }
      commands.push({ kind: 'traverse', line, text, relations, direction, depth })
      return
    }
    if (keyword === 'FILTER') {
      const target = (tokens[1] ?? '').toUpperCase()
      if ((target !== 'TYPE' && target !== 'STATUS') || !tokens[2]) {
        errors.push({
          line,
          message: 'FILTER TYPE <種別,...> または FILTER STATUS <状態,...> の形式で指定してください'
        })
        return
      }
      const values = parseList(tokens[2])
      if (values === '*' || values.length === 0) {
        errors.push({ line, message: 'FILTER の値はカンマ区切りで1件以上指定してください（* は不可）' })
        return
      }
      commands.push({ kind: 'filter', line, text, target: target === 'TYPE' ? 'type' : 'status', values })
      return
    }
    if (keyword === 'PATH') {
      const relations = tokens[1] ? parseList(tokens[1]) : []
      if (!tokens[1] || relations.length === 0) {
        errors.push({ line, message: 'PATH <関係,...|*> [MAXDEPTH n] [LIMIT m] の形式で指定してください' })
        return
      }
      let maxDepth = 6
      let limit = 50
      for (let i = 2; i < tokens.length; i += 2) {
        const option = tokens[i]!.toUpperCase()
        const value = tokens[i + 1]
        if (!value || !/^\d+$/.test(value)) {
          errors.push({ line, message: `${option} には整数を指定してください` })
          return
        }
        if (option === 'MAXDEPTH') maxDepth = Number(value)
        else if (option === 'LIMIT') limit = Number(value)
        else {
          errors.push({ line, message: `不明なオプションです: ${tokens[i]}` })
          return
        }
      }
      if (maxDepth < 1 || maxDepth > MAX_DEPTH) {
        errors.push({ line, message: `MAXDEPTH は 1〜${MAX_DEPTH} で指定してください` })
        return
      }
      if (limit < 1 || limit > MAX_PATH_LIMIT) {
        errors.push({ line, message: `LIMIT は 1〜${MAX_PATH_LIMIT} で指定してください` })
        return
      }
      commands.push({ kind: 'path', line, text, relations, maxDepth, limit })
      return
    }
    errors.push({ line, message: `不明な命令です: ${tokens[0]}（FROM / TRAVERSE / FILTER / PATH）` })
  })

  if (commands.length === 0 && errors.length === 0) {
    errors.push({ line: 1, message: 'クエリ規則が空です。1行以上の命令を定義してください' })
  }
  const hasPath = commands.some((command) => command.kind === 'path')
  const hasFrom = commands.some((command) => command.kind === 'from')
  const hasTraverse = commands.some((command) => command.kind === 'traverse')
  return {
    ok: errors.length === 0,
    errors,
    requiresStart: hasPath || (hasTraverse && !hasFrom),
    requiresEnd: hasPath,
    commands
  }
}

/** 関係種別・設計モデル種別を DB 定義と照合する（ANA-001。未定義名は検証エラー） */
export function validateAgainstOntology(db: Database, validation: DslValidation): DslValidation {
  const relationTypes = new Set(
    (db.prepare(`SELECT relation_type FROM ontology_relation_definition`).all() as { relation_type: string }[]).map(
      (row) => row.relation_type
    )
  )
  const errors = [...validation.errors]
  for (const command of validation.commands) {
    if ((command.kind === 'traverse' || command.kind === 'path') && command.relations !== '*') {
      for (const relation of command.relations) {
        if (!relationTypes.has(relation)) {
          errors.push({ line: command.line, message: `未定義の関係種別です: ${relation}` })
        }
      }
    }
  }
  return { ...validation, ok: errors.length === 0, errors }
}

// ---- 実行エンジン（ANA-002/003） ----

interface GraphNode {
  uid: string
  code: string
  title: string | null
  entity_type: string
  status: string
}

interface GraphEdge {
  from_uid: string
  to_uid: string
  relation_type: string
}

export interface AnalysisStepRecord {
  line: number
  text: string
  kind: AnalysisCommand['kind']
  /** ステップ実行前の集合サイズ */
  inputCount: number
  /** ステップ実行後の集合サイズ */
  outputCount: number
  /** このステップで追加（traverse/from）または除外（filter）された要素の code 一覧 */
  changedCodes: string[]
  note: string
}

export interface AnalysisPath {
  /** 経路上の要素 code（起点→終点順） */
  nodes: { uid: string; code: string; title: string | null; entity_type: string }[]
  /** 経路上の関係（segments[i] は nodes[i]→nodes[i+1]。along=forward は from→to の向きで通過） */
  segments: { relation_type: string; along: 'forward' | 'backward' }[]
}

export interface AnalysisResult {
  name: string
  startUid: string | null
  endUid: string | null
  dsl: string
  steps: AnalysisStepRecord[]
  /** 最終的な影響範囲集合（PATH のみのクエリでは経路上の要素） */
  elements: GraphNode[]
  /** 集合内要素間の関係 */
  relations: (GraphEdge & { from_code: string; to_code: string })[]
  paths: AnalysisPath[]
  truncated: boolean
}

const MAX_SET_SIZE = 2000

function loadGraph(db: Database, projectUid: string): { nodes: Map<string, GraphNode>; edges: GraphEdge[] } {
  const nodes = new Map<string, GraphNode>(
    (
      db
        .prepare(
          `SELECT uid, code, title, entity_type, status FROM entity_registry
            WHERE project_uid = ? AND status <> 'deleted'`
        )
        .all(projectUid) as GraphNode[]
    ).map((node) => [node.uid, node])
  )
  const edges = db
    .prepare(
      `SELECT t.from_uid, t.to_uid, t.relation_type FROM trace_link t
         JOIN entity_registry e ON e.uid = t.uid AND e.status <> 'deleted'
         JOIN entity_registry ef ON ef.uid = t.from_uid AND ef.status <> 'deleted' AND ef.project_uid = ?
         JOIN entity_registry et ON et.uid = t.to_uid AND et.status <> 'deleted'`
    )
    .all(projectUid) as GraphEdge[]
  return { nodes, edges }
}

export interface RunAnalysisInput {
  name: string
  dsl: string
  startUid?: string
  endUid?: string
}

/** クエリ規則を決定論的に実行し、過程記録付きの結果を返す（ANA-002/003） */
export function runAnalysis(db: Database, projectUid: string, input: RunAnalysisInput): AnalysisResult {
  const validation = validateAgainstOntology(db, parseAnalysisDsl(input.dsl))
  if (!validation.ok) {
    const first = validation.errors[0]!
    throw new BackendError('validation', `クエリ規則が不正です（${first.line}行目: ${first.message}）`, '')
  }
  if (validation.requiresStart && !input.startUid) {
    throw new BackendError('validation', 'このクエリ規則には起点要素の指定が必要です', '')
  }
  if (validation.requiresEnd && !input.endUid) {
    throw new BackendError('validation', 'このクエリ規則には終点要素の指定が必要です', '')
  }
  const { nodes, edges } = loadGraph(db, projectUid)
  const requireNode = (uid: string, label: string): GraphNode => {
    const node = nodes.get(uid)
    if (!node) throw new BackendError('not_found', `${label}が見つかりません: ${uid}`, '')
    return node
  }
  const start = input.startUid ? requireNode(input.startUid, '起点要素') : null
  const end = input.endUid ? requireNode(input.endUid, '終点要素') : null

  // 現在集合。起点が指定されていれば初期集合とする
  const current = new Set<string>()
  if (start) current.add(start.uid)

  const steps: AnalysisStepRecord[] = []
  const paths: AnalysisPath[] = []
  let truncated = false
  const codesOf = (uids: Iterable<string>): string[] =>
    [...uids].map((uid) => nodes.get(uid)?.code ?? uid).sort((a, b) => a.localeCompare(b))

  for (const command of validation.commands) {
    const inputCount = current.size
    if (command.kind === 'from') {
      const added: string[] = []
      for (const node of nodes.values()) {
        const matches =
          command.types === '*' ? node.entity_type.startsWith('model_') : command.types.includes(node.entity_type)
        if (matches && !current.has(node.uid)) {
          current.add(node.uid)
          added.push(node.uid)
        }
      }
      steps.push({
        line: command.line,
        text: command.text,
        kind: command.kind,
        inputCount,
        outputCount: current.size,
        changedCodes: codesOf(added),
        note: `種別 ${command.types === '*' ? '全設計モデル' : command.types.join(', ')} の要素を追加`
      })
    } else if (command.kind === 'traverse') {
      // 現在集合から指定方向へ depth 段の幅優先で到達要素を追加する
      const added = new Set<string>()
      let frontier = new Set(current)
      for (let hop = 0; hop < command.depth; hop++) {
        const next = new Set<string>()
        for (const edge of edges) {
          if (command.relations !== '*' && !command.relations.includes(edge.relation_type)) continue
          const goDown = command.direction === 'down' || command.direction === 'both'
          const goUp = command.direction === 'up' || command.direction === 'both'
          if (goDown && frontier.has(edge.from_uid) && !current.has(edge.to_uid) && !next.has(edge.to_uid)) {
            next.add(edge.to_uid)
          }
          if (goUp && frontier.has(edge.to_uid) && !current.has(edge.from_uid) && !next.has(edge.from_uid)) {
            next.add(edge.from_uid)
          }
        }
        for (const uid of next) {
          if (current.size >= MAX_SET_SIZE) {
            truncated = true
            break
          }
          current.add(uid)
          added.add(uid)
        }
        frontier = next
        if (truncated || frontier.size === 0) break
      }
      steps.push({
        line: command.line,
        text: command.text,
        kind: command.kind,
        inputCount,
        outputCount: current.size,
        changedCodes: codesOf(added),
        note: `${command.relations === '*' ? '全関係' : command.relations.join(', ')} を${
          command.direction === 'down' ? '下流' : command.direction === 'up' ? '上流' : '双方向'
        }へ深さ${command.depth}で探索`
      })
    } else if (command.kind === 'filter') {
      const removed: string[] = []
      for (const uid of [...current]) {
        const node = nodes.get(uid)
        const value = command.target === 'type' ? node?.entity_type : node?.status
        if (!node || !command.values.includes(value ?? '')) {
          current.delete(uid)
          removed.push(uid)
        }
      }
      steps.push({
        line: command.line,
        text: command.text,
        kind: command.kind,
        inputCount,
        outputCount: current.size,
        changedCodes: codesOf(removed),
        note: `${command.target === 'type' ? '種別' : '状態'}が ${command.values.join(', ')} の要素だけ残す（記載は除外要素）`
      })
    } else {
      // PATH: 起点→終点の単純経路を深さ優先で列挙する（方向自由・辺の向きは記録）
      const found = findPaths(nodes, edges, start!.uid, end!.uid, command.relations, command.maxDepth, command.limit)
      paths.push(...found.paths)
      if (found.truncated) truncated = true
      for (const path of found.paths) for (const node of path.nodes) current.add(node.uid)
      steps.push({
        line: command.line,
        text: command.text,
        kind: command.kind,
        inputCount,
        outputCount: current.size,
        changedCodes: [`経路 ${found.paths.length} 件`],
        note: `${start!.code} → ${end!.code} の意味的経路を最大深さ${command.maxDepth}・上限${command.limit}件で探索`
      })
    }
  }

  const elements = [...current]
    .map((uid) => nodes.get(uid))
    .filter((node): node is GraphNode => node !== undefined)
    .sort((a, b) => a.code.localeCompare(b.code))
  const relations = edges
    .filter((edge) => current.has(edge.from_uid) && current.has(edge.to_uid))
    .map((edge) => ({
      ...edge,
      from_code: nodes.get(edge.from_uid)?.code ?? edge.from_uid,
      to_code: nodes.get(edge.to_uid)?.code ?? edge.to_uid
    }))
    .sort((a, b) => `${a.from_code}:${a.to_code}`.localeCompare(`${b.from_code}:${b.to_code}`))

  return {
    name: input.name,
    startUid: start?.uid ?? null,
    endUid: end?.uid ?? null,
    dsl: input.dsl,
    steps,
    elements,
    relations,
    paths,
    truncated
  }
}

function findPaths(
  nodes: Map<string, GraphNode>,
  edges: GraphEdge[],
  startUid: string,
  endUid: string,
  relations: string[] | '*',
  maxDepth: number,
  limit: number
): { paths: AnalysisPath[]; truncated: boolean } {
  // 隣接リスト（辺の向きを保持したまま双方向へ辿れるようにする）
  const adjacency = new Map<string, { edge: GraphEdge; along: 'forward' | 'backward'; next: string }[]>()
  for (const edge of edges) {
    if (relations !== '*' && !relations.includes(edge.relation_type)) continue
    ;(adjacency.get(edge.from_uid) ?? adjacency.set(edge.from_uid, []).get(edge.from_uid)!).push({
      edge,
      along: 'forward',
      next: edge.to_uid
    })
    ;(adjacency.get(edge.to_uid) ?? adjacency.set(edge.to_uid, []).get(edge.to_uid)!).push({
      edge,
      along: 'backward',
      next: edge.from_uid
    })
  }
  const paths: AnalysisPath[] = []
  let truncated = false
  const visiting = new Set<string>([startUid])
  const nodeStack: string[] = [startUid]
  const segmentStack: { relation_type: string; along: 'forward' | 'backward' }[] = []

  const dfs = (uid: string): void => {
    if (paths.length >= limit) {
      truncated = true
      return
    }
    if (uid === endUid && segmentStack.length > 0) {
      paths.push({
        nodes: nodeStack.map((stackUid) => {
          const node = nodes.get(stackUid)!
          return { uid: node.uid, code: node.code, title: node.title, entity_type: node.entity_type }
        }),
        segments: [...segmentStack]
      })
      return
    }
    if (segmentStack.length >= maxDepth) return
    // 決定論的な列挙順のため、辿る辺を関係種別→相手code順に固定する
    const neighbors = [...(adjacency.get(uid) ?? [])].sort((a, b) =>
      `${a.edge.relation_type}:${nodes.get(a.next)?.code ?? a.next}:${a.along}`.localeCompare(
        `${b.edge.relation_type}:${nodes.get(b.next)?.code ?? b.next}:${b.along}`
      )
    )
    for (const neighbor of neighbors) {
      if (visiting.has(neighbor.next)) continue
      visiting.add(neighbor.next)
      nodeStack.push(neighbor.next)
      segmentStack.push({ relation_type: neighbor.edge.relation_type, along: neighbor.along })
      dfs(neighbor.next)
      segmentStack.pop()
      nodeStack.pop()
      visiting.delete(neighbor.next)
      if (paths.length >= limit) return
    }
  }
  dfs(startUid)
  return { paths, truncated }
}

// ---- レポート出力（ANA-006） ----

export function buildAnalysisReportMarkdown(result: AnalysisResult): string {
  const lines: string[] = [
    `# 設計分析レポート: ${result.name}`,
    '',
    `- 実行日時: ${new Date().toISOString()}`,
    `- 起点要素: ${result.startUid ? (result.elements.find((e) => e.uid === result.startUid)?.code ?? result.startUid) : '（指定なし）'}`,
    `- 終点要素: ${result.endUid ? (result.elements.find((e) => e.uid === result.endUid)?.code ?? result.endUid) : '（指定なし）'}`,
    result.truncated ? `- **注意: 上限により結果を打ち切りました**` : '',
    '',
    '## クエリ規則（DSL）',
    '',
    '```',
    result.dsl.trim(),
    '```',
    '',
    '## 分析過程',
    '',
    '| # | 行 | 命令 | 入力件数 | 出力件数 | 内容 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...result.steps.map(
      (step, index) =>
        `| ${index + 1} | ${step.line} | \`${step.text}\` | ${step.inputCount} | ${step.outputCount} | ${step.note} |`
    ),
    ''
  ]
  result.steps.forEach((step, index) => {
    if (step.changedCodes.length === 0) return
    lines.push(
      `### 過程 ${index + 1}: \`${step.text}\``,
      '',
      `${step.kind === 'filter' ? '除外した要素' : step.kind === 'path' ? '結果' : '追加した要素'}: ${step.changedCodes.join(', ')}`,
      ''
    )
  })
  lines.push('## 分析結果: 対象要素', '', '| code | 種別 | タイトル | 状態 |', '| --- | --- | --- | --- |')
  for (const element of result.elements) {
    lines.push(`| ${element.code} | ${element.entity_type} | ${element.title ?? ''} | ${element.status} |`)
  }
  lines.push('', '## 分析結果: 要素間の関係', '', '| from | 関係 | to |', '| --- | --- | --- |')
  for (const relation of result.relations) {
    lines.push(`| ${relation.from_code} | ${relation.relation_type} | ${relation.to_code} |`)
  }
  if (result.paths.length > 0) {
    lines.push('', '## 分析結果: 意味的経路', '')
    result.paths.forEach((path, index) => {
      const rendered = path.nodes
        .map((node, nodeIndex) => {
          if (nodeIndex === 0) return node.code
          const segment = path.segments[nodeIndex - 1]!
          const arrow = segment.along === 'forward' ? `-[${segment.relation_type}]->` : `<-[${segment.relation_type}]-`
          return ` ${arrow} ${node.code}`
        })
        .join('')
      lines.push(`${index + 1}. ${rendered}`)
    })
  }
  lines.push('')
  return lines.filter((line) => line !== null).join('\n')
}

/** レポートを exports/reports/ へ保存し report:// で閲覧可能にする */
export function saveAnalysisReport(projectRoot: string, result: AnalysisResult): { fileName: string; path: string } {
  const dir = join(projectRoot, 'exports', 'reports')
  mkdirSync(dir, { recursive: true })
  const safeName = result.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'analysis'
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  let fileName = `analysis_${safeName}_${stamp}.md`
  let suffix = 1
  while (existsSync(join(dir, fileName))) {
    fileName = `analysis_${safeName}_${stamp}_${suffix}.md`
    suffix += 1
  }
  const path = join(dir, fileName)
  writeFileSync(path, buildAnalysisReportMarkdown(result), 'utf-8')
  return { fileName, path: join('exports', 'reports', fileName) }
}

// ---- クエリ規則スロット（ANA-004。プロジェクト設定 analysis.querySlots に保存） ----

export interface AnalysisQuerySlot {
  name: string
  dsl: string
}

export const ANALYSIS_SLOT_COUNT = 10

/** 未設定プロジェクト向けの既定スロット（先頭2件のみ。残りは空） */
export const DEFAULT_ANALYSIS_SLOTS: AnalysisQuerySlot[] = [
  {
    name: '影響範囲（下流3段）',
    dsl: ['# 起点要素の変更が影響しうる下流要素を抽出する', 'TRAVERSE * DOWN DEPTH 3'].join('\n')
  },
  {
    name: '経路検索（起点→終点）',
    dsl: ['# 二要素間の意味的経路を列挙する', 'PATH * MAXDEPTH 6 LIMIT 50'].join('\n')
  }
]

export function normalizeAnalysisSlots(raw: unknown): AnalysisQuerySlot[] {
  const slots: AnalysisQuerySlot[] = []
  const list = Array.isArray(raw) ? raw : []
  for (let i = 0; i < ANALYSIS_SLOT_COUNT; i++) {
    const item = list[i]
    if (typeof item === 'object' && item !== null) {
      const record = item as Record<string, unknown>
      slots.push({
        name: typeof record.name === 'string' ? record.name.slice(0, 40) : '',
        dsl: typeof record.dsl === 'string' ? record.dsl : ''
      })
    } else {
      slots.push({ name: '', dsl: '' })
    }
  }
  return slots
}
