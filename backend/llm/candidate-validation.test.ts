import { describe, expect, it } from 'vitest'
import { validateCandidateOutput } from './candidate-validation'

const VALID = {
  normalized_text: '正規化済み本文',
  elements: [
    { temp_id: 't1', category: 'model_req', title: 'ログインできること' },
    { temp_id: 't2', category: 'model_func', title: '認証機能' }
  ],
  relations: [{ from_temp_id: 't2', to_temp_id: 't1', relation_type: 'satisfies' }],
  warnings: []
}

describe('LLM 構造化出力検証（P6-5、LLM-045/046）', () => {
  it('正しい候補セットを受理する（コードフェンス付きも可）', () => {
    expect(validateCandidateOutput(JSON.stringify(VALID)).ok).toBe(true)
    const fenced = '```json\n' + JSON.stringify(VALID) + '\n```'
    const result = validateCandidateOutput(fenced)
    expect(result.ok).toBe(true)
    expect(result.candidateSet!.elements).toHaveLength(2)
  })

  it('JSON パース失敗をエラーとして返す', () => {
    const result = validateCandidateOutput('これはJSONではない')
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('JSON パース')
  })

  it('スキーマ不一致（model_* でないカテゴリ・命名規則外の relation_type）を検出する', () => {
    const badCategory = { ...VALID, elements: [{ temp_id: 't1', category: 'INVALID', title: 'x' }] }
    expect(validateCandidateOutput(JSON.stringify(badCategory)).ok).toBe(false)

    const badRelation = {
      ...VALID,
      relations: [{ from_temp_id: 't1', to_temp_id: 't2', relation_type: 'INVALID-RELATION' }]
    }
    const result = validateCandidateOutput(JSON.stringify(badRelation))
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('スキーマ不一致')
  })

  it('未解決 temp_id 参照・自己参照・重複 temp_id を検出する（LLM-046）', () => {
    const unresolved = {
      ...VALID,
      relations: [{ from_temp_id: 't1', to_temp_id: 'missing', relation_type: 'relates_to' }]
    }
    const r1 = validateCandidateOutput(JSON.stringify(unresolved))
    expect(r1.ok).toBe(false)
    expect(r1.errors.some((e) => e.includes('未解決'))).toBe(true)

    const selfRef = {
      ...VALID,
      relations: [{ from_temp_id: 't1', to_temp_id: 't1', relation_type: 'relates_to' }]
    }
    expect(validateCandidateOutput(JSON.stringify(selfRef)).errors.some((e) => e.includes('自己参照'))).toBe(true)

    const dup = {
      ...VALID,
      elements: [
        { temp_id: 't1', category: 'model_req', title: 'a' },
        { temp_id: 't1', category: 'model_func', title: 'b' }
      ],
      relations: []
    }
    expect(validateCandidateOutput(JSON.stringify(dup)).errors.some((e) => e.includes('重複'))).toBe(true)
  })
})
