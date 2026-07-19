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

export interface ResourceMergeSource {
  resourceUid?: string
  type: string
  values: Record<string, unknown>
  outlineContext?: Record<string, unknown> | null
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
  const systemPrompt = [
    'あなたは設計文書から設計モデル候補を抽出するAIです。',
    '与えられた本文から設計要素候補と関係候補を抽出し、次の JSON だけを出力してください。',
    '{"elements":[{"temp_id":"t1","category":"REQ","title":"...","description":"...","evidence":"根拠となる本文の抜粋"}],',
    ' "relations":[{"from_temp_id":"t2","to_temp_id":"t1","relation_type":"satisfies","rationale":"..."}],',
    ' "warnings":[]}',
    'category は STD/REQ/CST/FUNC/STRUCT/BEH/STATE/IF/DATA/VERIF/MGMT/IMPL のいずれか。',
    'relation_type は based_on/satisfies/allocated_to/verifies/contains/decomposes/implements/uses/calls/conflicts_with/relates_to のいずれか。',
    '関係の from_temp_id / to_temp_id は elements の temp_id を参照すること。'
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
