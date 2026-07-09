/**
 * イベントバス（P2-4、CORE-030〜032、sdd_function_architecture §9）。
 * Backend 内の機能間通知と、parentPort 経由の Renderer 通知に使う。
 * イベント名は「対象.動詞」形式（例: project.opened、extraction.completed、job.updated）。
 */

export type EventListener = (event: string, payload: unknown) => void

export class EventBus {
  private readonly listeners = new Map<string, Set<EventListener>>()
  private readonly anyListeners = new Set<EventListener>()

  /** 特定イベントを購読する。解除関数を返す */
  on(event: string, listener: EventListener): () => void {
    let set = this.listeners.get(event)
    if (!set) {
      set = new Set()
      this.listeners.set(event, set)
    }
    set.add(listener)
    return () => set.delete(listener)
  }

  /** 全イベントを購読する（Renderer 転送・ログ用）。解除関数を返す */
  onAny(listener: EventListener): () => void {
    this.anyListeners.add(listener)
    return () => this.anyListeners.delete(listener)
  }

  emit(event: string, payload: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      safeInvoke(listener, event, payload)
    }
    for (const listener of this.anyListeners) {
      safeInvoke(listener, event, payload)
    }
  }
}

function safeInvoke(listener: EventListener, event: string, payload: unknown): void {
  try {
    listener(event, payload)
  } catch (err) {
    // 購読側の例外で発行元を壊さない
    console.error(`[event-bus] listener error on ${event}:`, err)
  }
}

/** Backend プロセス全体で共有するバス */
export const eventBus = new EventBus()
