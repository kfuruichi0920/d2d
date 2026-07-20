/**
 * 設計分析機能（ANA-001〜006）。
 * オントロジーの推論規則の考え方に基づき、設計モデルの要素・関係定義へ
 * あらかじめ定義したクエリ規則（DSL）を適用し、影響確認範囲や意味的経路を
 * 決定論的に導出する。実行過程（各ステップの入出力）も記録し、レポートへ出力する。
 *
 * - ANA-001: クエリ規則 DSL（行ベース。FROM / TRAVERSE / FILTER / PATH / SET、# コメント）
 * - ANA-002: 影響分析（TRAVERSE の連続適用による影響範囲の自動抽出）
 * - ANA-003: 経路検索（PATH。二要素間の意味的経路の列挙）
 * - ANA-006: 分析過程を含むレポート出力（Markdown/HTML、exports/reports/、report:// で閲覧）
 * - ANA-007: DSL 拡張（関係属性 WHERE、要素属性 FILTER ATTR、否定 NOT、集合演算 SET）
 *
 * DSL 仕様（キーワードは大文字小文字非区別、1行1命令）:
 *   FROM TYPE <model_req,...|*>            集合へ指定種別の全要素を追加（起点不要クエリ用）
 *   TRAVERSE <rel,...|*> <UP|DOWN|BOTH> [DEPTH n] [WHERE k=v|k~v,...]
 *                                          集合の各要素から関係を辿り、到達要素を集合へ追加
 *                                          （DOWN=from→to 下流 / UP=to→from 上流。WHERE は関係属性で辺を限定）
 *   FILTER [NOT] TYPE <types> / FILTER [NOT] STATUS <statuses>
 *                                          集合を種別・状態で絞り込む（NOT で否定）
 *   FILTER [NOT] ATTR <k=v|k~v,...>        要素属性値（title/code/status/summary/detailキー）で絞り込む
 *   SET SAVE|LOAD|UNION|INTERSECT|EXCEPT <名前>
 *                                          現在集合の保存・復元・和・積・差（名前は英数字・_-）
 *   PATH <rel,...|*> [MAXDEPTH n] [LIMIT m] [WHERE k=v|k~v,...]
 *                                          起点→終点の意味的経路を列挙（方向自由、既定 6 / 50）
 *
 * 条件式: `=` は完全一致、`~` は部分一致。関係属性は relation_type / review_status / basis_kind /
 * allocation_kind / usage_kind / conflict_status / transform_note / created_by を指定できる。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { renderReportHtml } from '../report/report-service'

// ---- DSL パーサ（ANA-001） ----

export type AnalysisDirection = 'up' | 'down' | 'both'

/** 条件式（ANA-007）。`=` は完全一致、`~` は部分一致 */
export interface AttrCondition {
  key: string
  op: '=' | '~'
  value: string
}

export type SetOperation = 'save' | 'load' | 'union' | 'intersect' | 'except'

export type AnalysisCommand =
  | { kind: 'from'; line: number; text: string; types: string[] | '*' }
  | {
      kind: 'traverse'
      line: number
      text: string
      relations: string[] | '*'
      direction: AnalysisDirection
      depth: number
      where: AttrCondition[]
    }
  | {
      kind: 'filter'
      line: number
      text: string
      target: 'type' | 'status' | 'attr'
      negate: boolean
      values: string[]
      conditions: AttrCondition[]
    }
  | { kind: 'set'; line: number; text: string; op: SetOperation; name: string }
  | {
      kind: 'path'
      line: number
      text: string
      relations: string[] | '*'
      maxDepth: number
      limit: number
      where: AttrCondition[]
    }

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

/** trace_link 上で WHERE 条件に使える関係属性（ANA-007） */
const EDGE_ATTR_KEYS = new Set([
  'relation_type',
  'review_status',
  'basis_kind',
  'allocation_kind',
  'usage_kind',
  'conflict_status',
  'transform_note',
  'created_by'
])

