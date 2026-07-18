/**
 * LLM 実行サービス（P6-2/P6-4/P6-6）。
 * 安全性検査（外部送信可否・マスキング）→ Provider 呼び出し → llm_run_ref +
 * blobs/llm/ への実行証跡保存を一括して行う。APIキー実値はログへ残さない（LLM-016）。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'
import type { SettingsService } from '../settings/settings-service'
import { getProjectSettings } from '../settings/settings-service'
import { saveBlobFromData } from '../store/blob-store'
import { registerEntity } from '../store/entity-registry'
import { maskMessages } from './masking'
import {
  chat,
  isLocalProvider,
  PROVIDER_NAMES,
  type ChatMessage,
  type ProviderConfig,
  type ProviderName,
  type RawExchange
} from './providers'

export interface LlmSettingsResolved {
  provider: ProviderName
  model: string
  endpoint?: string
  deployment?: string
  apiVersion?: string
  /** ローカル LLM 優先モード（LLM-043） */
  preferLocal: boolean
  maskPatterns: string[]
  hasApiKey: boolean
}

/** 設定から Provider 構成を解決する（APIキー実値は含めない） */
export function resolveLlmSettings(settings: SettingsService): LlmSettingsResolved {
  let provider = String(settings.get('llm.provider') ?? 'ollama') as ProviderName
  if (!PROVIDER_NAMES.includes(provider)) provider = 'ollama'
  const preferLocal = settings.get('llm.preferLocal') === true
  if (preferLocal && !isLocalProvider(provider)) {
    provider = 'ollama'
  }
  const get = (key: string): string | undefined => {
    const v = settings.get(`llm.${provider}.${key}`)
    return typeof v === 'string' && v ? v : undefined
  }
  const defaultModel = provider === 'ollama' ? 'llama3' : provider === 'gemini' ? 'gemini-2.0-flash' : 'gpt-4o-mini'
  return {
    provider,
    model: get('model') ?? defaultModel,
    endpoint: get('endpoint'),
    deployment: get('deployment'),
    apiVersion: get('apiVersion'),
    preferLocal,
    maskPatterns: Array.isArray(settings.get('llm.maskPatterns')) ? (settings.get('llm.maskPatterns') as string[]) : [],
    hasApiKey: settings.hasSecret(`${provider}_api_key`)
  }
}

export interface LlmPreview {
  provider: ProviderName
  model: string
  external: boolean
  externalSendAllowed: boolean
  maskedMessages: ChatMessage[]
  maskHitCount: number
  warnings: string[]
}

/** 送信前確認用プレビュー（LLM-040）。送信は行わない */
export function previewLlm(settings: SettingsService, projectRoot: string | null, messages: ChatMessage[]): LlmPreview {
  const resolved = resolveLlmSettings(settings)
  const external = !isLocalProvider(resolved.provider)
  const projectSettings = projectRoot ? getProjectSettings(projectRoot) : {}
  // 外部送信は既定で不可（NFR-022。プロジェクト設定で明示的に許可する）
  const externalSendAllowed = projectSettings['llm.externalSendAllowed'] === true
  const { messages: maskedMessages, hitCount } = maskMessages(messages, resolved.maskPatterns)

  const warnings: string[] = []
  if (external && !externalSendAllowed) {
    warnings.push('このプロジェクトは外部 LLM 送信が許可されていません（プロジェクト設定 llm.externalSendAllowed）')
  }
  if (external && !resolved.hasApiKey) {
    warnings.push(`APIキーが未登録です（設定 → 機密情報: ${resolved.provider}_api_key）`)
  }
  if (hitCount > 0) {
    warnings.push(`機密らしき文字列 ${hitCount} 件をマスキングします`)
  }
  return {
    provider: resolved.provider,
    model: resolved.model,
    external,
    externalSendAllowed,
    maskedMessages,
    maskHitCount: hitCount,
    warnings
  }
}

export interface RunLlmInput {
  processName: string
  messages: ChatMessage[]
  temperature?: number
  jsonMode?: boolean
  inputRefUid?: string
  promptTemplateUid?: string
  signal?: AbortSignal
}

export interface RunLlmResult {
  llmRunUid: string
  code: string
  content: string
  inputTokens: number | null
  outputTokens: number | null
  durationMs: number
}

/**
 * LLM を実行し、実行証跡を保存する。
 * 外部 Provider はプロジェクト設定で許可されている場合のみ送信する（LLM-042）。
 */
