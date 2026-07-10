import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { chat, type ProviderConfig } from './providers'

/**
 * モック HTTP サーバで各 Provider のリクエスト形式・応答解析を検証する（P6-1）。
 */

interface Captured {
  url: string
  headers: IncomingMessage['headers']
  body: unknown
}

let server: Server
let baseUrl: string
let captured: Captured | null = null
let responder: (req: Captured) => { status: number; body: unknown } = () => ({ status: 200, body: {} })

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let data = ''
    req.on('data', (chunk) => (data += chunk))
    req.on('end', () => {
      captured = { url: req.url ?? '', headers: req.headers, body: data ? JSON.parse(data) : null }
      const { status, body } = responder(captured)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  baseUrl = `http://127.0.0.1:${address.port}`
})

afterAll(() => {
  server.close()
})

const MESSAGES = [
  { role: 'system' as const, content: 'あなたは設計支援AIです' },
  { role: 'user' as const, content: '要求を抽出して' }
]

describe('LLM Provider クライアント（P6-1）', () => {
  it('OpenAI: Bearer 認証と chat/completions 形式（LLM-001）', async () => {
    responder = () => ({
      status: 200,
      body: {
        choices: [{ message: { content: '応答です' } }],
        usage: { prompt_tokens: 12, completion_tokens: 34 }
      }
    })
    const config: ProviderConfig = { provider: 'openai', model: 'gpt-4o-mini', endpoint: baseUrl, apiKey: 'sk-test' }
    const res = await chat(config, { model: 'gpt-4o-mini', messages: MESSAGES })

    expect(captured!.url).toBe('/v1/chat/completions')
    expect(captured!.headers.authorization).toBe('Bearer sk-test')
    expect((captured!.body as { model: string }).model).toBe('gpt-4o-mini')
    expect(res).toEqual({ content: '応答です', inputTokens: 12, outputTokens: 34 })
  })

  it('Azure OpenAI: api-key ヘッダと deployment パス（LLM-004）', async () => {
    responder = () => ({
      status: 200,
      body: { choices: [{ message: { content: 'azure応答' } }], usage: { prompt_tokens: 1, completion_tokens: 2 } }
    })
    const config: ProviderConfig = {
      provider: 'azure',
      model: 'gpt-4o',
      endpoint: baseUrl,
      deployment: 'my-deploy',
      apiKey: 'azure-key'
    }
    const res = await chat(config, { model: 'gpt-4o', messages: MESSAGES })

    expect(captured!.url).toBe('/openai/deployments/my-deploy/chat/completions?api-version=2024-02-01')
    expect(captured!.headers['api-key']).toBe('azure-key')
    expect(res.content).toBe('azure応答')
  })

  it('Gemini: クエリパラメータ認証と contents 形式（LLM-002）', async () => {
    responder = () => ({
      status: 200,
      body: {
        candidates: [{ content: { parts: [{ text: 'gemini' }, { text: '応答' }] } }],
        usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 }
      }
    })
    const config: ProviderConfig = { provider: 'gemini', model: 'gemini-2.0-flash', endpoint: baseUrl, apiKey: 'g-key' }
    const res = await chat(config, { model: 'gemini-2.0-flash', messages: MESSAGES })

    expect(captured!.url).toBe('/v1beta/models/gemini-2.0-flash:generateContent?key=g-key')
    const body = captured!.body as { systemInstruction: unknown; contents: { role: string }[] }
    expect(body.systemInstruction).toBeTruthy() // system は systemInstruction へ
    expect(body.contents).toHaveLength(1)
    expect(res).toEqual({ content: 'gemini応答', inputTokens: 5, outputTokens: 7 })
  })

  it('Ollama: 認証なしローカル（LLM-003）と JSON モード', async () => {
    responder = () => ({
      status: 200,
      body: { message: { content: '{"ok":true}' }, prompt_eval_count: 3, eval_count: 4 }
    })
    const config: ProviderConfig = { provider: 'ollama', model: 'llama3', endpoint: baseUrl }
    const res = await chat(config, { model: 'llama3', messages: MESSAGES, jsonMode: true })

    expect(captured!.url).toBe('/api/chat')
    expect(captured!.headers.authorization).toBeUndefined()
    const body = captured!.body as { stream: boolean; format: string }
    expect(body.stream).toBe(false)
    expect(body.format).toBe('json')
    expect(res.content).toBe('{"ok":true}')
  })

  it('HTTP エラーは llm 分類のエラー契約になり、5xx/429 は retryable', async () => {
    responder = () => ({ status: 429, body: { error: 'rate limited' } })
    const config: ProviderConfig = { provider: 'openai', model: 'x', endpoint: baseUrl, apiKey: 'k' }
    await expect(chat(config, { model: 'x', messages: MESSAGES })).rejects.toMatchObject({
      errorCode: 'llm',
      retryable: true
    })

    responder = () => ({ status: 401, body: { error: 'unauthorized' } })
    await expect(chat(config, { model: 'x', messages: MESSAGES })).rejects.toMatchObject({
      errorCode: 'llm',
      retryable: false
    })
  })

  it('接続不可は retryable な llm エラーになる', async () => {
    const config: ProviderConfig = { provider: 'ollama', model: 'x', endpoint: 'http://127.0.0.1:1' }
    await expect(chat(config, { model: 'x', messages: MESSAGES })).rejects.toMatchObject({
      errorCode: 'llm',
      retryable: true
    })
  })
})
