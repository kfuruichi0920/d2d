// T701: LLM Gateway 基盤 — Provider 設定管理・実行・ログ記録

import { getDatabase } from '../db/database'
import { generateUid } from '../utils/uuid'
import { callProvider, type LlmCallOptions, type LlmMessage } from './providers'
import { maskSensitiveData } from './privacy-filter'
import { getApiKey } from '../settings/settings-manager'

export type LlmProvider = 'openai' | 'gemini' | 'ollama' | 'azure_openai' | 'anthropic'

export interface ProviderConfig {
  uid: string
  provider: LlmProvider
  display_name: string
  model_name: string
  endpoint_url: string | null
  max_tokens: number
  temperature: number
  is_default: number
  created_at: string
}

export interface RunOptions {
  messages: LlmMessage[]
  providerConfigUid?: string
  inputRefUid?: string
  toolName?: string
  maskSensitive?: boolean
}

export interface RunResult {
  llmRunRefUid: string
  content: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
  estimatedCostUsd: number
  masked: boolean
}

// ---- Provider config CRUD --------------------------------------------------

export function listProviderConfigs(): ProviderConfig[] {
  const db = getDatabase()
  return db.prepare('SELECT * FROM llm_provider_config ORDER BY is_default DESC, created_at').all() as ProviderConfig[]
}

export function getDefaultProviderConfig(): ProviderConfig | null {
  const db = getDatabase()
  return (
    (db.prepare('SELECT * FROM llm_provider_config WHERE is_default=1 LIMIT 1').get() as ProviderConfig | undefined) ??
    (db.prepare('SELECT * FROM llm_provider_config ORDER BY created_at LIMIT 1').get() as ProviderConfig | undefined) ??
    null
  )
}

export function createProviderConfig(opts: Omit<ProviderConfig, 'uid' | 'created_at'>): string {
  const db = getDatabase()
  const uid = generateUid()
  if (opts.is_default) {
    db.prepare('UPDATE llm_provider_config SET is_default=0').run()
  }
  db.prepare(`
    INSERT INTO llm_provider_config (uid, provider, display_name, model_name, endpoint_url, max_tokens, temperature, is_default)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(uid, opts.provider, opts.display_name, opts.model_name, opts.endpoint_url ?? null, opts.max_tokens, opts.temperature, opts.is_default)
  return uid
}

export function updateProviderConfig(uid: string, fields: Partial<Omit<ProviderConfig, 'uid' | 'created_at'>>): void {
  const db = getDatabase()
  if (fields.is_default) {
    db.prepare('UPDATE llm_provider_config SET is_default=0').run()
  }
  const sets: string[] = []
  const vals: unknown[] = []
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k}=?`)
    vals.push(v)
  }
  if (sets.length === 0) return
  vals.push(uid)
  db.prepare(`UPDATE llm_provider_config SET ${sets.join(',')} WHERE uid=?`).run(...vals)
}

export function deleteProviderConfig(uid: string): void {
  getDatabase().prepare('DELETE FROM llm_provider_config WHERE uid=?').run(uid)
}

// ---- LLM 実行 ---------------------------------------------------------------

