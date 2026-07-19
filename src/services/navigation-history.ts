/**
 * リンク移動の戻る／進む（W9、UI-006 拡張）。
 * Editor のアクティブResource遷移を履歴として記録し、Alt+←／Alt+→ で行き来する。
 * 閉じたタブへ戻る場合は同じ URI・タイトルで開き直す。履歴はメモリのみ（永続化しない）。
 */
import { useEditorStore } from '../stores/editor-store'

interface NavigationEntry {
  uri: string
  title: string
}

const MAX_HISTORY = 100

let backStack: NavigationEntry[] = []
let forwardStack: NavigationEntry[] = []
let current: NavigationEntry | null = null
/** back/forward 実行による遷移を履歴へ再記録しないためのフラグ */
let navigating = false
let unsubscribe: (() => void) | null = null
const listeners = new Set<() => void>()

function notifyListeners(): void {
  for (const listener of listeners) listener()
}

export function subscribeNavigationHistory(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function titleOf(uri: string): string {
  for (const group of useEditorStore.getState().groups) {
    const tab = group.tabs.find((candidate) => candidate.uri === uri)
    if (tab) return tab.title
  }
  return uri
}

function record(uri: string): void {
  if (navigating) return
  if (current?.uri === uri) return
  if (current) {
    backStack.push(current)
    if (backStack.length > MAX_HISTORY) backStack = backStack.slice(-MAX_HISTORY)
  }
  current = { uri, title: titleOf(uri) }
  forwardStack = []
  notifyListeners()
}

/** アプリ起動時に一度だけ呼ぶ。解除関数を返す */
export function initNavigationHistory(): () => void {
  unsubscribe?.()
  let lastUri = useEditorStore.getState().activeUri
  if (lastUri) current = { uri: lastUri, title: titleOf(lastUri) }
  unsubscribe = useEditorStore.subscribe((state) => {
    if (state.activeUri === lastUri) return
    lastUri = state.activeUri
    if (state.activeUri) record(state.activeUri)
  })
  return () => {
    unsubscribe?.()
    unsubscribe = null
  }
}

export function canNavigateBack(): boolean {
  return backStack.length > 0
}

export function canNavigateForward(): boolean {
  return forwardStack.length > 0
}

function open(entry: NavigationEntry): void {
  navigating = true
  try {
    useEditorStore.getState().openResource(entry.uri, entry.title)
  } finally {
    navigating = false
  }
}

/** 戻る。移動できたら true */
export function navigateBack(): boolean {
  const entry = backStack.pop()
  if (!entry) return false
  if (current) forwardStack.push(current)
  current = entry
  open(entry)
  notifyListeners()
  return true
}

/** 進む。移動できたら true */
export function navigateForward(): boolean {
  const entry = forwardStack.pop()
  if (!entry) return false
  if (current) backStack.push(current)
  current = entry
  open(entry)
  notifyListeners()
  return true
}

/** プロジェクト切替時に履歴を破棄する */
export function clearNavigationHistory(): void {
  backStack = []
  forwardStack = []
  const activeUri = useEditorStore.getState().activeUri
  current = activeUri ? { uri: activeUri, title: titleOf(activeUri) } : null
  notifyListeners()
}
