/**
 * LLM Provider クライアント（P6-1、LLM-001〜005、sdd_tech_stack §6）。
 * すべて globalThis.fetch による HTTP 実装とし、外部 SDK に依存しない。
 */
import { BackendError } from '../api/errors'

export type ProviderName = 'openai' | 'gemini' | 'ollama' | 'azure'

export const PROVIDER_NAMES: ProviderName[] = ['openai', 'gemini', 'ollama', 'azure']

/** ローカル動作の Provider（外部送信可否の対象外。LLM-042/043） */
export function isLocalProvider(provider: ProviderName): boolean {
  return provider === 'ollama'
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  temperature?: number
  /** true の場合、JSON 出力を要求する（対応 Provider のみ） */
  jsonMode?: boolean
}

export interface ChatResponse {
  content: string
  inputTokens: number | null
  outputTokens: number | null
}

export interface ProviderConfig {
  provider: ProviderName
  model: string
  /** azure: リソース endpoint / ollama: ベース URL（既定 http://localhost:11434） */
  endpoint?: string
  /** azure のみ */
  deployment?: string
  apiVersion?: string
  /** APIキー実値（Backend 内部でのみ扱い、ログへ残さない。LLM-016） */
  apiKey?: string
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal
): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new BackendError('cancelled', 'LLM 実行が中断されました', '', true)
    }
    throw new BackendError(
      'llm',
      'LLM Provider へ接続できません',
      err instanceof Error ? err.message : String(err),
      true
    )
  }
  const text = await response.text()
  if (!response.ok) {
    // 応答本文に APIキーは含まれない前提だが、長大な本文は切り詰める
    throw new BackendError(
      'llm',
      `LLM Provider がエラーを返しました (HTTP ${response.status})`,
      text.slice(0, 1000),
      response.status >= 500 || response.status === 429
    )
  }
  try {
    return JSON.parse(text)
  } catch {
    throw new BackendError('llm', 'LLM 応答の JSON 解析に失敗しました', text.slice(0, 500), false)
  }
}

/** OpenAI: https://api.openai.com/v1/chat/completions（Bearer） */
async function chatOpenAi(config: ProviderConfig, request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  const url = `${config.endpoint ?? 'https://api.openai.com'}/v1/chat/completions`
  const json = (await postJson(
    url,
    { Authorization: `Bearer ${config.apiKey ?? ''}` },
    {
      model: request.model,
      messages: request.messages,
      temperature: request.temperature,
      ...(request.jsonMode ? { response_format: { type: 'json_object' } } : {})
    },
    signal
  )) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    content: json.choices?.[0]?.message?.content ?? '',
    inputTokens: json.usage?.prompt_tokens ?? null,
    outputTokens: json.usage?.completion_tokens ?? null
  }
}

/** Azure OpenAI: {endpoint}/openai/deployments/{deployment}/chat/completions?api-version=（api-key ヘッダ） */
async function chatAzure(config: ProviderConfig, request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  if (!config.endpoint || !config.deployment) {
    throw new BackendError('validation', 'Azure OpenAI の endpoint / deployment が未設定です', '')
  }
  const apiVersion = config.apiVersion ?? '2024-02-01'
  const url = `${config.endpoint}/openai/deployments/${config.deployment}/chat/completions?api-version=${apiVersion}`
  const json = (await postJson(
    url,
    { 'api-key': config.apiKey ?? '' },
    { messages: request.messages, temperature: request.temperature },
    signal
  )) as {
    choices?: { message?: { content?: string } }[]
    usage?: { prompt_tokens?: number; completion_tokens?: number }
  }
  return {
    content: json.choices?.[0]?.message?.content ?? '',
    inputTokens: json.usage?.prompt_tokens ?? null,
    outputTokens: json.usage?.completion_tokens ?? null
  }
}

/** Gemini: generativelanguage v1beta models/{model}:generateContent?key=（APIキーはクエリ） */
async function chatGemini(config: ProviderConfig, request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  const base = config.endpoint ?? 'https://generativelanguage.googleapis.com'
  const url = `${base}/v1beta/models/${request.model}:generateContent?key=${encodeURIComponent(config.apiKey ?? '')}`
  // system メッセージは systemInstruction、それ以外は contents へ写像する
  const system = request.messages.filter((m) => m.role === 'system')
  const contents = request.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
  const json = (await postJson(
    url,
    {},
    {
      ...(system.length > 0 ? { systemInstruction: { parts: system.map((m) => ({ text: m.content })) } } : {}),
      contents,
      ...(request.jsonMode ? { generationConfig: { responseMimeType: 'application/json' } } : {})
    },
    signal
  )) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[]
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
  }
  return {
    content: json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
    inputTokens: json.usageMetadata?.promptTokenCount ?? null,
    outputTokens: json.usageMetadata?.candidatesTokenCount ?? null
  }
}

/** Ollama: {endpoint|http://localhost:11434}/api/chat（認証不要・ローカル） */
async function chatOllama(config: ProviderConfig, request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  const base = config.endpoint ?? 'http://localhost:11434'
  const json = (await postJson(
    `${base}/api/chat`,
    {},
    {
      model: request.model,
      messages: request.messages,
      stream: false,
      ...(request.jsonMode ? { format: 'json' } : {})
    },
    signal
  )) as {
    message?: { content?: string }
    prompt_eval_count?: number
    eval_count?: number
  }
  return {
    content: json.message?.content ?? '',
    inputTokens: json.prompt_eval_count ?? null,
    outputTokens: json.eval_count ?? null
  }
}

export async function chat(config: ProviderConfig, request: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
  switch (config.provider) {
    case 'openai':
      return chatOpenAi(config, request, signal)
    case 'azure':
      return chatAzure(config, request, signal)
    case 'gemini':
      return chatGemini(config, request, signal)
    case 'ollama':
      return chatOllama(config, request, signal)
    default:
      throw new BackendError('validation', `未知の LLM Provider です: ${String(config.provider)}`, '')
  }
}