export async function runLlm(opts: RunOptions): Promise<RunResult> {
  const db = getDatabase()

  // プロバイダー設定取得
  const config: ProviderConfig | null = opts.providerConfigUid
    ? (db.prepare('SELECT * FROM llm_provider_config WHERE uid=?').get(opts.providerConfigUid) as ProviderConfig | undefined ?? null)
    : getDefaultProviderConfig()
  if (!config) throw new Error('LLM プロバイダー設定がありません。設定画面で追加してください。')

  // API キー取得（service=provider、account='default'）
  const apiKey = await getApiKey(config.provider, 'default').catch(() => undefined)

  // 機密マスキング
  let messages = opts.messages
  let masked = false
  if (opts.maskSensitive !== false) {
    const maskedMessages = messages.map((m) => {
      const r = maskSensitiveData(m.content)
      if (r.maskCount > 0) masked = true
      return { ...m, content: r.masked }
    })
    messages = maskedMessages
  }

  // llm_run_ref 作成
  const runRefUid = generateUid()
  db.prepare(`
    INSERT INTO entity_registry (uid, project_uid, entity_type, code, title, status)
    SELECT ?, project_uid, 'llm_run_ref', ?, ?, 'active'
    FROM project LIMIT 1
  `).run(runRefUid, `LLM-${runRefUid.slice(-6).toUpperCase()}`, opts.toolName ?? 'llm_run')
  db.prepare(`
    INSERT INTO llm_run_ref (uid, tool_name, model_name, input_ref_uid, status)
    VALUES (?, ?, ?, ?, 'running')
  `).run(runRefUid, opts.toolName ?? 'llm_run', config.model_name, opts.inputRefUid ?? null)

  const callOpts: LlmCallOptions = {
    provider: config.provider,
    modelName: config.model_name,
    messages,
    maxTokens: config.max_tokens,
    temperature: config.temperature,
    apiKey: apiKey ?? undefined,
    endpointUrl: config.endpoint_url ?? undefined,
  }

  let result: RunResult
  try {
    const r = await callProvider(callOpts)
    const estimatedCostUsd = estimateCost(config.provider, config.model_name, r.promptTokens, r.completionTokens)

    // ログ記録
    const logUid = generateUid()
    db.prepare(`
      INSERT INTO llm_run_log (uid, llm_run_ref_uid, provider, model_name, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, latency_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(logUid, runRefUid, config.provider, config.model_name, r.promptTokens, r.completionTokens, r.totalTokens, estimatedCostUsd, r.latencyMs)

    // run_ref 成功更新
    db.prepare(`UPDATE llm_run_ref SET status='success', executed_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid=?`).run(runRefUid)

    result = {
      llmRunRefUid: runRefUid,
      content: r.content,
      promptTokens: r.promptTokens,
      completionTokens: r.completionTokens,
      totalTokens: r.totalTokens,
      latencyMs: r.latencyMs,
      estimatedCostUsd,
      masked,
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    const logUid = generateUid()
    db.prepare(`
      INSERT INTO llm_run_log (uid, llm_run_ref_uid, provider, model_name, error_message)
      VALUES (?, ?, ?, ?, ?)
    `).run(logUid, runRefUid, config.provider, config.model_name, msg)
    db.prepare(`UPDATE llm_run_ref SET status='failed' WHERE uid=?`).run(runRefUid)
    throw err
  }

  return result
}

// ---- ログ照会 ---------------------------------------------------------------

export function listRunLogs(limit = 50): unknown[] {
  return getDatabase().prepare(`
    SELECT l.*, r.tool_name, r.input_ref_uid
    FROM llm_run_log l
    LEFT JOIN llm_run_ref r ON r.uid = l.llm_run_ref_uid
    ORDER BY l.created_at DESC LIMIT ?
  `).all(limit) as unknown[]
}

export function getRunLogStats(): unknown {
  return getDatabase().prepare(`
    SELECT
      COUNT(*) total_runs,
      SUM(total_tokens) total_tokens,
      SUM(estimated_cost_usd) total_cost_usd,
      AVG(latency_ms) avg_latency_ms,
      COUNT(CASE WHEN error_message IS NOT NULL THEN 1 END) error_count
    FROM llm_run_log
  `).get()
}

// ---- コスト推定（USD / 1K tokens ※概算） -----------------------------------

const COST_TABLE: Record<string, [number, number]> = {
  'gpt-4o':           [0.005, 0.015],
  'gpt-4o-mini':      [0.00015, 0.0006],
  'gpt-4-turbo':      [0.01, 0.03],
  'gpt-3.5-turbo':    [0.0005, 0.0015],
  'claude-opus-4-8':  [0.015, 0.075],
  'claude-sonnet-4-6':[0.003, 0.015],
  'claude-haiku-4-5-20251001': [0.00025, 0.00125],
  'gemini-1.5-flash': [0.000075, 0.0003],
  'gemini-1.5-pro':   [0.00125, 0.005],
}

function estimateCost(_provider: string, model: string, prompt: number, completion: number): number {
  const key = Object.keys(COST_TABLE).find((k) => model.includes(k))
  if (!key) return 0
  const [inputRate, outputRate] = COST_TABLE[key]
  return (prompt / 1000) * inputRate + (completion / 1000) * outputRate
}
