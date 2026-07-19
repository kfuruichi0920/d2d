/**
 * 動作ログ（W11、NFR-010 拡張）。
 * トースト表示した通知（info/warning/error）を時系列で保持し、下段 Panel の
 * Output タブから参照する。Renderer メモリ内のみ（最大 500 件）。
 * デバッグ解析用の永続ログは Backend の日付毎ファイル（log.append/log.tail）が担う。
 */
import { create } from 'zustand'

export interface OperationLogEntry {
  id: number
  timestamp: string
  kind: 'info' | 'warning' | 'error'
  message: string
  detail?: string
}

const MAX_ENTRIES = 500

interface LogsState {
  entries: OperationLogEntry[]
  append(kind: OperationLogEntry['kind'], message: string, detail?: string): void
  clear(): void
}

let logSeq = 1

export const useLogsStore = create<LogsState>((set, get) => ({
  entries: [],

  append: (kind, message, detail) => {
    const entry: OperationLogEntry = { id: logSeq++, timestamp: new Date().toISOString(), kind, message, detail }
    set({ entries: [...get().entries, entry].slice(-MAX_ENTRIES) })
  },

  clear: () => set({ entries: [] })
}))
