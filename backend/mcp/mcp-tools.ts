/**
 * MCP サーバのツール実装（MCP-004〜008）。
 * 登録済みデータ（①〜④・Resource・設計モデル・関係）を AI エージェントへ応答し、
 * 改修判断の精度向上を支援する。DB 読み取り専用で正本を変更しない。
 *
 * - MCP-004: 設計要素一覧（list_element_types）
 * - MCP-005: 設計要素情報取得（get_element_type）
 * - MCP-006: 設計要素検索（search_elements。スコア上位から応答、AND/OR、既定20件）
 * - MCP-007: 設計要素詳細取得（get_elements。複数 UID 同時可）
 * - MCP-008: 上流トレース（trace_upstream）／下流トレース（trace_downstream）
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { getOntology, parseFieldSchema } from '../ontology/ontology-service'
import { listTraceLinks } from '../design/design-service'
import { getTraceSubgraph, type TraceDirection } from '../traceability/trace-service'
import { searchElements, type SearchSettings } from '../search/search-service'

/** MCP tools/list で応答するツール定義（inputSchema は JSON Schema）。 */
export interface McpToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

/** ツール実行時に必要な実行文脈。プロジェクト未オープン時は呼び出し側でエラーにする。 */
export interface McpToolContext {
  db: Database
  projectUid: string
  searchSettings: SearchSettings
}

const DEFAULT_SEARCH_LIMIT = 20
const MAX_SEARCH_LIMIT = 100
const MAX_DETAIL_UIDS = 50

/** ④設計モデル以外の主要 entity_type の簡易定義（①〜③・チャンク・Resource）。 */
const STAGE_TYPE_DEFINITIONS: Record<string, string> = {
  source_document: '①原本文書。取込んだ設計文書の原本（Word等）を表す。',
  extracted_document: '②抽出データ。原本から機械抽出した構造化データの文書単位。',
  extracted_item: '②抽出データの要素。段落・見出し・図表等の1要素で Resource を参照する。',
  intermediate_document: '③中間データ。成果物単位に統合・編集した設計文書の正本。',
  intermediate_item: '③中間データの要素。文書のアウトラインを構成し Resource を参照する。',
  chunk: 'チャンク。④設計モデル候補生成のために③要素をまとめた LLM 入力単位。',
  resource_label: 'ラベルResource。見出し・箇条書き等の短文。',
  resource_text: 'テキストResource。段落等の本文。',
  resource_list: 'リストResource。Markdownリスト形式の列挙。',
  resource_figure: '図Resource。画像と説明。',
  resource_table: '表Resource。表構造とセル。',
  resource_formula: '数式Resource。TeX本文と説明。',
  resource_code: 'コードResource。コード断片。',
  resource_model: 'モデルResource。PlantUML等のモデル記述。',
  resource_reference: '参照Resource。他文書・外部への参照。',
  resource_glossary: '用語Resource。用語と定義。'
}

/** entity_type → 物理 Resource テーブルの対応（詳細取得で本文を返す）。 */
const RESOURCE_TABLES = new Set([
  'resource_label',
  'resource_text',
  'resource_list',
  'resource_figure',
  'resource_table',
  'resource_formula',
  'resource_code',
  'resource_model',
  'resource_reference',
  'resource_glossary'
])

