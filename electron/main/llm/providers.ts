// T702-T705: Provider 実装 (OpenAI / Gemini / Ollama / Azure)

import { net } from 'electron'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCallOptions {
  provider: 'openai' | 'gemini' | 'ollama' | 'azure_openai' | 'anthropic'
  modelName: string
  messages: LlmMessage[]
  maxTokens?: number
  temperature?: number
  apiKey?: string
  endpointUrl?: string
}

export interface LlmCallResult {
  content: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
}

// API レスポンスを型なしで扱うヘルパー
type Obj = Record<string, unknown>
const n = (v: unknown): number => (typeof v === 'number' ? v : 0)
const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const pick = (o: unknown, ...keys: string[]): unknown => {
  let cur: unknown = o
  for (const k of keys) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Obj)[k]
  }
  return cur
}

// ---- OpenAI ----------------------------------------------------------------

async function callOpenAI(opts: LlmCallOptions): Promise<LlmCallResult> {
  const url = opts.endpointUrl ?? 'https://api.openai.com/v1/chat/completions'
  const t0 = Date.now()
  const resp = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.apiKey ?? ''}` },
    body: JSON.stringify({
      model: opts.modelName,
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.2,
    }),
  })
  return {
    content: s(pick(resp, 'choices', '0', 'message', 'content')),
    promptTokens: n(pick(resp, 'usage', 'prompt_tokens')),
    completionTokens: n(pick(resp, 'usage', 'completion_tokens')),
    totalTokens: n(pick(resp, 'usage', 'total_tokens')),
    latencyMs: Date.now() - t0,
  }
}

// ---- Gemini ----------------------------------------------------------------

async function callGemini(opts: LlmCallOptions): Promise<LlmCallResult> {
  const model = opts.modelName
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${opts.apiKey ?? ''}`
  const parts = opts.messages.map((m) => ({ text: m.content }))
  const t0 = Date.now()
  const resp = await fetchJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { maxOutputTokens: opts.maxTokens ?? 4096, temperature: opts.temperature ?? 0.2 },
    }),
  })
  return {
    content: s(pick(resp, 'candidates', '0', 'content', 'parts', '0', 'text')),
    promptTokens: n(pick(resp, 'usageMetadata', 'promptTokenCount')),
    completionTokens: n(pick(resp, 'usageMetadata', 'candidatesTokenCount')),
    totalTokens: n(pick(resp, 'usageMetadata', 'totalTokenCount')),
    latencyMs: Date.now() - t0,
  }
}

// ---- Ollama (ローカル) -----------------------------------------------------

async function callOllama(opts: LlmCallOptions): Promise<LlmCallResult> {
  const base = opts.endpointUrl ?? 'http://localhost:11434'
  const t0 = Date.now()
  const resp = await fetchJson(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: opts.modelName,
      messages: opts.messages,
      stream: false,
      options: { num_predict: opts.maxTokens ?? 4096, temperature: opts.temperature ?? 0.2 },
    }),
  })
  const prompt = n(pick(resp, 'prompt_eval_count'))
  const eval_ = n(pick(resp, 'eval_count'))
  return {
    content: s(pick(resp, 'message', 'content')),
    promptTokens: prompt,
    completionTokens: eval_,
    totalTokens: prompt + eval_,
    latencyMs: Date.now() - t0,
  }
}

// ---- Azure OpenAI ----------------------------------------------------------

async function callAzureOpenAI(opts: LlmCallOptions): Promise<LlmCallResult> {
  if (!opts.endpointUrl) throw new Error('Azure OpenAI: endpointUrl が必要です')
  const t0 = Date.now()
  const resp = await fetchJson(opts.endpointUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': opts.apiKey ?? '' },
    body: JSON.stringify({
      messages: opts.messages,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.2,
    }),
  })
  return {
    content: s(pick(resp, 'choices', '0', 'message', 'content')),
    promptTokens: n(pick(resp, 'usage', 'prompt_tokens')),
    completionTokens: n(pick(resp, 'usage', 'completion_tokens')),
    totalTokens: n(pick(resp, 'usage', 'total_tokens')),
    latencyMs: Date.now() - t0,
  }
}

// ---- Anthropic (Claude) ----------------------------------------------------

async function callAnthropic(opts: LlmCallOptions): Promise<LlmCallResult> {
  const systemMsg = opts.messages.find((m) => m.role === 'system')?.content
  const userMessages = opts.messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role, content: m.content }))
  const t0 = Date.now()
  const body: Obj = { model: opts.modelName, max_tokens: opts.maxTokens ?? 4096, messages: userMessages }
  if (systemMsg) body.system = systemMsg
  const resp = await fetchJson('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': opts.apiKey ?? '',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  const input = n(pick(resp, 'usage', 'input_tokens'))
  const output = n(pick(resp, 'usage', 'output_tokens'))
  return {
    content: s(pick(resp, 'content', '0', 'text')),
    promptTokens: input,
    completionTokens: output,
    totalTokens: input + output,
    latencyMs: Date.now() - t0,
  }
}

// ---- dispatch ---------------------------------------------------------------

export async function callProvider(opts: LlmCallOptions): Promise<LlmCallResult> {
  switch (opts.provider) {
    case 'openai': return callOpenAI(opts)
    case 'gemini': return callGemini(opts)
    case 'ollama': return callOllama(opts)
    case 'azure_openai': return callAzureOpenAI(opts)
    case 'anthropic': return callAnthropic(opts)
    default: throw new Error(`Unknown provider: ${opts.provider}`)
  }
}

// ---- helper ----------------------------------------------------------------

async function fetchJson(url: string, init: RequestInit): Promise<Obj> {
  const fetchFn: typeof fetch = (net as unknown as { fetch?: typeof fetch }).fetch ?? globalThis.fetch
  const resp = await fetchFn(url, init)
  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`HTTP ${resp.status}: ${body.slice(0, 300)}`)
  }
  return resp.json() as Promise<Obj>
}
