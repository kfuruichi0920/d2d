import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from '../stores/editor-store'
import {
  canNavigateBack,
  canNavigateForward,
  clearNavigationHistory,
  initNavigationHistory,
  navigateBack,
  navigateForward
} from './navigation-history'

describe('navigation-history（W9）', () => {
  let dispose: (() => void) | undefined

  beforeEach(() => {
    useEditorStore.setState({
      groups: [{ id: 1, tabs: [], activeUri: null }],
      layout: { kind: 'group', groupId: 1 },
      activeGroupId: 1,
      activeUri: null
    })
    dispose?.()
    dispose = initNavigationHistory()
    clearNavigationHistory()
  })

  it('Resource遷移を記録し、戻る／進むで行き来できる', () => {
    const editor = useEditorStore.getState()
    editor.openResource('a://1', 'A')
    useEditorStore.getState().openResource('b://2', 'B')
    useEditorStore.getState().openResource('c://3', 'C')

    expect(canNavigateBack()).toBe(true)
    expect(navigateBack()).toBe(true)
    expect(useEditorStore.getState().activeUri).toBe('b://2')
    expect(navigateBack()).toBe(true)
    expect(useEditorStore.getState().activeUri).toBe('a://1')
    expect(canNavigateForward()).toBe(true)
    expect(navigateForward()).toBe(true)
    expect(useEditorStore.getState().activeUri).toBe('b://2')
  })

  it('戻った後に新しい遷移をすると進む履歴はクリアされる', () => {
    useEditorStore.getState().openResource('a://1', 'A')
    useEditorStore.getState().openResource('b://2', 'B')
    navigateBack()
    useEditorStore.getState().openResource('d://4', 'D')
    expect(canNavigateForward()).toBe(false)
    expect(navigateBack()).toBe(true)
    expect(useEditorStore.getState().activeUri).toBe('a://1')
  })

  it('履歴が空なら false を返す', () => {
    expect(navigateBack()).toBe(false)
    expect(navigateForward()).toBe(false)
  })

  it('閉じたタブへ戻ると同じタイトルで開き直す', () => {
    useEditorStore.getState().openResource('a://1', 'タイトルA')
    useEditorStore.getState().openResource('b://2', 'B')
    useEditorStore.getState().closeTab('a://1', 1)
    expect(navigateBack()).toBe(true)
    const state = useEditorStore.getState()
    expect(state.activeUri).toBe('a://1')
    expect(state.groups[0]!.tabs.find((tab) => tab.uri === 'a://1')?.title).toBe('タイトルA')
  })
})
