/**
 * Undo/Redo 基盤（W4、NFR-012）。
 * ユーザー操作による内部情報の変更を「逆操作つきエントリ」として積み、
 * Ctrl+Z / Ctrl+Y（編集欄フォーカス中を除く）とメニューから取り消し・やり直しする。
 * DB 正本の変更は各画面が Backend の逆操作 API を undo/redo に指定して登録する。
 */

export interface UndoEntry {
  /** 通知・メニューに表示する操作名（例: 「名称変更: 要件一覧」） */
  label: string
  /** 操作を取り消す。失敗時は例外を投げる（スタックへは戻さない） */
  undo: () => void | Promise<void>
  /** 取り消した操作をやり直す */
  redo: () => void | Promise<void>
}

const MAX_STACK = 100

let undoStack: UndoEntry[] = []
let redoStack: UndoEntry[] = []
const listeners = new Set<() => void>()

function notifyListeners(): void {
  listeners.forEach((fn) => fn())
}

/** スタック変化を購読する（メニューの有効/無効表示用）。解除関数を返す */
export function subscribeUndo(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** 操作完了後に呼び、取り消し可能な操作として登録する。redo スタックはクリアする */
export function pushUndo(entry: UndoEntry): void {
  undoStack.push(entry)
  if (undoStack.length > MAX_STACK) undoStack = undoStack.slice(-MAX_STACK)
  redoStack = []
  notifyListeners()
}

export function canUndo(): boolean {
  return undoStack.length > 0
}

export function canRedo(): boolean {
  return redoStack.length > 0
}

/** 次に取り消される操作名（なければ null） */
export function peekUndoLabel(): string | null {
  return undoStack[undoStack.length - 1]?.label ?? null
}

export function peekRedoLabel(): string | null {
  return redoStack[redoStack.length - 1]?.label ?? null
}

/**
 * 最後の操作を取り消す。成功時はエントリを redo へ移して label を返す。
 * スタックが空なら null。undo 実行が失敗した場合は例外を伝播し、エントリは破棄する
 * （半端な状態で再実行すると二重取消になるため）。
 */
export async function performUndo(): Promise<string | null> {
  const entry = undoStack.pop()
  if (!entry) return null
  notifyListeners()
  await entry.undo()
  redoStack.push(entry)
  notifyListeners()
  return entry.label
}

export async function performRedo(): Promise<string | null> {
  const entry = redoStack.pop()
  if (!entry) return null
  notifyListeners()
  await entry.redo()
  undoStack.push(entry)
  notifyListeners()
  return entry.label
}

/** プロジェクト切替等でスタックを破棄する */
export function clearUndoHistory(): void {
  undoStack = []
  redoStack = []
  notifyListeners()
}
