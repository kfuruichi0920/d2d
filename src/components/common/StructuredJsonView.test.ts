import { describe, expect, it } from 'vitest'
import { getJsonNodeKind } from './StructuredJsonView'

describe('getJsonNodeKind（形式非依存のstructure_json表示）', () => {
  it('objectとarrayを階層ノードとして識別する', () => {
    expect(getJsonNodeKind({ metadata: {} })).toBe('object')
    expect(getJsonNodeKind([{ type: 'paragraph' }])).toBe('array')
  })

  it('キーワード色分けに使うプリミティブ型を識別する', () => {
    expect(getJsonNodeKind('text')).toBe('string')
    expect(getJsonNodeKind(12)).toBe('number')
    expect(getJsonNodeKind(true)).toBe('boolean')
  })

  it('nullをobjectと区別する', () => {
    expect(getJsonNodeKind(null)).toBe('null')
  })
})
