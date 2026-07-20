/**
 * MCP サーバのユニットテスト（MCP-001〜008）。
 * ツール実装（mcp-tools）と Streamable HTTP（JSON-RPC 2.0）応答を実 DB で検証する。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { createDesignElement, createTraceLink } from '../design/design-service'
import { callMcpTool, MCP_TOOL_DEFINITIONS, type McpToolContext } from './mcp-tools'
import { McpServerService } from './mcp-service'

describe('MCPサーバ（MCP-001〜008）', () => {
  let dir: string
  let db: Database
  let projectUid: string
  let ctx: McpToolContext
  let reqUid: string
  let funcUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-mcp-'))
    const root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid
    ctx = { db, projectUid, searchSettings: { useMecab: false } }

    const req = createDesignElement(db, projectUid, { modelType: 'model_req', title: '応答時間要求' })
    const func = createDesignElement(db, projectUid, {
      modelType: 'model_func',
      title: '応答処理機能',
      summary: '要求を100ms以内に処理する'
    })
    reqUid = req.uid
    funcUid = func.uid
    createTraceLink(db, projectUid, {
      fromUid: funcUid,
      toUid: reqUid,
      relationType: 'satisfies',
      createdBy: 'human',
      reviewStatus: 'approved'
    })
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('設計要素一覧が種別定義・件数・関係種別を返す（MCP-004）', () => {
    const result = callMcpTool(ctx, 'list_element_types', {}) as {
      stages_and_resources: { type: string; count: number }[]
      design_models: { type: string; count: number; definition: string }[]
      relation_types: { type: string }[]
      ontology_version: string
    }
    expect(result.design_models.map((model) => model.type)).toContain('model_req')
    expect(result.design_models.find((model) => model.type === 'model_req')?.count).toBe(1)
    expect(result.stages_and_resources.map((stage) => stage.type)).toContain('intermediate_document')
    expect(result.relation_types.map((relation) => relation.type)).toContain('satisfies')
    expect(result.ontology_version).toBeTruthy()
  })

  it('設計要素情報取得が属性スキーマと許容関係を返す（MCP-005）', () => {
    const result = callMcpTool(ctx, 'get_element_type', { entity_type: 'model_req' }) as {
      fields: { key: string }[]
      allowed_relations: { relation_type: string; from: string; to: string }[]
      count: number
    }
    expect(result.fields.map((field) => field.key)).toContain('acceptance_criteria')
    expect(
      result.allowed_relations.some(
        (rule) => rule.relation_type === 'satisfies' && rule.from === 'model_func' && rule.to === 'model_req'
      )
    ).toBe(true)
    expect(result.count).toBe(1)

    const stage = callMcpTool(ctx, 'get_element_type', { entity_type: 'resource_text' }) as { definition: string }
    expect(stage.definition).toContain('テキスト')
    expect(() => callMcpTool(ctx, 'get_element_type', { entity_type: 'unknown_type' })).toThrow(/未定義の設計要素種別/)
  })

  it('設計要素検索がスコア上位・AND/OR・上限件数で応答する（MCP-006）', () => {
    // 表示コード完全一致が最上位で返る
    const req = callMcpTool(ctx, 'search_elements', { queries: ['REQ-000001'] }) as {
      results: { uid: string; code: string }[]
      limit: number
    }
    expect(req.limit).toBe(20)
    expect(req.results[0]?.code).toBe('REQ-000001')

    // AND: 両方の語を含む要素だけ
    const and = callMcpTool(ctx, 'search_elements', { queries: ['応答', '機能'], operator: 'AND' }) as {
      results: { uid: string }[]
    }
    expect(and.results.map((row) => row.uid)).toContain(funcUid)
    expect(and.results.map((row) => row.uid)).not.toContain(reqUid)

    // OR: どちらかの語を含む要素
    const or = callMcpTool(ctx, 'search_elements', { queries: ['要求', '機能'], operator: 'OR', limit: 5 }) as {
      results: { uid: string }[]
    }
    expect(or.results.map((row) => row.uid)).toEqual(expect.arrayContaining([reqUid, funcUid]))

    expect(() => callMcpTool(ctx, 'search_elements', { queries: [] })).toThrow(/1件以上/)
  })

  it('設計要素詳細取得が複数UIDの属性・関係を返す（MCP-007）', () => {
    const result = callMcpTool(ctx, 'get_elements', { uids: [funcUid, 'missing-uid'] }) as {
      elements: Array<{
        uid: string
        found: boolean
        code?: string
        detail?: { summary: string } | null
        relations?: { relation_type: string; direction: string }[]
      }>
    }
    expect(result.elements).toHaveLength(2)
    const func = result.elements[0]!
    expect(func.found).toBe(true)
    expect(func.code).toBe('FUNC-000001')
    expect(func.detail?.summary).toBe('要求を100ms以内に処理する')
    expect(func.relations?.[0]?.relation_type).toBe('satisfies')
    expect(func.relations?.[0]?.direction).toBe('outgoing')
    expect(result.elements[1]?.found).toBe(false)
  })

  it('上流・下流トレースが方向どおりの要素と関係を返す（MCP-008）', () => {
    // FUNC -[satisfies]-> REQ: REQ の上流（backward）に FUNC、FUNC の下流（forward）に REQ
    const upstream = callMcpTool(ctx, 'trace_upstream', { uid: reqUid }) as {
      side: string
      elements: { uid: string; hop: number }[]
      relations: { relation_type: string }[]
    }
    expect(upstream.side).toBe('upstream')
    expect(upstream.elements.map((element) => element.uid)).toContain(funcUid)
    expect(upstream.relations[0]?.relation_type).toBe('satisfies')

    const downstream = callMcpTool(ctx, 'trace_downstream', { uid: funcUid }) as {
      side: string
      elements: { uid: string }[]
    }
    expect(downstream.side).toBe('downstream')
    expect(downstream.elements.map((element) => element.uid)).toContain(reqUid)

    expect(() => callMcpTool(ctx, 'trace_upstream', { uid: 'missing' })).toThrow(/起点要素/)
  })

  it('未定義ツールは validation エラーになる', () => {
    expect(() => callMcpTool(ctx, 'unknown_tool', {})).toThrow(/未定義のツール/)
  })

  describe('Streamable HTTP（JSON-RPC 2.0）', () => {
    // サーバ停止で切断された keep-alive 接続を fetch が再利用しないよう、テスト毎に別ポートを使う
    let port = 39460
    let service: McpServerService
    let hasProject = true

    const rpc = async (payload: unknown): Promise<{ status: number; body: unknown }> => {
      const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const text = await response.text()
      return { status: response.status, body: text ? JSON.parse(text) : null }
    }

    beforeEach(async () => {
      hasProject = true
      port += 1
      service = new McpServerService(() => (hasProject ? ctx : null))
      await service.start(port)
    })

    afterEach(async () => {
      await service.stop()
    })

    it('initialize / tools/list / tools/call が MCP 契約で応答する（MCP-001）', async () => {
      expect(service.status()).toMatchObject({ running: true, port, toolCount: MCP_TOOL_DEFINITIONS.length })

      const init = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
      expect(init.status).toBe(200)
      expect(init.body).toMatchObject({
        jsonrpc: '2.0',
        id: 1,
        result: { protocolVersion: '2025-03-26', serverInfo: { name: 'd2d-design-info' } }
      })

      const list = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
      const tools = (list.body as { result: { tools: { name: string }[] } }).result.tools
      expect(tools.map((tool) => tool.name)).toEqual([
        'list_element_types',
        'get_element_type',
        'search_elements',
        'get_elements',
        'trace_upstream',
        'trace_downstream'
      ])

      const call = await rpc({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'search_elements', arguments: { queries: ['REQ-000001'] } }
      })
      const content = (call.body as { result: { content: { type: string; text: string }[]; isError?: boolean } }).result
      expect(content.isError).toBeUndefined()
      expect(JSON.parse(content.content[0]!.text)).toMatchObject({ results: [{ code: 'REQ-000001' }] })
    })

    it('通知は202、未知メソッドは-32601、プロジェクト未オープンはツールエラーを返す', async () => {
      const notification = await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })
      expect(notification.status).toBe(202)

      const unknown = await rpc({ jsonrpc: '2.0', id: 9, method: 'no/such' })
      expect((unknown.body as { error: { code: number } }).error.code).toBe(-32601)

      hasProject = false
      const call = await rpc({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: { name: 'list_element_types' }
      })
      const result = (call.body as { result: { isError?: boolean; content: { text: string }[] } }).result
      expect(result.isError).toBe(true)
      expect(result.content[0]!.text).toContain('プロジェクトが開かれていない')
    })

    it('停止後は接続できず、状態が停止になる（MCP-003）', async () => {
      await service.stop()
      expect(service.status()).toMatchObject({ running: false, port: null, url: null })
      await expect(rpc({ jsonrpc: '2.0', id: 1, method: 'ping' })).rejects.toThrow()
    })
  })
})