export const MCP_TOOL_DEFINITIONS: McpToolDefinition[] = [
  {
    name: 'list_element_types',
    description:
      '本プロジェクトで得られる設計情報の一覧を返す。①原本・②抽出・③中間・チャンク・Resource・④設計モデル・関係種別の簡易定義と登録件数を含む。最初に呼び出して全体像を把握することを推奨する。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false }
  },
  {
    name: 'get_element_type',
    description:
      '指定した設計要素種別（entity_type。例: model_req、resource_text、intermediate_document）の定義と属性スキーマ、関係の許容規則を返す。',
    inputSchema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', description: '種別名（list_element_types の type 値）' }
      },
      required: ['entity_type'],
      additionalProperties: false
    }
  },
  {
    name: 'search_elements',
    description:
      '自然言語・識別子（UID/コード）・種別・属性値から設計要素候補を検索する。複数クエリは operator で AND/OR 結合し、関連度スコア上位から応答する。',
    inputSchema: {
      type: 'object',
      properties: {
        queries: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: '検索語の配列。UID・表示コード（例: REQ-000001）・自然言語・属性値を指定できる'
        },
        operator: { type: 'string', enum: ['AND', 'OR'], description: '複数クエリの結合条件（既定: AND）' },
        entity_type: { type: 'string', description: '種別で絞り込む場合に指定（例: model_req）' },
        limit: {
          type: 'number',
          description: `応答上限件数（既定: ${DEFAULT_SEARCH_LIMIT}、最大: ${MAX_SEARCH_LIMIT}）`
        }
      },
      required: ['queries'],
      additionalProperties: false
    }
  },
  {
    name: 'get_elements',
    description:
      'UID を指定して設計要素の詳細（台帳情報・属性・本文・直接の関係一覧）を取得する。複数 UID の同時指定が可能。',
    inputSchema: {
      type: 'object',
      properties: {
        uids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          maxItems: MAX_DETAIL_UIDS,
          description: `対象要素の UID 配列（最大 ${MAX_DETAIL_UIDS} 件）`
        }
      },
      required: ['uids'],
      additionalProperties: false
    }
  },
  {
    name: 'trace_upstream',
    description:
      '対象要素の上流側（根拠側。関係の to→from 方向）の要素と関係性を返す。設計モデルから③②①の根拠へ遡る用途に使う。',
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: '起点要素の UID' },
        depth: { type: 'number', description: '探索する深さ（既定: 3、最大: 10）' },
        relation_types: { type: 'array', items: { type: 'string' }, description: '関係種別で絞り込む場合に指定' }
      },
      required: ['uid'],
      additionalProperties: false
    }
  },
  {
    name: 'trace_downstream',
    description:
      '対象要素の下流側（派生側。関係の from→to 方向）の要素と関係性を返す。根拠から影響を受ける設計モデルを辿る用途に使う。',
    inputSchema: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: '起点要素の UID' },
        depth: { type: 'number', description: '探索する深さ（既定: 3、最大: 10）' },
        relation_types: { type: 'array', items: { type: 'string' }, description: '関係種別で絞り込む場合に指定' }
      },
      required: ['uid'],
      additionalProperties: false
    }
  }
]

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    throw new BackendError('validation', 'ツール引数はオブジェクトで指定してください', String(value))
  }
  return value as Record<string, unknown>
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new BackendError('validation', `${key} は必須の文字列です`, '')
  }
  return value
}

/** MCP-004: 設計要素一覧 */
function listElementTypes(ctx: McpToolContext): unknown {
  const counts = new Map(
    (
      ctx.db
        .prepare(
          `SELECT entity_type, COUNT(*) AS count FROM entity_registry
            WHERE project_uid = ? AND status <> 'deleted' GROUP BY entity_type`
        )
        .all(ctx.projectUid) as { entity_type: string; count: number }[]
    ).map((row) => [row.entity_type, row.count])
  )
  const ontology = getOntology(ctx.db)
  return {
    stages_and_resources: Object.entries(STAGE_TYPE_DEFINITIONS).map(([type, definition]) => ({
      type,
      definition,
      count: counts.get(type) ?? 0
    })),
    design_models: ontology.models
      .filter((model) => model.is_enabled === 1)
      .map((model) => ({
        type: model.model_type,
        code_prefix: model.code_prefix,
        label: model.label,
        layer: model.layer,
        definition: model.definition,
        count: counts.get(model.model_type) ?? 0
      })),
    relation_types: ontology.relations
      .filter((relation) => relation.is_enabled === 1)
      .map((relation) => ({
        type: relation.relation_type,
        label: relation.label,
        definition: relation.definition
      })),
    ontology_version: ontology.version,
    hint: '種別の属性は get_element_type、要素の検索は search_elements、詳細は get_elements を使用してください。'
  }
}

