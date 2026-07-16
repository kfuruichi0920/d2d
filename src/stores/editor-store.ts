/**
 * Editor Area状態（P3-1、UI-006/021/022/025/039/040、sdd_ui_design §10）。
 * Editor Groupを再帰splitツリーで保持し、タブ移動・分割比率・プロジェクト単位復元を一元管理する。
 */
import { create } from 'zustand'

export interface EditorTab {
  uri: string
  title: string
  preview: boolean
  dirty: boolean
}

export interface EditorGroup {
  id: number
  tabs: EditorTab[]
  activeUri: string | null
}

export type EditorSplitDirection = 'horizontal' | 'vertical'
export type EditorLayoutNode =
  | { kind: 'group'; groupId: number }
  | {
      kind: 'split'
      id: number
      direction: EditorSplitDirection
      ratio: number
      first: EditorLayoutNode
      second: EditorLayoutNode
    }

interface PersistedEditorLayout {
  groups: EditorGroup[]
  layout: EditorLayoutNode
  activeGroupId: number
}

interface EditorState {
  groups: EditorGroup[]
  layout: EditorLayoutNode
  activeGroupId: number
  activeUri: string | null
  persistKey: string
  openResource(uri: string, title: string, options?: { preview?: boolean; groupId?: number }): void
  closeTab(uri: string, groupId?: number): void
  activateTab(uri: string, groupId: number): void
  pinTab(uri: string): void
  setDirty(uri: string, dirty: boolean): void
  splitActiveGroup(direction?: EditorSplitDirection): void
  splitGroup(groupId: number, direction: EditorSplitDirection): void
  resizeSplit(splitId: number, deltaRatio: number): void
  moveTab(uri: string, fromGroupId: number, toGroupId: number, targetIndex?: number): void
  moveActiveTab(offset: -1 | 1): void
  closeGroup(groupId: number): void
  loadPersisted(persistKey: string): void
}

let groupSeq = 2
let splitSeq = 1
const INITIAL_LAYOUT: EditorLayoutNode = { kind: 'group', groupId: 1 }

function storageKey(persistKey: string): string {
  return 'd2d.editors.' + persistKey
}

function cloneGroups(groups: EditorGroup[]): EditorGroup[] {
  return groups.map((group) => ({ ...group, tabs: group.tabs.map((tab) => ({ ...tab })) }))
}

function replaceGroupNode(node: EditorLayoutNode, groupId: number, replacement: EditorLayoutNode): EditorLayoutNode {
  if (node.kind === 'group') return node.groupId === groupId ? replacement : node
  return {
    ...node,
    first: replaceGroupNode(node.first, groupId, replacement),
    second: replaceGroupNode(node.second, groupId, replacement)
  }
}

function updateSplit(
  node: EditorLayoutNode,
  splitId: number,
  update: (split: Extract<EditorLayoutNode, { kind: 'split' }>) => EditorLayoutNode
): EditorLayoutNode {
  if (node.kind === 'group') return node
  if (node.id === splitId) return update(node)
  return { ...node, first: updateSplit(node.first, splitId, update), second: updateSplit(node.second, splitId, update) }
}

function pruneLayout(node: EditorLayoutNode, validGroupIds: Set<number>): EditorLayoutNode | null {
  if (node.kind === 'group') return validGroupIds.has(node.groupId) ? node : null
  const first = pruneLayout(node.first, validGroupIds)
  const second = pruneLayout(node.second, validGroupIds)
  if (!first) return second
  if (!second) return first
  return { ...node, first, second }
}

function groupOrder(node: EditorLayoutNode): number[] {
  if (node.kind === 'group') return [node.groupId]
  return [...groupOrder(node.first), ...groupOrder(node.second)]
}

function clampRatio(value: number): number {
  return Math.max(0.15, Math.min(0.85, value))
}

function persist(state: EditorState): void {
  try {
    const data: PersistedEditorLayout = {
      groups: state.groups,
      layout: state.layout,
      activeGroupId: state.activeGroupId
    }
    localStorage.setItem(storageKey(state.persistKey), JSON.stringify(data))
  } catch {
    // レイアウト永続化失敗は編集操作を妨げない。
  }
}

