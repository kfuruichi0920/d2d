import { createServer, type Server } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { SettingsService, setProjectSetting, type SecretCipher } from '../settings/settings-service'
import { previewLlm, resolveLlmSettings, runLlm } from './llm-service'
import { maskMessages } from './masking'

const stubCipher: SecretCipher = {
  isAvailable: async () => true,
  encrypt: async (plain) => `enc:${Buffer.from(plain).toString('base64')}`,
  decrypt: async (cipher) => Buffer.from(cipher.slice(4), 'base64').toString('utf-8')
}

let server: Server
let baseUrl: string
let lastAuthHeader: string | undefined

beforeAll(async () => {
  server = createServer((req, res) => {
    lastAuthHeader = req.headers.authorization
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      // OpenAI / Ollama 双方の形式を返す
      res.end(
        JSON.stringify({
          choices: [{ message: { content: 'mock-response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 20 },
          message: { content: 'mock-response' },
          prompt_eval_count: 10,
          eval_count: 20
        })
      )
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

afterAll(() => server.close())

describe('LLM 実行サービス（P6-2/P6-4）', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string
  let settings: SettingsService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-llm-'))
    root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid
    settings = new SettingsService(join(dir, 'userdata'), stubCipher)
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('外部 Provider は既定で送信拒否される（NFR-022: 既定 off）', async () => {
    settings.set('llm.provider', 'openai')
    settings.set('llm.openai.endpoint', baseUrl)
    await settings.setSecret('openai_api_key', 'sk-secret')

    await expect(
      runLlm(
        db,
        settings,
        { projectUid, rootPath: root },
        { processName: 'test', messages: [{ role: 'user', content: 'hi' }] }
      )
    ).rejects.toMatchObject({ errorCode: 'llm' })

    // プロジェクト設定で許可すると送信できる（LLM-042）
    setProjectSetting(root, 'llm.externalSendAllowed', true)
    const result = await runLlm(
      db,
      settings,
      { projectUid, rootPath: root },
      { processName: 'test', messages: [{ role: 'user', content: 'hi' }] }
    )
    expect(result.content).toBe('mock-response')
    expect(lastAuthHeader).toBe('Bearer sk-secret') // APIキーは送信時のみ使用
  })

  it('ローカル Provider（Ollama）は許可なしで実行でき、証跡を保存する（LLM-010〜013）', async () => {
    settings.set('llm.provider', 'ollama')
    settings.set('llm.ollama.endpoint', baseUrl)
    settings.set('llm.costPer1kInput', 0.5)
    settings.set('llm.costPer1kOutput', 1.0)

    const result = await runLlm(
      db,
      settings,
      { projectUid, rootPath: root },
      { processName: 'extract-test', messages: [{ role: 'user', content: '本文 api_key=SECRET123 を含む' }] }
    )

    expect(result.content).toBe('mock-response')
    expect(result.code).toMatch(/^LLM-\d{6}$/)

    const row = db
      .prepare(
        `SELECT tool_name, process_name, input_tokens, output_tokens, estimated_cost, status FROM llm_run_ref WHERE uid = ?`
      )
      .get(result.llmRunUid) as Record<string, unknown>
    expect(row).toMatchObject({
      tool_name: 'ollama',
      process_name: 'extract-test',
      input_tokens: 10,
      output_tokens: 20,
      status: 'success'
    })
    expect(row.estimated_cost).toBeCloseTo((10 / 1000) * 0.5 + (20 / 1000) * 1.0)

    // prompt blob はマスキング済みで、機密実値が残らない（LLM-016 / NFR-021）
    const promptPath = db
      .prepare(
        `SELECT b.relative_path FROM llm_run_ref r JOIN blob_resource b ON b.uid = r.prompt_blob_uid WHERE r.uid = ?`
      )
      .get(result.llmRunUid) as { relative_path: string }
    const promptText = readFileSync(join(root, promptPath.relative_path), 'utf-8')
    expect(promptText).not.toContain('SECRET123')
    expect(promptText).toContain('«masked»')
  })

  it('生の送受信ログを blob として保存する（W12）', async () => {
    settings.set('llm.provider', 'ollama')
    settings.set('llm.ollama.endpoint', baseUrl)

    const result = await runLlm(
      db,
      settings,
      { projectUid, rootPath: root },
      { processName: 'raw-test', messages: [{ role: 'user', content: 'hello raw' }] }
    )

    const row = db
      .prepare(
        `SELECT rq.relative_path AS request_path, rs.relative_path AS response_path
           FROM llm_run_ref r
           JOIN blob_resource rq ON rq.uid = r.raw_request_blob_uid
           JOIN blob_resource rs ON rs.uid = r.raw_response_blob_uid
          WHERE r.uid = ?`
      )
      .get(result.llmRunUid) as { request_path: string; response_path: string }
    const requestText = readFileSync(join(root, row.request_path), 'utf-8')
    expect(requestText).toContain('"url"')
    expect(requestText).toContain('hello raw')
    const responseText = readFileSync(join(root, row.response_path), 'utf-8')
    expect(responseText).toContain('mock-response')
  })

  it('preferLocal は外部 Provider 設定を Ollama へ切り替える（LLM-043）', () => {
    settings.set('llm.provider', 'openai')
    settings.set('llm.preferLocal', true)
    const resolved = resolveLlmSettings(settings)
    expect(resolved.provider).toBe('ollama')
  })

  it('previewLlm は送信せず、送信先・マスキング結果・警告を返す（LLM-040/041）', () => {
    settings.set('llm.provider', 'openai')
    const preview = previewLlm(settings, root, [{ role: 'user', content: '鍵は sk-abcdefghijklmnop1234 です' }])
    expect(preview.external).toBe(true)
    expect(preview.externalSendAllowed).toBe(false)
    expect(preview.maskedMessages[0]!.content).not.toContain('sk-abcdefghijklmnop1234')
    expect(preview.maskHitCount).toBeGreaterThan(0)
    expect(preview.warnings.some((w) => w.includes('許可されていません'))).toBe(true)
    expect(preview.warnings.some((w) => w.includes('APIキーが未登録'))).toBe(true)
  })
})

describe('マスキング（P6-4、LLM-041）', () => {
  it('組込パターンとカスタムパターンを適用する', () => {
    const { messages, hitCount } = maskMessages(
      [{ role: 'user', content: 'key=sk-abcdefghijklmnop1234 社外秘PJ-X の話' }],
      ['社外秘\\S+']
    )
    expect(messages[0]!.content).not.toContain('sk-abcdefghijklmnop1234')
    expect(messages[0]!.content).not.toContain('社外秘PJ-X')
    expect(hitCount).toBeGreaterThanOrEqual(2)
  })
})