/** MCP-005: 設計要素情報取得 */
function getElementType(ctx: McpToolContext, args: Record<string, unknown>): unknown {
  const entityType = requireString(args, 'entity_type')
  const count = (
    ctx.db
      .prepare(
        `SELECT COUNT(*) AS count FROM entity_registry WHERE project_uid = ? AND entity_type = ? AND status <> 'deleted'`
      )
      .get(ctx.projectUid, entityType) as { count: number }
  ).count

  if (entityType.startsWith('model_')) {
    const ontology = getOntology(ctx.db)
    const model = ontology.models.find((candidate) => candidate.model_type === entityType)
    if (!model) throw new BackendError('not_found', `未定義の設計モデル種別です: ${entityType}`, '')
    return {
      type: model.model_type,
      code_prefix: model.code_prefix,
      label: model.label,
      layer: model.layer,
      definition: model.definition,
      enabled: model.is_enabled === 1,
      count,
      fields: parseFieldSchema(model.field_schema_json).filter((field) => field.is_enabled !== 0),
      allowed_relations: ontology.allowances
        .filter((allowance) => allowance.source_model_type === entityType || allowance.target_model_type === entityType)
        .map((allowance) => ({
          relation_type: allowance.relation_type,
          from: allowance.source_model_type,
          to: allowance.target_model_type
        }))
    }
  }
  const definition = STAGE_TYPE_DEFINITIONS[entityType]
  if (!definition) throw new BackendError('not_found', `未定義の設計要素種別です: ${entityType}`, '')
  return { type: entityType, definition, count }
}