function commit(
  set: (partial: Partial<EditorState>) => void,
  get: () => EditorState,
  partial: Partial<EditorState>
): void {
  set(partial)
  persist(get())
}

export const useEditorStore = create<EditorState>((set, get) => ({
  groups: [{ id: 1, tabs: [], activeUri: null }],
  layout: INITIAL_LAYOUT,
  activeGroupId: 1,
  activeUri: null,
  persistKey: 'global',

  openResource: (uri, title, options) => {
    const state = get()
    const groupId = options?.groupId ?? state.activeGroupId
    const groups = cloneGroups(state.groups)
    const group = groups.find((candidate) => candidate.id === groupId) ?? groups[0]!
    const existing = group.tabs.find((tab) => tab.uri === uri)
    if (!existing) {
      const preview = options?.preview ?? false
      const tab: EditorTab = { uri, title, preview, dirty: false }
      if (preview) {
        const previewIndex = group.tabs.findIndex((candidate) => candidate.preview)
        if (previewIndex >= 0) group.tabs[previewIndex] = tab
        else group.tabs.push(tab)
      } else {
        group.tabs.push(tab)
      }
    } else if (options?.preview === false && existing.preview) {
      existing.preview = false
    }
    group.activeUri = uri
    commit(set, get, { groups, activeGroupId: group.id, activeUri: uri })
  },

  closeTab: (uri, groupId) => {
    const state = get()
    let groups = cloneGroups(state.groups)
    const group = groups.find((candidate) => candidate.id === (groupId ?? state.activeGroupId))
    if (!group) return
    const index = group.tabs.findIndex((tab) => tab.uri === uri)
    if (index < 0) return
    group.tabs.splice(index, 1)
    if (group.activeUri === uri) group.activeUri = group.tabs[Math.min(index, group.tabs.length - 1)]?.uri ?? null
    if (group.tabs.length === 0 && groups.length > 1) groups = groups.filter((candidate) => candidate.id !== group.id)
    const layout =
      pruneLayout(state.layout, new Set(groups.map((candidate) => candidate.id))) ??
      ({ kind: 'group', groupId: groups[0]!.id } as const)
    const activeGroup = groups.find((candidate) => candidate.id === state.activeGroupId) ?? groups[0]!
    commit(set, get, { groups, layout, activeGroupId: activeGroup.id, activeUri: activeGroup.activeUri })
  },

  activateTab: (uri, groupId) => {
    const groups = get().groups.map((group) => (group.id === groupId ? { ...group, activeUri: uri } : group))
    commit(set, get, { groups, activeGroupId: groupId, activeUri: uri })
  },

  pinTab: (uri) => {
    const groups = get().groups.map((group) => ({
      ...group,
      tabs: group.tabs.map((tab) => (tab.uri === uri ? { ...tab, preview: false } : tab))
    }))
    commit(set, get, { groups })
  },

  setDirty: (uri, dirty) => {
    const groups = get().groups.map((group) => ({
      ...group,
      tabs: group.tabs.map((tab) => (tab.uri === uri ? { ...tab, dirty } : tab))
    }))
    commit(set, get, { groups })
  },

  splitActiveGroup: (direction = 'horizontal') => get().splitGroup(get().activeGroupId, direction),

  splitGroup: (groupId, direction) => {
    const state = get()
    const source = state.groups.find((group) => group.id === groupId)
    if (!source) return
    const activeTab = source.tabs.find((tab) => tab.uri === source.activeUri)
    const newGroup: EditorGroup = {
      id: groupSeq++,
      tabs: activeTab ? [{ ...activeTab, preview: false }] : [],
      activeUri: activeTab?.uri ?? null
    }
    const split: EditorLayoutNode = {
      kind: 'split',
      id: splitSeq++,
      direction,
      ratio: 0.5,
      first: { kind: 'group', groupId },
      second: { kind: 'group', groupId: newGroup.id }
    }
    commit(set, get, {
      groups: [...state.groups, newGroup],
      layout: replaceGroupNode(state.layout, groupId, split),
      activeGroupId: newGroup.id,
      activeUri: newGroup.activeUri
    })
  },

  resizeSplit: (splitId, deltaRatio) => {
    const layout = updateSplit(get().layout, splitId, (split) => ({
      ...split,
      ratio: clampRatio(split.ratio + deltaRatio)
    }))
    commit(set, get, { layout })
  },

  moveTab: (uri, fromGroupId, toGroupId, targetIndex) => {
    if (fromGroupId === toGroupId) return
    const state = get()
    let groups = cloneGroups(state.groups)
    const source = groups.find((group) => group.id === fromGroupId)
    const target = groups.find((group) => group.id === toGroupId)
    if (!source || !target) return
    const sourceIndex = source.tabs.findIndex((tab) => tab.uri === uri)
    if (sourceIndex < 0) return
    const [tab] = source.tabs.splice(sourceIndex, 1)
    if (!tab) return
    if (!target.tabs.some((candidate) => candidate.uri === uri)) {
      const index = Math.max(0, Math.min(targetIndex ?? target.tabs.length, target.tabs.length))
      target.tabs.splice(index, 0, { ...tab, preview: false })
    }
    target.activeUri = uri
    if (source.activeUri === uri)
      source.activeUri = source.tabs[Math.min(sourceIndex, source.tabs.length - 1)]?.uri ?? null
    if (source.tabs.length === 0 && groups.length > 1) groups = groups.filter((group) => group.id !== source.id)
    const layout =
      pruneLayout(state.layout, new Set(groups.map((group) => group.id))) ??
      ({ kind: 'group', groupId: target.id } as const)
    commit(set, get, { groups, layout, activeGroupId: target.id, activeUri: uri })
  },

  moveActiveTab: (offset) => {
    const state = get()
    if (!state.activeUri || state.groups.length < 2) return
    const order = groupOrder(state.layout)
    const current = order.indexOf(state.activeGroupId)
    const targetGroupId = order[(current + offset + order.length) % order.length]!
    state.moveTab(state.activeUri, state.activeGroupId, targetGroupId)
  },

  closeGroup: (groupId) => {
    const state = get()
    if (state.groups.length <= 1) return
    const groups = state.groups.filter((group) => group.id !== groupId)
    const layout =
      pruneLayout(state.layout, new Set(groups.map((group) => group.id))) ??
      ({ kind: 'group', groupId: groups[0]!.id } as const)
    const activeGroup = groups[0]!
    commit(set, get, { groups, layout, activeGroupId: activeGroup.id, activeUri: activeGroup.activeUri })
  },

  loadPersisted: (persistKey) => {
    let data: PersistedEditorLayout | null = null
    try {
      const raw = localStorage.getItem(storageKey(persistKey))
      if (raw) data = JSON.parse(raw) as PersistedEditorLayout
    } catch {
      data = null
    }
    if (!data || data.groups.length === 0) {
      if (get().persistKey !== persistKey) {
        groupSeq = 2
        splitSeq = 1
        set({
          persistKey,
          groups: [{ id: 1, tabs: [], activeUri: null }],
          layout: INITIAL_LAYOUT,
          activeGroupId: 1,
          activeUri: null
        })
      } else {
        set({ persistKey })
      }
      return
    }
    const valid = new Set(data.groups.map((group) => group.id))
    const layout = pruneLayout(data.layout, valid) ?? { kind: 'group' as const, groupId: data.groups[0]!.id }
    groupSeq = Math.max(...data.groups.map((group) => group.id)) + 1
    const collectSplitIds = (node: EditorLayoutNode): number[] =>
      node.kind === 'group' ? [] : [node.id, ...collectSplitIds(node.first), ...collectSplitIds(node.second)]
    splitSeq = Math.max(0, ...collectSplitIds(layout)) + 1
    const activeGroup = data.groups.find((group) => group.id === data.activeGroupId) ?? data.groups[0]!
    set({
      persistKey,
      groups: cloneGroups(data.groups),
      layout,
      activeGroupId: activeGroup.id,
      activeUri: activeGroup.activeUri
    })
  }
}))
