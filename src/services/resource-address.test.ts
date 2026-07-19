import { describe, expect, it } from 'vitest'
import { resolveResourceAddress } from './resource-address'

describe('resolveResourceAddress（UI-046）', () => {
  it('既知のEditor URIを受理する', () => {
    expect(resolveResourceAddress(' resource://019f-resource ')).toEqual({
      uri: 'resource://019f-resource',
      title: 'Resource'
    })
    expect(resolveResourceAddress('trace://list-link/pipeline')).toEqual({
      uri: 'trace://list-link/pipeline',
      title: 'トレーサビリティ'
    })
    expect(resolveResourceAddress('trace://list-link')).toEqual({
      uri: 'trace://list-link',
      title: 'トレーサビリティ'
    })
  })

  it('不明なscheme・空識別子・空文字を拒否する', () => {
    expect(resolveResourceAddress('https://example.com')).toBeNull()
    expect(resolveResourceAddress('resource://')).toBeNull()
    expect(resolveResourceAddress('')).toBeNull()
  })
})
