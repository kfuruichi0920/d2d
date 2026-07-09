/**
 * Editor Area 状態（P3-1、UI-006/021/022、sdd_ui_design §4.1/§10）。
 * Editor Area は画面ではなく Resource（URI）を開く。
 */
import { create } from 'zustand'

export interface EditorTab {
  /** Resource URI（例: project://current、settings://workspace、log://job/<id>） */
  uri: string
  title: string
  /** 一時表示タブ（シングルクリックで開いた場合）か、ピン留め済みか */
  preview: boolean
  dirty: boolean
}

export interface EditorGroup {
  id: number
  tabs: EditorTab[]
  activeUri: string | null
}

interface EditorState {
  groups: EditorGroup[]
  activeGroupId: number
  /** 選択中 Resource（Selection。Secondary Side Bar / Status Bar が参照） */
  activeUri: string | null

  openResource(uri: string, title: string, options?: { preview?: boolean; groupId?: number }): void
  closeTab(uri: string, groupId?: number): void
  activateTab(uri: string, groupId: number): void
  pinTab(uri: string): void
  setDirty(uri: string, dirty: boolean): void
  splitActiveGroup(): void
  closeGroup(groupId: number): void
}

let groupSeq = 2

export const useEditorStore = create<EditorState>((set, get) => ({
  groups: [{ id: 1, tabs: [], activeUri: null }],
  activeGroupId: 1,
  activeUri: null,

  openResource: (uri, title, options) => {
    const state = get()
    const groupId = options?.groupId ?? state.activeGroupId
    const groups = state.groups.map((g) => ({ ...g, tabs: [...g.tabs] }))
    const group = groups.find((g) => g.id === groupId) ?? groups[0]!

    const existing = group.tabs.find((t) => t.uri === uri)
    if (!existing) {
      const preview = options?.preview ?? false
      if (preview) {
        // プレビュータブは 1 グループに 1 つ（VSCode 同様）。既存プレビューを置き換える
        const previewIdx = group.tabs.findIndex((t) => t.preview)
        const tab: EditorTab = { uri, title, preview: true, dirty: false }
        if (previewIdx >= 0) {
          group.tabs[previewIdx] = tab
        } else {
          group.tabs.push(tab)
        }
      } else {
        group.tabs.push({ uri, title, preview: false, dirty: false })
      }
    } else if (options?.preview === false && existing.preview) {
      existing.preview = false
    }
    group.activeUri = uri
    set({ groups, activeGroupId: group.id, activeUri: uri })
  },

  closeTab: (uri, groupId) => {
    const state = get()
    const groups = state.groups.map((g) => ({ ...g, tabs: [...g.tabs] }))
    const group = groups.find((g) => g.id === (groupId ?? state.activeGroupId))
    if (!group) return
    const idx = group.tabs.findIndex((t) => t.uri === uri)
    if (idx < 0) return
    group.tabs.splice(idx, 1)
    if (group.activeUri === uri) {
      group.activeUri = group.tabs[Math.min(idx, group.tabs.length - 1)]?.uri ?? null
    }
    // 空になった追加グループは閉じる（先頭グループは残す）
    const finalGroups = groups.filter((g) => g.tabs.length > 0 || g.id === groups[0]!.id)
    const activeGroup = finalGroups.find((g) => g.id === state.activeGroupId) ?? finalGroups[0]!
    set({ groups: finalGroups, activeGroupId: activeGroup.id, activeUri: activeGroup.activeUri })
  },

  activateTab: (uri, groupId) => {
    const groups = get().groups.map((g) => (g.id === groupId ? { ...g, activeUri: uri } : g))
    set({ groups, activeGroupId: groupId, activeUri: uri })
  },

  pinTab: (uri) => {
    const groups = get().groups.map((g) => ({
      ...g,
      tabs: g.tabs.map((t) => (t.uri === uri ? { ...t, preview: false } : t))
    }))
    set({ groups })
  },

  setDirty: (uri, dirty) => {
    const groups = get().groups.map((g) => ({
      ...g,
      tabs: g.tabs.map((t) => (t.uri === uri ? { ...t, dirty } : t))
    }))
    set({ groups })
  },

  splitActiveGroup: () => {
    const state = get()
    if (state.groups.length >= 2) return // 初期実装は 2 分割まで
    const active = state.groups.find((g) => g.id === state.activeGroupId)
    const activeTab = active?.tabs.find((t) => t.uri === active.activeUri)
    const newGroup: EditorGroup = {
      id: groupSeq++,
      tabs: activeTab ? [{ ...activeTab, preview: false }] : [],
      activeUri: activeTab?.uri ?? null
    }
    set({ groups: [...state.groups, newGroup], activeGroupId: newGroup.id })
  },

  closeGroup: (groupId) => {
    const state = get()
    if (state.groups.length <= 1) return
    const groups = state.groups.filter((g) => g.id !== groupId)
    const activeGroup = groups[0]!
    set({ groups, activeGroupId: activeGroup.id, activeUri: activeGroup.activeUri })
  }
}))