/** MCP-006: 設計要素検索（AND/OR・スコア上位） */
function searchDesignElements(ctx: McpToolContext, args: Record<string, unknown>): unknown {
  const rawQueries = Array.isArray(args.queries) ? args.queries.map((query) => String(query).trim()) : []
  const queries = rawQueries.filter(Boolean)
  if (queries.length === 0) {
    throw new BackendError('validation', 'queries は1件以上の検索語を指定してください', '')
  }
  const operator = args.operator === 'OR' ? 'OR' : 'AND'
  const entityType = typeof args.entity_type === 'string' && args.entity_type ? args.entity_type : undefined
  const limit = Math.min(Math.max(Number(args.limit) || DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT)

  // クエリごとに既存検索（bm25 スコア付き）を実行し、AND=全クエリ一致の交差 / OR=和集合でスコア合算する。
  // score は小さいほど関連度が高い（完全一致 -1000、FTS bm25、部分一致 1000）。
  interface Merged {
    uid: string
    entityType: string
    code: string
    title: string
    snippet: string
    resourceUri: string
    score: number
    matched: number
  }
  const merged = new Map<string, Merged>()
  for (const query of queries) {
    const response = searchElements(ctx.db, ctx.projectUid, query, ctx.searchSettings, {
      entityType,
      limit: Math.max(limit * 5, 100)
    })
    for (const row of response.results) {
      const current = merged.get(row.uid)
      if (current) {
        current.score += row.score
        current.matched += 1
      } else {
        merged.set(row.uid, {
          uid: row.uid,
          entityType: row.entityType,
          code: row.code,
          title: row.title,
          snippet: row.snippet,
          resourceUri: row.resourceUri,
          score: row.score,
          matched: 1
        })
      }
    }
  }
  const results = [...merged.values()]
    .filter((row) => operator === 'OR' || row.matched === queries.length)
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
  return {
    operator,
    queries,
    total: results.length,
    limit,
    results,
    hint: 'score は小さいほど関連度が高い（UID/コード完全一致が最上位）。詳細は get_elements へ uid を渡してください。'
  }
}

/** MCP-007: 設計要素詳細取得（複数 UID 同時可） */
function getElements(ctx: McpToolContext, args: Record<string, unknown>): unknown {
  const uids = Array.isArray(args.uids) ? args.uids.map((uid) => String(uid).trim()).filter(Boolean) : []
  if (uids.length === 0 || uids.length > MAX_DETAIL_UIDS) {
    throw new BackendError('validation', `uids は1〜${MAX_DETAIL_UIDS}件の UID 配列で指定してください`, '')
  }
  return {
    elements: uids.map((uid) => {
      const entity = ctx.db
        .prepare(
          `SELECT uid, entity_type, code, title, status, created_at, updated_at FROM entity_registry
            WHERE uid = ? AND project_uid = ? AND status <> 'deleted'`
        )
        .get(uid, ctx.projectUid) as
        | {
            uid: string
            entity_type: string
            code: string
            title: string | null
            status: string
            created_at: string
            updated_at: string
          }
        | undefined
      if (!entity) return { uid, found: false as const }

      // ④設計モデルは summary / detail_json、Resource は物理テーブルの本文列を付加する
      let detail: Record<string, unknown> | null = null
      if (/^model_[a-z][a-z0-9_]*$/.test(entity.entity_type)) {
        const model = ctx.db
          .prepare(`SELECT summary, detail_json, model_version FROM "${entity.entity_type}" WHERE uid = ?`)
          .get(uid) as { summary: string; detail_json: string; model_version: number } | undefined
        if (model) {
          let parsed: unknown = model.detail_json
          try {
            parsed = JSON.parse(model.detail_json)
          } catch {
            /* 生文字列のまま返す */
          }
          detail = { summary: model.summary, attributes: parsed, model_version: model.model_version }
        }
      } else if (RESOURCE_TABLES.has(entity.entity_type)) {
        const resource = ctx.db.prepare(`SELECT * FROM "${entity.entity_type}" WHERE uid = ?`).get(uid) as
          Record<string, unknown> | undefined
        if (resource) {
          delete resource.uid
          detail = resource
        }
      }

      const relations = listTraceLinks(ctx.db, ctx.projectUid, { uid }).map((link) => ({
        relation_type: link.relation_type,
        direction: link.from_uid === uid ? 'outgoing' : 'incoming',
        from: { uid: link.from_uid, code: link.from_code, title: link.from_title },
        to: { uid: link.to_uid, code: link.to_code, title: link.to_title },
        review_status: link.review_status,
        rationale: link.rationale
      }))
      return { found: true as const, ...entity, detail, relations }
    })
  }
}

/** MCP-008: 上流／下流トレース */
function trace(ctx: McpToolContext, args: Record<string, unknown>, direction: TraceDirection): unknown {
  const uid = requireString(args, 'uid')
  const subgraph = getTraceSubgraph(ctx.db, {
    rootUid: uid,
    depth: args.depth === undefined ? 3 : Number(args.depth),
    direction,
    relationTypes: Array.isArray(args.relation_types) ? args.relation_types.map((type) => String(type)) : undefined
  })
  return {
    root: subgraph.root,
    side: direction === 'backward' ? 'upstream' : 'downstream',
    depth: subgraph.depth,
    truncated: subgraph.truncated,
    elements: subgraph.nodes.map((node) => ({
      uid: node.uid,
      code: node.code,
      title: node.title,
      entity_type: node.entity_type,
      status: node.status,
      hop: node.hop
    })),
    relations: subgraph.edges.map((edge) => ({
      relation_type: edge.relation_type,
      from_uid: edge.from_uid,
      to_uid: edge.to_uid,
      review_status: edge.review_status,
      rationale: edge.rationale
    }))
  }
}

/** ツール名 → 実行関数のディスパッチ。未知のツールは validation エラー。 */
export function callMcpTool(ctx: McpToolContext, name: string, rawArgs: unknown): unknown {
  const args = rawArgs === undefined || rawArgs === null ? {} : asRecord(rawArgs)
  switch (name) {
    case 'list_element_types':
      return listElementTypes(ctx)
    case 'get_element_type':
      return getElementType(ctx, args)
    case 'search_elements':
      return searchDesignElements(ctx, args)
    case 'get_elements':
      return getElements(ctx, args)
    case 'trace_upstream':
      return trace(ctx, args, 'backward')
    case 'trace_downstream':
      return trace(ctx, args, 'forward')
    default:
      throw new BackendError('validation', `未定義のツールです: ${name}`, '')
  }
}