/** `k=v,k2~v2` 形式の条件リストを解析する。不正時は null を返し errors へ追記する */
function parseConditions(
  token: string,
  line: number,
  errors: { line: number; message: string }[],
  restrictKeys?: Set<string>
): AttrCondition[] | null {
  const conditions: AttrCondition[] = []
  for (const part of token.split(',')) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)([=~])(.+)$/.exec(part.trim())
    if (!match) {
      errors.push({ line, message: `条件式が不正です: ${part}（key=value または key~部分一致）` })
      return null
    }
    if (restrictKeys && !restrictKeys.has(match[1]!)) {
      errors.push({ line, message: `WHERE に使えない関係属性です: ${match[1]}` })
      return null
    }
    conditions.push({ key: match[1]!, op: match[2] as '=' | '~', value: match[3]! })
  }
  if (conditions.length === 0) {
    errors.push({ line, message: '条件式を1件以上指定してください' })
    return null
  }
  return conditions
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
        errors.push({
          line,
          message: 'TRAVERSE <関係,...|*> <UP|DOWN|BOTH> [DEPTH n] [WHERE k=v,...] の形式で指定してください'
        })
        return
      }
      let depth = 1
      let where: AttrCondition[] = []
      for (let i = 3; i < tokens.length; i += 2) {
        const option = tokens[i]!.toUpperCase()
        const value = tokens[i + 1]
        if (!value) {
          errors.push({ line, message: `${tokens[i]} の値が指定されていません` })
          return
        }
        if (option === 'DEPTH') {
          if (!/^\d+$/.test(value)) {
            errors.push({ line, message: 'DEPTH には 1〜10 の整数を指定してください' })
            return
          }
          depth = Number(value)
        } else if (option === 'WHERE') {
          const parsed = parseConditions(value, line, errors, EDGE_ATTR_KEYS)
          if (!parsed) return
          where = parsed
        } else {
          errors.push({ line, message: `不明なオプションです: ${tokens[i]}` })
          return
        }
      }
      if (depth < 1 || depth > MAX_DEPTH) {
        errors.push({ line, message: `DEPTH は 1〜${MAX_DEPTH} で指定してください` })
        return
      }
      commands.push({ kind: 'traverse', line, text, relations, direction, depth, where })
      return
    }
    if (keyword === 'FILTER') {
      // FILTER [NOT] TYPE|STATUS|ATTR <値>（ANA-007: NOT 否定・ATTR 要素属性）
      let cursor = 1
      let negate = false
      if ((tokens[cursor] ?? '').toUpperCase() === 'NOT') {
        negate = true
        cursor += 1
      }
      const target = (tokens[cursor] ?? '').toUpperCase()
      const valueToken = tokens[cursor + 1]
      if ((target !== 'TYPE' && target !== 'STATUS' && target !== 'ATTR') || !valueToken) {
        errors.push({
          line,
          message: 'FILTER [NOT] TYPE <種別,...> / STATUS <状態,...> / ATTR <k=v|k~v,...> の形式で指定してください'
        })
        return
      }
      if (target === 'ATTR') {
        const conditions = parseConditions(valueToken, line, errors)
        if (!conditions) return
        commands.push({ kind: 'filter', line, text, target: 'attr', negate, values: [], conditions })
        return
      }
      const values = parseList(valueToken)
      if (values === '*' || values.length === 0) {
        errors.push({ line, message: 'FILTER の値はカンマ区切りで1件以上指定してください（* は不可）' })
        return
      }
      commands.push({
        kind: 'filter',
        line,
        text,
        target: target === 'TYPE' ? 'type' : 'status',
        negate,
        values,
        conditions: []
      })
      return
    }
    if (keyword === 'SET') {
      // 集合演算（ANA-007）: SET SAVE|LOAD|UNION|INTERSECT|EXCEPT <名前>
      const opToken = (tokens[1] ?? '').toUpperCase()
      const opMap: Record<string, SetOperation> = {
        SAVE: 'save',
        LOAD: 'load',
        UNION: 'union',
        INTERSECT: 'intersect',
        EXCEPT: 'except'
      }
      const op = opMap[opToken]
      const name = tokens[2]
      if (!op || !name || !/^[A-Za-z0-9_-]{1,32}$/.test(name)) {
        errors.push({
          line,
          message: 'SET SAVE|LOAD|UNION|INTERSECT|EXCEPT <名前（英数字・_-、32文字以内）> の形式で指定してください'
        })
        return
      }
      commands.push({ kind: 'set', line, text, op, name })
      return
    }
    if (keyword === 'PATH') {
      const relations = tokens[1] ? parseList(tokens[1]) : []
      if (!tokens[1] || relations.length === 0) {
        errors.push({
          line,
          message: 'PATH <関係,...|*> [MAXDEPTH n] [LIMIT m] [WHERE k=v,...] の形式で指定してください'
        })
        return
      }
      let maxDepth = 6
      let limit = 50
      let where: AttrCondition[] = []
      for (let i = 2; i < tokens.length; i += 2) {
        const option = tokens[i]!.toUpperCase()
        const value = tokens[i + 1]
        if (!value) {
          errors.push({ line, message: `${tokens[i]} の値が指定されていません` })
          return
        }
        if (option === 'WHERE') {
          const parsed = parseConditions(value, line, errors, EDGE_ATTR_KEYS)
          if (!parsed) return
          where = parsed
          continue
        }
        if (!/^\d+$/.test(value)) {
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
      commands.push({ kind: 'path', line, text, relations, maxDepth, limit, where })
      return
    }
    errors.push({ line, message: `不明な命令です: ${tokens[0]}（FROM / TRAVERSE / FILTER / SET / PATH）` })
  })

  if (commands.length === 0 && errors.length === 0) {
    errors.push({ line: 1, message: 'クエリ規則が空です。1行以上の命令を定義してください' })
  }
  // SET の参照整合（ANA-007）: SAVE していない名前の LOAD/UNION/INTERSECT/EXCEPT は静的エラー
  const savedNames = new Set<string>()
  for (const command of commands) {
    if (command.kind !== 'set') continue
    if (command.op === 'save') savedNames.add(command.name)
    else if (!savedNames.has(command.name)) {
      errors.push({
        line: command.line,
        message: `SET ${command.op.toUpperCase()} の前に SAVE されていない集合です: ${command.name}`
      })
    }
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
  /** WHERE 条件で参照できる関係属性（ANA-007） */
  review_status: string | null
  basis_kind: string | null
  allocation_kind: string | null
  usage_kind: string | null
  conflict_status: string | null
  transform_note: string | null
  created_by: string | null
}

