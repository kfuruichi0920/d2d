import { beforeEach, describe, expect, it } from 'vitest'
import { useEditorStore } from './editor-store'

function reset(): void {
  useEditorStore.setState({
    groups: [{ id: 1, tabs: [], activeUri: null }],
    layout: { kind: 'group', groupId: 1 },
    activeGroupId: 1,
    activeUri: null,
    persistKey: 'test'
  })
}

describe('editor-store（P3-1、UI-006/039/040）', () => {
  beforeEach(reset)

  it('Resourceを開くとタブが追加されアクティブになる', () => {
    useEditorStore.getState().openResource('project://current', 'ダッシュボード')
    expect(useEditorStore.getState().groups[0]!.tabs).toHaveLength(1)
    expect(useEditorStore.getState().activeUri).toBe('project://current')
  })

  it('同じURIは重複して開かない', () => {
    const state = useEditorStore.getState()
    state.openResource('settings://workspace', '設定')
    state.openResource('settings://workspace', '設定')
    expect(useEditorStore.getState().groups[0]!.tabs).toHaveLength(1)
  })

  it('プレビュータブは1 Groupに1つで置き換えられる', () => {
    const state = useEditorStore.getState()
    state.openResource('log://job/a', 'Job a', { preview: true })
    state.openResource('log://job/b', 'Job b', { preview: true })
    expect(useEditorStore.getState().groups[0]!.tabs.map((tab) => tab.uri)).toEqual(['log://job/b'])
    useEditorStore.getState().pinTab('log://job/b')
    useEditorStore.getState().openResource('log://job/c', 'Job c', { preview: true })
    expect(useEditorStore.getState().groups[0]!.tabs).toHaveLength(2)
  })

  it('左右・上下へ再帰的に分割できる', () => {
    useEditorStore.getState().openResource('a://1', 'A')
    useEditorStore.getState().splitActiveGroup('horizontal')
    const secondGroup = useEditorStore.getState().activeGroupId
    useEditorStore.getState().splitGroup(secondGroup, 'vertical')
    const state = useEditorStore.getState()
    expect(state.groups).toHaveLength(3)
    expect(state.layout).toMatchObject({
      kind: 'split',
      direction: 'horizontal',
      second: { kind: 'split', direction: 'vertical' }
    })
  })

  it('分割比率は15〜85%に制限する', () => {
    useEditorStore.getState().openResource('a://1', 'A')
    useEditorStore.getState().splitActiveGroup('horizontal')
    const layout = useEditorStore.getState().layout
    expect(layout.kind).toBe('split')
    if (layout.kind !== 'split') return
    useEditorStore.getState().resizeSplit(layout.id, 1)
    expect(useEditorStore.getState().layout).toMatchObject({ ratio: 0.85 })
    useEditorStore.getState().resizeSplit(layout.id, -2)
    expect(useEditorStore.getState().layout).toMatchObject({ ratio: 0.15 })
  })

  it('タブを別Groupへ移動し、空の移動元をsplitツリーから縮約する', () => {
    const state = useEditorStore.getState()
    state.openResource('a://1', 'A')
    state.openResource('b://2', 'B')
    state.splitActiveGroup('horizontal')
    const targetGroupId = useEditorStore.getState().activeGroupId
    useEditorStore.getState().activateTab('a://1', 1)
    useEditorStore.getState().moveTab('a://1', 1, targetGroupId)
    expect(useEditorStore.getState().groups.find((group) => group.id === targetGroupId)?.activeUri).toBe('a://1')
    useEditorStore.getState().moveTab('b://2', 1, targetGroupId)
    expect(useEditorStore.getState().groups).toHaveLength(1)
    expect(useEditorStore.getState().layout).toEqual({ kind: 'group', groupId: targetGroupId })
  })

  it('Command用の相対移動でアクティブタブを次Groupへ移動できる', () => {
    const state = useEditorStore.getState()
    state.openResource('a://1', 'A')
    state.openResource('b://2', 'B')
    state.splitActiveGroup('vertical')
    useEditorStore.getState().activateTab('b://2', 1)
    useEditorStore.getState().moveActiveTab(1)
    expect(useEditorStore.getState().groups.find((group) => group.id !== 1)?.activeUri).toBe('b://2')
  })

  it('dirty状態を管理できる', () => {
    useEditorStore.getState().openResource('a://1', 'A')
    useEditorStore.getState().setDirty('a://1', true)
    expect(useEditorStore.getState().groups[0]!.tabs[0]!.dirty).toBe(true)
  })
})
