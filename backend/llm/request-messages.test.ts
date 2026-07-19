import { describe, expect, it } from 'vitest'
import {
  buildResourceDescriptionMessages,
  buildResourceMergeMessages,
  buildSemanticProofreadMessages,
  buildSemanticTermMessages
} from './request-messages'

describe('画面別LLM問い合わせメッセージ（P6-3/P6-4、LLM-024/040）', () => {
  it('セマンティック用語候補は確定処理を禁止する指示と対象文章を分離する', () => {
    const messages = buildSemanticTermMessages('車載ECUは診断要求を処理する。')
    expect(messages).toHaveLength(2)
    expect(messages[0]).toMatchObject({ role: 'system' })
    expect(messages[0]!.content).toContain('同義語や関係を確定しない')
    expect(JSON.parse(messages[1]!.content)).toEqual({ text: '車載ECUは診断要求を処理する。', outlineContext: null })
  })

  it('Resourceマージは画面で選択した出力種別・フィールド・入力Resourceを送信内容へ含める', () => {
    const messages = buildResourceMergeMessages('resource_text', [
      { resourceUid: 'r1', type: 'resource_text', values: { text_body: '要求A' } }
    ])
    expect(messages[0]!.content).toContain('JSONオブジェクト')
    const payload = JSON.parse(messages[1]!.content) as Record<string, unknown>
    expect(payload.targetType).toBe('resource_text')
    expect(payload.sources).toEqual([
      expect.objectContaining({ resourceUid: 'r1', type: 'resource_text', values: { text_body: '要求A' } })
    ])
  })

  it('Resourceマージは入出力フィールド定義・説明とアウトライン文脈を送る', () => {
    const messages = buildResourceMergeMessages('resource_text', [
      {
        resourceUid: 'r1',
        type: 'resource_text',
        values: { text_body: '要求A' },
        outlineContext: { parent: { id: 'chapter-1' } }
      }
    ])
    const payload = JSON.parse(messages[1]!.content) as {
      outputFields: Array<{ name: string; description: string }>
      sources: Array<{ inputFields: Array<{ name: string }>; outlineContext: unknown }>
    }
    expect(payload.outputFields.find((field) => field.name === 'text_body')?.description).toBeTruthy()
    expect(payload.sources[0]!.inputFields.some((field) => field.name === 'text_body')).toBe(true)
    expect(payload.sources[0]!.outlineContext).toEqual({ parent: { id: 'chapter-1' } })
  })

  it('校正・正規化は修正文と曖昧性等の指摘をJSONで要求しアウトライン文脈を送る', () => {
    const messages = buildSemanticProofreadMessages('適切に処理する。', { outlineIndex: 2 })
    expect(messages[0]!.content).toContain('revisedText')
    expect(messages[0]!.content).toContain('曖昧')
    expect(JSON.parse(messages[1]!.content)).toEqual({ text: '適切に処理する。', outlineContext: { outlineIndex: 2 } })
  })

  it('Resource説明は図添付・Resource値・アウトライン文脈を同じ確認対象へ含める', () => {
    const messages = buildResourceDescriptionMessages(
      'resource_figure',
      { image_uri: 'blobs/extracted/figure.png', figure_number: '図1' },
      { outlineIndex: 3 },
      { mediaType: 'image/png', data: 'aW1hZ2U=' }
    )
    expect(messages[0]!.content).toContain('説明文')
    expect(JSON.parse(messages[1]!.content)).toMatchObject({
      resourceType: 'resource_figure',
      values: { figure_number: '図1' },
      outlineContext: { outlineIndex: 3 }
    })
    expect(messages[1]!.attachments).toEqual([{ mediaType: 'image/png', data: 'aW1hZ2U=' }])
  })
  it('未対応Resource種別と空文章を送信前に拒否する', () => {
    expect(() => buildResourceMergeMessages('unknown', [])).toThrowError(/未対応/)
    expect(() => buildSemanticTermMessages('  ')).toThrowError(/空/)
  })
})
