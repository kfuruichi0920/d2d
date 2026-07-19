import { describe, expect, it } from 'vitest'
import { buildResourceMergeMessages, buildSemanticTermMessages } from './request-messages'

describe('画面別LLM問い合わせメッセージ（P6-3/P6-4、LLM-024/040）', () => {
  it('セマンティック用語候補は確定処理を禁止する指示と対象文章を分離する', () => {
    const messages = buildSemanticTermMessages('車載ECUは診断要求を処理する。')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'system' })
    expect(messages[0]!.content).toContain('同義語や関係を確定しない')
    expect(messages[1]).toEqual({ role: 'user', content: '車載ECUは診断要求を処理する。' })
  })

  it('Resourceマージは画面で選択した出力種別・フィールド・入力Resourceを送信内容へ含める', () => {
    const messages = buildResourceMergeMessages('resource_text', [
      { resourceUid: 'r1', type: 'resource_text', values: { text_body: '要求A' } }
    ])
    expect(messages[0]!.content).toContain('JSONオブジェクト')
    const payload = JSON.parse(messages[1]!.content) as Record<string, unknown>
    expect(payload.targetType).toBe('resource_text')
    expect(payload.sources).toEqual([{ resourceUid: 'r1', type: 'resource_text', values: { text_body: '要求A' } }])
  })

  it('未対応Resource種別と空文章を送信前に拒否する', () => {
    expect(() => buildResourceMergeMessages('unknown', [])).toThrowError(/未対応/)
    expect(() => buildSemanticTermMessages('  ')).toThrowError(/空/)
  })
})
