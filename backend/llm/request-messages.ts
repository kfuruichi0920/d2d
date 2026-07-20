/**
 * 画面別LLM問い合わせの送信メッセージ構築（P6-3/P6-4、LLM-024/040）。
 * プレビューと実行で同じメッセージを使用できるよう、既定プロンプトを一箇所へ集約する。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { getChunkText } from '../intermediate/intermediate-service'
import { RESOURCE_TYPE_DEFINITIONS } from '../resource/resource-service'
import type { ChatAttachment, ChatMessage } from './providers'

export type LlmRequestOperation =
  | 'connection-test'
  | 'semantic-terms'
  | 'semantic-proofread'
  | 'design-candidates'
  | 'resource-merge'
  | 'resource-description'
  | 'analysis-mcp-description'

export interface ResourceMergeSource {
  resourceUid?: string
  type: string
  values: Record<string, unknown>
  outlineContext?: Record<string, unknown> | null
}

/** 分析クエリ規則の MCP ツール向け説明の生成（MCP-012）。名称と DSL から用途説明を作る */
export function buildAnalysisMcpDescriptionMessages(name: string, dsl: string): ChatMessage[] {
  if (!dsl.trim()) throw new BackendError('validation', 'クエリ定義DSLが空です', '')
  return [
    {
      role: 'system',
      content:
        'あなたは設計トレーサビリティツールの支援AIです。与えられた設計分析クエリ規則（DSL）の内容から、' +
        'MCPツールとしてAIエージェントへ公開する際の説明文を日本語で1〜3文で作成してください。' +
        'DSL仕様: FROM TYPE=種別全要素を集合へ追加 / TRAVERSE 関係 UP(上流)|DOWN(下流)|BOTH DEPTH n=関係を辿って集合へ追加 / ' +
        'FILTER [NOT] TYPE|STATUS|ATTR=集合の絞り込み / SET SAVE|LOAD|UNION|INTERSECT|EXCEPT=集合演算 / ' +
        'PATH 関係 MAXDEPTH n=起点(start_uid)から終点(end_uid)への意味的経路の列挙。' +
        '説明には、何を入力（起点・終点の要否）し何が得られるかを含めてください。説明文だけを出力してください。'
    },
    { role: 'user', content: JSON.stringify({ name, dsl }) }
  ]
}

export function buildConnectionTestMessages(): ChatMessage[] {
  return [{ role: 'user', content: 'D2D 接続テストです。「OK」とだけ返答してください。' }]
}

export function buildSemanticTermMessages(
  text: string,
  outlineContext?: Record<string, unknown> | null
): ChatMessage[] {
  if (!text.trim()) throw new BackendError('validation', 'LLMへ送信する文章が空です', '')
  return [
    {
      role: 'system',
      content:
        '設計文と自動補完された文書アウトライン文脈から、未登録と思われる専門用語候補だけを抽出し、{"terms":["用語"]}形式のJSONで返してください。同義語や関係を確定しないでください。'
    },
    { role: 'user', content: JSON.stringify({ text, outlineContext: outlineContext ?? null }) }
  ]
}

export function buildSemanticProofreadMessages(
  text: string,
  outlineContext?: Record<string, unknown> | null
): ChatMessage[] {
  if (!text.trim()) throw new BackendError('validation', 'LLMへ送信する文章が空です', '')
  return [
    {
      role: 'system',
      content:
        '設計文書を校正し、冗長表現、不明確または曖昧な記載を具体的に改善してください。事実や設計判断を追加せず、{"revisedText":"修正文","issues":[{"kind":"redundant|unclear|ambiguous|grammar","message":"指摘"}]}形式のJSONだけを返してください。'
    },
    { role: 'user', content: JSON.stringify({ text, outlineContext: outlineContext ?? null }) }
  ]
}

