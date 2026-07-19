import { describe, expect, it } from 'vitest'
import { resolveButtonIcon } from './GlobalButtonTooltips'

describe('Workbench共通レスポンシブボタン（UI-053）', () => {
  it('操作名から狭幅時にも意味を保つアイコンを解決する', () => {
    expect(resolveButtonIcon('検索')).toBe('⌕')
    expect(resolveButtonIcon('成果物を削除')).toBe('−')
    expect(resolveButtonIcon('設定を開く')).toBe('⚙')
    expect(resolveButtonIcon('固有操作')).toBe('◆')
  })
})