export async function runLlm(
  db: Database,
  settings: SettingsService,
  project: { projectUid: string; rootPath: string },
  input: RunLlmInput
): Promise<RunLlmResult> {
  const preview = previewLlm(settings, project.rootPath, input.messages)
  if (preview.external && !preview.externalSendAllowed) {
    throw new BackendError(
      'llm',
      '外部 LLM への送信がプロジェクト設定で許可されていません',
      'プロジェクト設定 llm.externalSendAllowed を true にするか、ローカル LLM（Ollama）を使用してください（NFR-022）',
      false
    )
  }

  const resolved = resolveLlmSettings(settings)
  const config: ProviderConfig = {
    provider: resolved.provider,
    model: resolved.model,
    endpoint: resolved.endpoint,
    deployment: resolved.deployment,
    apiVersion: resolved.apiVersion,
    apiKey: preview.external
      ? await settings.getSecretValue(`${resolved.provider}_api_key`).catch(() => undefined)
      : undefined
  }

  const startedAt = Date.now()
  let content = ''
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let errorDetail: string | null = null
  let status: 'success' | 'failed' = 'success'

  // Provider との生送受信を保持する（W12。マスキング後の内容のみ・APIキーは含まれない）
  let rawExchange: RawExchange | null = null

  try {
    const response = await chat(
      config,
      {
        model: resolved.model,
        messages: preview.maskedMessages,
        temperature: input.temperature,
        jsonMode: input.jsonMode
      },
      input.signal,
      (exchange) => {
        rawExchange = exchange
      }
    )
    content = response.content
    inputTokens = response.inputTokens
    outputTokens = response.outputTokens
  } catch (err) {
    status = 'failed'
    errorDetail = err instanceof BackendError ? `${err.errorCode}: ${err.message} ${err.detail}` : String(err)
    // 証跡を保存してから再スロー
    persistRun()
    throw err
  }

  const result = persistRun()
  eventBus.emit('llm.run.completed', { llmRunUid: result.llmRunUid, processName: input.processName, status })
  return result

  function persistRun(): RunLlmResult {
    const durationMs = Date.now() - startedAt
    // prompt / result を blobs/llm/ へ JSONL 保存（LLM-010/011。マスキング後の内容のみ）
    const promptBlob = saveBlobFromData(db, {
      projectUid: project.projectUid,
      projectRoot: project.rootPath,
      category: 'llm',
      data: preview.maskedMessages.map((m) => JSON.stringify(m)).join('\n') + '\n',
      fileNameHint: 'prompt.jsonl',
      createdBy: 'rule'
    })
    const resultBlob = saveBlobFromData(db, {
      projectUid: project.projectUid,
      projectRoot: project.rootPath,
      category: 'llm',
      data: JSON.stringify({ content, error: errorDetail }) + '\n',
      fileNameHint: 'result.jsonl',
      createdBy: 'rule'
    })
    // 生送受信ログ（W12）。送信ボディはマスキング後、URL の APIキーは Provider 側でマスク済み
    const exchange = rawExchange as RawExchange | null
    const rawRequestBlob = exchange
      ? saveBlobFromData(db, {
          projectUid: project.projectUid,
          projectRoot: project.rootPath,
          category: 'llm',
          data: JSON.stringify({ url: exchange.url, body: exchange.requestBody }, null, 2) + '\n',
          fileNameHint: 'raw-request.json',
          createdBy: 'rule'
        })
      : null
    const rawResponseBlob = exchange
      ? saveBlobFromData(db, {
          projectUid: project.projectUid,
          projectRoot: project.rootPath,
          category: 'llm',
          data: JSON.stringify(exchange.responseBody ?? null, null, 2) + '\n',
          fileNameHint: 'raw-response.json',
          createdBy: 'rule'
        })
      : null

    // 概算コスト（LLM-013）: 設定があれば 1k トークン単価で計算
    const inRate = Number(settings.get('llm.costPer1kInput') ?? 0)
    const outRate = Number(settings.get('llm.costPer1kOutput') ?? 0)
    const estimatedCost =
      inRate > 0 || outRate > 0 ? ((inputTokens ?? 0) / 1000) * inRate + ((outputTokens ?? 0) / 1000) * outRate : null

    const run = registerEntity(db, {
      projectUid: project.projectUid,
      entityType: 'llm_run_ref',
      title: `${input.processName} (${resolved.provider}/${resolved.model})`,
      createdBy: 'rule'
    })
    db.prepare(
      `INSERT INTO llm_run_ref
         (uid, tool_name, process_name, model_name, prompt_template_uid, input_ref_type, input_ref_uid,
          input_tokens, output_tokens, estimated_cost, duration_ms, error_detail, prompt_blob_uid, result_blob_uid,
          raw_request_blob_uid, raw_response_blob_uid, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      run.uid,
      resolved.provider,
      input.processName,
      resolved.model,
      input.promptTemplateUid ?? null,
      input.inputRefUid ? 'entity' : null,
      input.inputRefUid ?? null,
      inputTokens,
      outputTokens,
      estimatedCost,
      durationMs,
      errorDetail,
      promptBlob.uid,
      resultBlob.uid,
      rawRequestBlob?.uid ?? null,
      rawResponseBlob?.uid ?? null,
      status
    )
    return { llmRunUid: run.uid, code: run.code, content, inputTokens, outputTokens, durationMs }
  }
}