export function buildDesignCandidateMessages(db: Database, chunkUid: string): ChatMessage[] {
  const chunkText = getChunkText(db, chunkUid)
  const chunkPrompt =
    (
      db.prepare('SELECT additional_prompt FROM chunk WHERE uid=?').get(chunkUid) as
        { additional_prompt: string } | undefined
    )?.additional_prompt ?? ''
  const modelDefinitions = db
    .prepare(
      `SELECT model_type, label, layer, definition, field_schema_json
                FROM ontology_model_definition WHERE is_enabled=1 ORDER BY sort_order, model_type`
    )
    .all() as Array<{ model_type: string; label: string; layer: string; definition: string; field_schema_json: string }>
  const relationDefinitions = db
    .prepare(
      `SELECT relation_type, label, definition, required_attr
                FROM ontology_relation_definition WHERE is_enabled=1 ORDER BY sort_order, relation_type`
    )
    .all() as Array<{ relation_type: string; label: string; definition: string; required_attr: string | null }>
  const allowances = db
    .prepare(
      `SELECT a.relation_type, a.source_model_type, a.target_model_type
         FROM ontology_relation_allowance a
         JOIN ontology_relation_definition r ON r.relation_type=a.relation_type AND r.is_enabled=1
         JOIN ontology_model_definition s ON s.model_type=a.source_model_type AND s.is_enabled=1
         JOIN ontology_model_definition t ON t.model_type=a.target_model_type AND t.is_enabled=1
        WHERE a.allowed=1
        ORDER BY a.relation_type, a.source_model_type, a.target_model_type`
    )
    .all() as Array<{ relation_type: string; source_model_type: string; target_model_type: string }>
  const systemPrompt = [
    'あなたは設計文書から設計モデル候補を抽出するAIです。',
    '以下の採用中オントロジー定義を判断基準として、本文から設計要素候補と関係候補を抽出してください。定義にないモデルや関係を作らないでください。',
    `設計モデル定義: ${JSON.stringify(modelDefinitions)}`,
    `設計モデル関係定義: ${JSON.stringify(relationDefinitions)}`,
    `関係の許容組合せ: ${JSON.stringify(allowances)}`,
    '次の JSON だけを出力してください。',
    '{"elements":[{"temp_id":"t1","category":"model_req","title":"...","description":"...","evidence":"根拠となる本文の抜粋"}],',
    ' "relations":[{"from_temp_id":"t2","to_temp_id":"t1","relation_type":"satisfies","rationale":"..."}],',
    ' "warnings":[]}',
    `category は有効な model_*（${modelDefinitions.map((model) => model.model_type).join('/')}）のいずれか。`,
    `relation_type は有効な関係（${relationDefinitions.map((relation) => relation.relation_type).join('/')}）のいずれか。`,
    '関係の from_temp_id / to_temp_id は elements の temp_id を参照し、許容組合せに従うこと。'
  ].join('\n')
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: chunkPrompt ? `${chunkText}\n\n追加指示:\n${chunkPrompt}` : chunkText }
  ]
}

export function buildResourceDescriptionMessages(
  resourceType: string,
  values: Record<string, unknown>,
  outlineContext?: Record<string, unknown> | null,
  attachment?: ChatAttachment
): ChatMessage[] {
  if (!['resource_figure', 'resource_table', 'resource_code', 'resource_formula'].includes(resourceType)) {
    throw new BackendError('validation', `説明生成に未対応のResource種別です: ${resourceType}`, '')
  }
  const kind =
    resourceType === 'resource_figure'
      ? '図'
      : resourceType === 'resource_table'
        ? '表'
        : resourceType === 'resource_code'
          ? '疑似コード'
          : '数式'
  return [
    {
      role: 'system',
      content: `あなたは設計文書の${kind}説明を作成するAIです。入力内容と文書アウトライン上の位置を正確に読み、推測で設計事実を追加せず、文書へそのまま記載できる説明文候補を{"description":"説明文"}形式のJSONだけで返してください。`
    },
    {
      role: 'user',
      content: JSON.stringify({ resourceType, values, outlineContext: outlineContext ?? null }),
      ...(attachment ? { attachments: [attachment] } : {})
    }
  ]
}
export function buildResourceMergeMessages(targetType: string, sources: ResourceMergeSource[]): ChatMessage[] {
  const definition = RESOURCE_TYPE_DEFINITIONS.find((candidate) => candidate.type === targetType)
  if (!definition) throw new BackendError('validation', `未対応のResource種別です: ${targetType}`, '')
  if (sources.length === 0) throw new BackendError('validation', 'マージ元Resourceがありません', '')
  return [
    {
      role: 'system',
      content:
        'あなたは設計情報の統合支援AIです。入力Resource群を意味を失わずに統合し、指定された出力フィールドだけを持つJSONオブジェクトを返してください。説明やMarkdownは出力しないでください。'
    },
    {
      role: 'user',
      content: JSON.stringify({
        targetType,
        outputFields: definition.fields.map((field) => ({
          name: field.name,
          label: field.label,
          kind: field.kind,
          required: field.required ?? false,
          description: field.description
        })),
        sources: sources.map((source) => ({
          ...source,
          inputFields:
            RESOURCE_TYPE_DEFINITIONS.find((item) => item.type === source.type)?.fields.map((field) => ({
              name: field.name,
              label: field.label,
              kind: field.kind,
              description: field.description
            })) ?? []
        }))
      })
    }
  ]
}
