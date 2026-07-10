/**
 * LLM 構造化出力の検証（P6-5、LLM-045/046）。
 * JSON パース → スキーマ検証 → 参照整合検査（未解決 temp_id・重複 temp_id）。
 * エラーがある候補セットは正本反映をブロックする（呼び出し側は errors を UI 表示する）。
 */
import { validateSchema } from '../schemas'
import { BackendError } from '../api/errors'

export interface CandidateElement {
  temp_id: string
  category: string
  title: string
  description?: string | null
  confidence?: number | null
  evidence?: string | null
}

export interface CandidateRelation {
  from_temp_id: string
  to_temp_id: string
  relation_type: string
  confidence?: number | null
  rationale?: string | null
  attributes?: Record<string, unknown> | null
}

export interface CandidateSet {
  normalized_text?: string | null
  elements: CandidateElement[]
  relations: CandidateRelation[]
  warnings?: string[]
}

export interface CandidateValidationResult {
  ok: boolean
  candidateSet: CandidateSet | null
  errors: string[]
}

/**
 * LLM 応答テキストを候補セットとして検証する。
 * 例外は投げず、errors に集約して返す（候補セットのエラー表示に使う。LLM-046）。
 */
export function validateCandidateOutput(rawText: string): CandidateValidationResult {
  const errors: string[] = []

  // 1) JSON パース（コードフェンス付き応答も許容する）
  let json: unknown
  const stripped = rawText.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  try {
    json = JSON.parse(stripped)
  } catch (err) {
    return {
      ok: false,
      candidateSet: null,
      errors: [`JSON パースに失敗しました: ${err instanceof Error ? err.message : String(err)}`]
    }
  }

  // 2) スキーマ検証
  let candidateSet: CandidateSet
  try {
    candidateSet = validateSchema<CandidateSet>('d2d://schemas/llm-candidate-set', json, 'LLM 候補セット')
  } catch (err) {
    return {
      ok: false,
      candidateSet: null,
      errors: [err instanceof BackendError ? `スキーマ不一致: ${err.detail || err.message}` : String(err)]
    }
  }

  // 3) 参照整合検査
  const tempIds = new Set<string>()
  for (const element of candidateSet.elements) {
    if (tempIds.has(element.temp_id)) {
      errors.push(`要素候補の temp_id が重複しています: ${element.temp_id}`)
    }
    tempIds.add(element.temp_id)
  }
  candidateSet.relations.forEach((relation, i) => {
    if (!tempIds.has(relation.from_temp_id)) {
      errors.push(`関係候補[${i}] の from_temp_id が未解決です: ${relation.from_temp_id}`)
    }
    if (!tempIds.has(relation.to_temp_id)) {
      errors.push(`関係候補[${i}] の to_temp_id が未解決です: ${relation.to_temp_id}`)
    }
    if (relation.from_temp_id === relation.to_temp_id) {
      errors.push(`関係候補[${i}] が自己参照です: ${relation.from_temp_id}`)
    }
  })

  return { ok: errors.length === 0, candidateSet, errors }
}