/** 関係属性の WHERE 条件判定（ANA-007）。全条件 AND */
function edgeMatches(edge: GraphEdge, where: AttrCondition[]): boolean {
  return where.every((condition) => {
    const value = String((edge as unknown as Record<string, unknown>)[condition.key] ?? '')
    return condition.op === '=' ? value === condition.value : value.includes(condition.value)
  })
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
      `SELECT t.from_uid, t.to_uid, t.relation_type, t.review_status, t.basis_kind, t.allocation_kind,
              t.usage_kind, t.conflict_status, t.transform_note, t.created_by
         FROM trace_link t
         JOIN entity_registry e ON e.uid = t.uid AND e.status <> 'deleted'
         JOIN entity_registry ef ON ef.uid = t.from_uid AND ef.status <> 'deleted' AND ef.project_uid = ?
         JOIN entity_registry et ON et.uid = t.to_uid AND et.status <> 'deleted'`
    )
    .all(projectUid) as GraphEdge[]
  return { nodes, edges }
}

/**
 * 要素属性値の取得（ANA-007 FILTER ATTR）。
 * title / code / status / entity_type / summary と、④設計モデルの detail_json キーを参照できる。
 */
function createElementAttrReader(db: Database): (node: GraphNode, key: string) => string {
  const detailCache = new Map<string, Record<string, unknown>>()
  return (node, key) => {
    if (key === 'title') return node.title ?? ''
    if (key === 'code') return node.code
    if (key === 'status') return node.status
    if (key === 'entity_type') return node.entity_type
    if (!/^model_[a-z][a-z0-9_]*$/.test(node.entity_type)) return ''
    let detail = detailCache.get(node.uid)
    if (!detail) {
      const row = db.prepare(`SELECT summary, detail_json FROM "${node.entity_type}" WHERE uid = ?`).get(node.uid) as
        { summary: string; detail_json: string } | undefined
      detail = { summary: row?.summary ?? '' }
      try {
        Object.assign(detail, JSON.parse(row?.detail_json ?? '{}') as Record<string, unknown>)
      } catch {
        /* detail_json が壊れていても summary だけで判定する */
      }
      detailCache.set(node.uid, detail)
    }
    const value = detail[key]
    if (value === undefined || value === null) return ''
    return typeof value === 'string' ? value : JSON.stringify(value)
  }
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
  const namedSets = new Map<string, Set<string>>()
  const readAttr = createElementAttrReader(db)
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
          if (command.where.length > 0 && !edgeMatches(edge, command.where)) continue
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
        }へ深さ${command.depth}で探索${command.where.length > 0 ? `（関係属性条件 ${command.where.length}件）` : ''}`
      })
    } else if (command.kind === 'filter') {
      const removed: string[] = []
      for (const uid of [...current]) {
        const node = nodes.get(uid)
        let matches = false
        if (node) {
          if (command.target === 'attr') {
            matches = command.conditions.every((condition) => {
              const value = readAttr(node, condition.key)
              return condition.op === '=' ? value === condition.value : value.includes(condition.value)
            })
          } else {
            const value = command.target === 'type' ? node.entity_type : node.status
            matches = command.values.includes(value)
          }
        }
        // NOT は判定を反転して「条件に一致する要素を除外」する（ANA-007）
        const keep = node !== undefined && (command.negate ? !matches : matches)
        if (!keep) {
          current.delete(uid)
          removed.push(uid)
        }
      }
      const conditionLabel =
        command.target === 'attr'
          ? `属性 ${command.conditions.map((c) => `${c.key}${c.op}${c.value}`).join(', ')}`
          : `${command.target === 'type' ? '種別' : '状態'}が ${command.values.join(', ')}`
      steps.push({
        line: command.line,
        text: command.text,
        kind: command.kind,
        inputCount,
        outputCount: current.size,
        changedCodes: codesOf(removed),
        note: `${conditionLabel} ${command.negate ? 'に一致しない' : 'の'}要素だけ残す（記載は除外要素）`
      })
    } else if (command.kind === 'set') {
      // 集合演算（ANA-007）。SAVE 済み名の存在は parse 時に静的検証済み
      const named = namedSets.get(command.name) ?? new Set<string>()
      const before = new Set(current)
      if (command.op === 'save') {
        namedSets.set(command.name, new Set(current))
      } else if (command.op === 'load') {
        current.clear()
        for (const uid of named) current.add(uid)
      } else if (command.op === 'union') {
        for (const uid of named) current.add(uid)
      } else if (command.op === 'intersect') {
        for (const uid of [...current]) if (!named.has(uid)) current.delete(uid)
      } else {
        for (const uid of named) current.delete(uid)
      }
      const changed = [...new Set([...before, ...current])].filter((uid) => before.has(uid) !== current.has(uid))
      steps.push({
        line: command.line,
        text: command.text,
        kind: command.kind,
        inputCount,
        outputCount: current.size,
        changedCodes: codesOf(changed),
        note: `集合 ${command.name} との ${command.op.toUpperCase()}（記載は増減した要素）`
      })
    } else {
      // PATH: 起点→終点の単純経路を深さ優先で列挙する（方向自由・辺の向きは記録）
      const pathEdges = command.where.length > 0 ? edges.filter((edge) => edgeMatches(edge, command.where)) : edges
      const found = findPaths(
        nodes,
        pathEdges,
        start!.uid,
        end!.uid,
        command.relations,
        command.maxDepth,
        command.limit
      )
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

export type AnalysisReportFormat = 'markdown' | 'html'

/**
 * レポートを exports/reports/ へ保存し report:// で閲覧可能にする（ANA-006/008/009）。
 * グラフ表示（analysis://）用に、同名の .json へ構造化結果も併存保存する。
 */
export function saveAnalysisReport(
  projectRoot: string,
  result: AnalysisResult,
  format: AnalysisReportFormat = 'markdown'
): { fileName: string; path: string; dataFileName: string } {
  const dir = join(projectRoot, 'exports', 'reports')
  mkdirSync(dir, { recursive: true })
  const safeName = result.name.replace(/[^\p{L}\p{N}_-]+/gu, '_').slice(0, 40) || 'analysis'
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const ext = format === 'html' ? 'html' : 'md'
  let base = `analysis_${safeName}_${stamp}`
  let suffix = 1
  while (existsSync(join(dir, `${base}.${ext}`)) || existsSync(join(dir, `${base}.json`))) {
    base = `analysis_${safeName}_${stamp}_${suffix}`
    suffix += 1
  }
  const fileName = `${base}.${ext}`
  const markdown = buildAnalysisReportMarkdown(result)
  writeFileSync(
    join(dir, fileName),
    format === 'html' ? renderReportHtml(markdown, `設計分析レポート: ${result.name}`) : markdown,
    'utf-8'
  )
  const dataFileName = `${base}.json`
  writeFileSync(join(dir, dataFileName), JSON.stringify({ ...result, reportFileName: fileName }, null, 2), 'utf-8')
  return { fileName, path: join('exports', 'reports', fileName), dataFileName }
}

/** グラフ表示用の構造化結果を読み出す（ANA-008。analysis:// エディタが使用） */
export function loadAnalysisResult(projectRoot: string, dataFileName: string): AnalysisResult {
  const name = basename(dataFileName)
  const path = join(projectRoot, 'exports', 'reports', name)
  if (!name.endsWith('.json') || !existsSync(path)) {
    throw new BackendError('not_found', `分析結果データが見つかりません: ${name}`, '')
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as AnalysisResult
}

// ---- クエリ規則スロット（ANA-004。プロジェクト設定 analysis.querySlots に保存） ----

export interface AnalysisQuerySlot {
  name: string
  dsl: string
  /** MCP ツールとして公開する際の説明（MCP-011。空なら MCP へ公開しない） */
  mcpDescription: string
}

export const ANALYSIS_SLOT_COUNT = 10

/** 未設定プロジェクト向けの既定スロット（先頭2件のみ。残りは空） */
export const DEFAULT_ANALYSIS_SLOTS: AnalysisQuerySlot[] = [
  {
    name: '影響範囲（下流3段）',
    dsl: ['# 起点要素の変更が影響しうる下流要素を抽出する', 'TRAVERSE * DOWN DEPTH 3'].join('\n'),
    mcpDescription:
      '指定した起点要素（start_uid）から全関係を下流方向へ3段辿り、変更の影響を受けうる設計要素の集合を返す影響分析。'
  },
  {
    name: '経路検索（起点→終点）',
    dsl: ['# 二要素間の意味的経路を列挙する', 'PATH * MAXDEPTH 6 LIMIT 50'].join('\n'),
    mcpDescription:
      '起点要素（start_uid）と終点要素（end_uid）の間にどのような意味的経路（関係の連鎖）があるかを列挙する経路検索。'
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
        dsl: typeof record.dsl === 'string' ? record.dsl : '',
        mcpDescription: typeof record.mcpDescription === 'string' ? record.mcpDescription.slice(0, 500) : ''
      })
    } else {
      slots.push({ name: '', dsl: '', mcpDescription: '' })
    }
  }
  return slots
}
