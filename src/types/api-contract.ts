/**
 * Backend API の型付き契約マップ（改善対応1: API呼び出しの型安全化）。
 * メソッド名 → params / result を宣言し、`invoke` / `invokeOrThrow` が
 * 契約登録済みメソッドをコンパイル時に型検査する。
 * 未登録メソッドは従来どおり `invoke<T>(method, params)` の明示ジェネリクスで呼ぶ。
 * 契約は利用頻度の高い基盤APIから漸進的に追加する（全183メソッドの一括定義はしない）。
 */
import type { ApiError, PingResult } from './ipc'
import type { ApiMethod } from './api-methods'

/** プロジェクト情報（project.getInfo の応答） */
export interface ProjectInfo {
  projectUid: string
  name: string
  description: string | null
  rootPath: string
  schemaVersion: string
  code: string | null
}

/** Pipeline Navigator 用のステージ集計（sdd_ui_design §3.1） */
export interface PipelineStats {
  sources: number
  extracted: number
  intermediate: number
  designElements: number
  traceLinks: number
  candidates: number
}

export type JobStatus = 'waiting' | 'running' | 'success' | 'failed' | 'partial' | 'aborted'

/** ジョブレコード（job.list / job.get の応答、job.updated イベントの payload） */
export interface JobRecord {
  jobId: string
  type: string
  status: JobStatus
  progress: number
  message: string | null
  error: ApiError | null
  createdAt?: string
  startedAt?: string | null
  completedAt?: string | null
}

/**
 * メソッド名 → { params, result } の契約マップ。
 * params が不要なメソッドは void を指定する（呼び出し側は引数省略）。
 */
export interface ApiContracts {
  'app.ping': { params: void; result: PingResult }
  'project.getInfo': { params: void; result: ProjectInfo | null }
  'project.getPipelineStats': { params: void; result: PipelineStats }
  'settings.get': { params: { key: string }; result: unknown }
  'settings.getAll': { params: void; result: Record<string, unknown> }
  'settings.set': { params: { key: string; value: unknown }; result: { saved: boolean } }
  'settings.delete': { params: { key: string }; result: { deleted: boolean } }
  'job.list': { params: void; result: JobRecord[] }
  'job.get': { params: { jobId: string }; result: JobRecord }
  'log.append': {
    params: {
      source: 'frontend' | 'backend'
      level: 'error' | 'warn' | 'info' | 'debug'
      message: string
      detail?: string
    }
    result: unknown
  }
}

/** 契約登録済みメソッド名 */
export type ContractMethod = keyof ApiContracts

// 契約マップのメソッド名が API_METHODS に含まれることをコンパイル時に保証する
type _AssertContractMethodIsApiMethod = ContractMethod extends ApiMethod ? true : never
export const CONTRACT_METHODS_ARE_VALID: _AssertContractMethodIsApiMethod = true
