import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editor-store'

function reset(): void {
  useEditorStore.setState({
    groups: [{ id: 1, tabs: [], activeUri: null }],
    activeGroupId: 1,
    activeUri: null
  })
}

describe('editor-store（P3-1、Resource タブ管理）', () => {
  beforeEach(reset)

  it('Resource を開くとタブが追加されアクティブになる', () => {
    const s = useEditorStore.getState()
    s.openResource('project://current', 'ダッシュボード')
    const state = useEditorStore.getState()
    expect(state.groups[0]!.tabs).toHaveLength(1)
    expect(state.activeUri).toBe('project://current')
  })

  it('同じ URI は重複して開かない', () => {
    const s = useEditorStore.getState()
    s.openResource('settings://workspace', '設定')
    s.openResource('settings://workspace', '設定')
    expect(useEditorStore.getState().groups[0]!.tabs).toHaveLength(1)
  })

  it('プレビュータブは 1 グループに 1 つで置き換えられる', () => {
    const s = useEditorStore.getState()
    s.openResource('log://job/a', 'Job a', { preview: true })
    s.openResource('log://job/b', 'Job b', { preview: true })
    const tabs = useEditorStore.getState().groups[0]!.tabs
    expect(tabs).toHaveLength(1)
    expect(tabs[0]!.uri).toBe('log://job/b')

    // ピン留めすると置き換え対象から外れる
    useEditorStore.getState().pinTab('log://job/b')
    useEditorStore.getState().openResource('log://job/c', 'Job c', { preview: true })
    expect(useEditorStore.getState().groups[0]!.tabs).toHaveLength(2)
  })

  it('タブを閉じると隣のタブがアクティブになる', () => {
    const s = useEditorStore.getState()
    s.openResource('a://1', 'A')
    s.openResource('b://2', 'B')
    s.openResource('c://3', 'C')
    useEditorStore.getState().closeTab('c://3')
    expect(useEditorStore.getState().activeUri).toBe('b://2')
  })

  it('Editor 分割でアクティブタブが新グループへ複製される（UI-006）', () => {
    const s = useEditorStore.getState()
    s.openResource('a://1', 'A')
    useEditorStore.getState().splitActiveGroup()
    const state = useEditorStore.getState()
    expect(state.groups).toHaveLength(2)
    expect(state.groups[1]!.tabs[0]!.uri).toBe('a://1')
    // 初期実装は 2 分割まで
    state.splitActiveGroup()
    expect(useEditorStore.getState().groups).toHaveLength(2)
  })

  it('dirty 状態を管理できる', () => {
    const s = useEditorStore.getState()
    s.openResource('a://1', 'A')
    useEditorStore.getState().setDirty('a://1', true)
    expect(useEditorStore.getState().groups[0]!.tabs[0]!.dirty).toBe(true)
  })
})
