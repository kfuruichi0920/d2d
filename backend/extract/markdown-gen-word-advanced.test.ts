/**
 * Word高度抽出要素のレビュー派生表示（P5-17、EXT-043）。
 */
import { describe, expect, it } from 'vitest'
import { generateMarkdown } from './markdown-gen'

describe('Word高度抽出Markdown', () => {
  it('図形内文字とコネクタ上文字をレビュー表示へ残す', () => {
    const markdown = generateMarkdown(
      [
        { id: 'shape-1', type: 'shape', text: '入力処理' },
        { id: 'connector-1', type: 'connector', text: '成功時' },
        { id: 'group-1', type: 'group_shape' }
      ],
      'review'
    )

    expect(markdown).toContain('入力処理 <!-- shape-1 -->')
    expect(markdown).toContain('成功時 <!-- connector-1 -->')
    expect(markdown).not.toContain('group-1')
  })
})
