/**
 * Local Backend エントリポイント。
 * Electron Main から utilityProcess.fork で別プロセスとして起動され、
 * process.parentPort（MessagePort）経由で BackendRequest / BackendResponse を交換する。
 *
 * Main は Gateway / Shell であり業務ロジックを持たない。DB・ファイルI/O・解析・
 * LLM 通信等の業務ロジックはすべて本プロセス側に実装する
 * （sdd_function_architecture §2「初期実装方針（2026-07確定）」）。
 */
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BackendRequest } from '../src/types/ipc'
import { ApiRouter } from './api/router'
import { registerAppApi } from './api/app'
import { registerProjectApi } from './api/project'
import { registerFeatureApi, registerJobApi, registerSettingsApi } from './api/platform'
import { eventBus } from './events/event-bus'
import { JobManager } from './jobs/job-manager'
import { SettingsService, type SecretCipher } from './settings/settings-service'
import { registerBuiltinFeatures } from './features/feature-registry'
import { callMain, handleBridgeMessage, initMainBridge } from './main-bridge'
import { runWorker } from './workers/worker-runner'
import { requireProject, type ProjectInfo } from './project/project-service'
import { registerDocumentApi } from './api/documents'
import { registerLlmApi } from './api/llm'
import { registerIntermediateApi } from './api/intermediate'
import { registerDesignApi } from './api/design'
import { registerTraceApi } from './api/trace'
import { registerSecondaryApi } from './api/secondary'
import { registerEditApi } from './api/edit'
import { registerDataApi, registerDbToTextHook } from './api/data'
import { registerSearchApi } from './api/search'
import { registerResourceApi } from './api/resource'
import { parseLlmMergeCandidate } from './resource/resource-service'
import { createArchive } from './export/archive-service'
import { registerReportApi, toReportOptions } from './api/report'
import { registerSemanticApi } from './api/semantic'
import { registerLogsApi } from './api/logs'
import { appendDebugLog } from './logging/debug-log'
import { buildReportMarkdown, generateReport } from './report/report-service'
import { buildDesignCandidateMessages, buildResourceMergeMessages } from './llm/request-messages'
import { validateCandidateOutput } from './llm/candidate-validation'
import { runLlm } from './llm/llm-service'
import type { ChatMessage } from './llm/providers'
import { getSourceDocument, importSourceDocument } from './import/import-service'
import { storeExtractionResult, type ExtractionOutput } from './extract/store-extraction'
import { BackendError } from './api/errors'
import { readFileSync } from 'node:fs'

const BACKEND_VERSION = '0.1.0'

interface ParentPort {
  on(event: 'message', listener: (e: { data: unknown }) => void): void
  postMessage(message: unknown): void
}

function getParentPort(): ParentPort {
  const port = (process as unknown as { parentPort?: ParentPort }).parentPort
  if (!port) {
    // 単体起動（デバッグ）時は疎通確認だけして終了する
    console.error('[backend] parentPort がありません。utilityProcess.fork から起動してください。')
    process.exit(1)
  }
  return port
}

function isBackendRequest(data: unknown): data is BackendRequest {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return typeof d.id === 'number' && typeof d.method === 'string'
}

/** safeStorage を Main ブリッジ経由で使う暗号器（P2-2、CORE-045） */
const bridgeCipher: SecretCipher = {
  isAvailable: () => callMain<boolean>('secure.isAvailable'),
  encrypt: (plain) => callMain<string>('secure.encrypt', { value: plain }),
  decrypt: (cipher) => callMain<string>('secure.decrypt', { value: cipher })
}

function main(): void {
  const port = getParentPort()
  initMainBridge(port)

  const userDataDir = process.env.D2D_USER_DATA ?? join(tmpdir(), 'd2d-userdata')
  const settings = new SettingsService(userDataDir, bridgeCipher)
  const jobs = new JobManager(eventBus)
  registerBuiltinFeatures()

  // ワーカー疎通ジョブ（P2-6）。文書抽出ジョブは P5 で追加する
  jobs.registerExecutor('worker.ping', async (params, ctx) => {
    const result = await runWorker({
      request: {
        job_id: ctx.jobId,
        project_uid: 'none',
        worker_name: 'd2d-worker',
        command: 'worker.ping',
        parameters: (params as Record<string, unknown>) ?? {}
      },
      onProgress: (p) => ctx.reportProgress(p.percent, p.message),
      signal: ctx.signal
    })
    return { status: result.status === 'partial' ? 'partial' : 'success', output: result.output }
  })

  // ①原本取込ジョブ（P4-1、IMP-001〜009）
  jobs.registerExecutor('import.source', async (params, ctx) => {
    const { filePath } = params as { filePath: string }
    const { db, info } = requireProject()
    ctx.reportProgress(20, '原本を取込中')
    const result = importSourceDocument(db, info.projectUid, info.rootPath, filePath)
    ctx.log('info', `原本を取込みました: ${result.fileName}`, { code: result.code, hash: result.fileHash })
    return { status: 'success', output: result }
  })

  // ②Word 抽出ジョブ（P5、EXT-001〜018）
  jobs.registerExecutor('extract.word', async (params, ctx) => {
    const { sourceDocumentUid } = params as { sourceDocumentUid: string }
    const { db, info, paths } = requireProject()
    const doc = getSourceDocument(db, sourceDocumentUid)
    if (!doc.blob_relative_path) {
      throw new BackendError('not_found', '原本ファイルの blob 参照がありません', sourceDocumentUid)
    }
    const filePath = join(info.rootPath, doc.blob_relative_path)
    const workDir = join(paths.blobsDir, 'extracted', `job-${ctx.jobId}`)

    ctx.reportProgress(5, 'ワーカーを起動中')
    const workerResult = await runWorker({
      request: {
        job_id: ctx.jobId,
        project_uid: info.projectUid,
        worker_name: 'd2d-worker',
        command: 'extract.word',
        parameters: { file_path: filePath, work_dir: workDir }
      },
      onProgress: (p) => ctx.reportProgress(5 + p.percent * 0.6, p.message),
      signal: ctx.signal
    })
    if (!workerResult.output_ref) {
      throw new BackendError('worker', '抽出ワーカーが出力を返しませんでした', '')
    }

    ctx.reportProgress(70, '抽出結果を候補として保存中')
    const extraction = JSON.parse(readFileSync(workerResult.output_ref, 'utf-8')) as ExtractionOutput
    const stored = storeExtractionResult(db, {
      projectUid: info.projectUid,
      projectRoot: info.rootPath,
      sourceDocumentUid,
      extraction,
      workDir
    })
    ctx.log('info', `②抽出データ候補を保存しました: ${stored.code}`, stored)
    eventBus.emit('artifact.updated', { extractedDocumentUid: stored.extractedDocumentUid })
    return {
      status: workerResult.status === 'partial' ? 'partial' : 'success',
      output: stored
    }
  })

  // LLM 実行ジョブ（P6、NFR-003。UI をブロックせず、キャンセル可能）
  jobs.registerExecutor('llm.run', async (params, ctx) => {
    const { messages, processName, jsonMode, promptTemplateUid } = params as {
      messages: ChatMessage[]
      processName: string
      jsonMode?: boolean
      promptTemplateUid?: string
    }
    const { db, info } = requireProject()
    ctx.reportProgress(10, 'LLM へ送信中')
    const result = await runLlm(
      db,
      settings,
      { projectUid: info.projectUid, rootPath: info.rootPath },
      { processName, messages, jsonMode, promptTemplateUid, signal: ctx.signal }
    )
    ctx.log('info', `LLM 実行完了: ${result.code}`, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs
    })
    return { status: 'success', output: result }
  })

  // ③テキスト候補生成ジョブ（P7-4/P7-6。正規化・図表説明。LLM 出力は候補のまま返す）
  jobs.registerExecutor('intermediate.textCandidate', async (params, ctx) => {
    const { uid, elementId, purpose } = params as { uid: string; elementId: string; purpose: 'normalize' | 'describe' }
    const { db, info } = requireProject()

    const doc = db.prepare(`SELECT structure_json FROM intermediate_document WHERE uid = ?`).get(uid) as
      { structure_json: string } | undefined
    if (!doc) {
      throw new BackendError('not_found', `中間文書が見つかりません: ${uid}`, '')
    }
    const structure = JSON.parse(doc.structure_json) as {
      elements: {
        id: string
        type: string
        text?: string
        rows?: { text: string }[][]
        image?: string
        resource_uid?: string
      }[]
    }
    const element = structure.elements.find((e) => e.id === elementId)
    if (!element) {
      throw new BackendError('not_found', `要素が見つかりません: ${elementId}`, '')
    }

    let systemPrompt: string
    let userContent: string
    if (purpose === 'normalize') {
      // MID-026: 設計意味を変えない正規化（曖昧性排除・表記揺れ統一・主語補完・用語正規化）
      systemPrompt =
        'あなたは設計文書の校正支援AIです。与えられた本文の設計上の意味を一切変えずに、' +
        '曖昧な表現の明確化、表記揺れの統一、省略された主語の補完、用語の正規化のみを行ってください。' +
        '正規化後の本文だけを出力してください（説明・前置きは不要）。'
      userContent = element.text ?? ''
    } else {
      // MID-013: 図表説明候補
      systemPrompt =
        'あなたは設計文書のレビュー支援AIです。与えられた図または表の内容から、' +
        '設計書に記載する簡潔な説明文（1〜3文）の候補を日本語で出力してください。説明文だけを出力してください。'
      userContent =
        element.type === 'table'
          ? (element.rows ?? []).map((r) => r.map((c) => c.text).join(' | ')).join('\n')
          : `図ファイル: ${element.image ?? ''}（周辺情報から推測してください）`
    }
    if (!userContent.trim()) {
      throw new BackendError('validation', '候補生成の入力が空です', `element=${elementId}`)
    }

    ctx.reportProgress(20, 'LLM 候補を生成中')
    const result = await runLlm(
      db,
      settings,
      { projectUid: info.projectUid, rootPath: info.rootPath },
      {
        processName: purpose === 'normalize' ? 'normalize-text' : 'describe-figure',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent }
        ],
        inputRefUid: element.resource_uid,
        signal: ctx.signal
      }
    )
    eventBus.emit('llm.candidate.generated', { intermediateDocumentUid: uid, elementId, llmRunUid: result.llmRunUid })
    return {
      status: 'success',
      output: {
        llmRunUid: result.llmRunUid,
        elementId,
        purpose,
        originalText: element.text ?? '',
        candidateText: result.content.trim()
      }
    }
  })

  // ④設計モデル候補生成ジョブ（P8-3、LLM-030〜034、sdd_function_architecture §10.2）
  jobs.registerExecutor('design.generateCandidates', async (params, ctx) => {
    const { chunkUid, messages, promptTemplateUid } = params as {
      chunkUid: string
      messages?: ChatMessage[]
      promptTemplateUid?: string
    }
    const { db, info } = requireProject()

    ctx.reportProgress(10, '入力チャンクを構築中')
    const requestMessages = messages ?? buildDesignCandidateMessages(db, chunkUid)

    ctx.reportProgress(30, 'LLM で候補を生成中')
    const result = await runLlm(
      db,
      settings,
      { projectUid: info.projectUid, rootPath: info.rootPath },
      {
        processName: 'design-candidates',
        messages: requestMessages,
        jsonMode: true,
        inputRefUid: chunkUid,
        promptTemplateUid,
        signal: ctx.signal
      }
    )

    // 検証（LLM-045/046）。エラーでも候補セットとして開けるよう、結果は llm_run 参照で返す
    const validation = validateCandidateOutput(result.content)
    ctx.log(
      'info',
      `候補生成完了: 要素${validation.candidateSet?.elements.length ?? 0}件 / 関係${validation.candidateSet?.relations.length ?? 0}件`,
      {
        errors: validation.errors
      }
    )
    eventBus.emit('llm.candidate.generated', { llmRunUid: result.llmRunUid, chunkUid, ok: validation.ok })
    return {
      status: 'success',
      output: {
        llmRunUid: result.llmRunUid,
        chunkUid,
        ok: validation.ok,
        errors: validation.errors,
        elementCount: validation.candidateSet?.elements.length ?? 0,
        relationCount: validation.candidateSet?.relations.length ?? 0
      }
    }
  })

  // ZIP アーカイブ生成ジョブ（P12-3、DATA-030。blob 量に応じて長時間化するためジョブ化）
  // Resource EditorのLLMマージ候補。候補を返すだけで正本は保存しない（MID-005）。
  jobs.registerExecutor('resource.mergeCandidate', async (params, ctx) => {
    const { targetType, sources, messages, promptTemplateUid } = params as {
      targetType: string
      sources: Array<{ resourceUid?: string; type: string; values: Record<string, unknown> }>
      messages?: ChatMessage[]
      promptTemplateUid?: string
    }
    const { db, info } = requireProject()
    const requestMessages = messages ?? buildResourceMergeMessages(targetType, sources)
    ctx.reportProgress(20, 'ResourceのLLMマージ候補を生成中')
    const result = await runLlm(
      db,
      settings,
      { projectUid: info.projectUid, rootPath: info.rootPath },
      {
        processName: 'resource-merge',
        messages: requestMessages,
        jsonMode: true,
        inputRefUid: sources[0]?.resourceUid,
        promptTemplateUid,
        signal: ctx.signal
      }
    )
    return {
      status: 'success',
      output: {
        values: parseLlmMergeCandidate(targetType, result.content),
        warnings: [] as string[],
        llmRunUid: result.llmRunUid
      }
    }
  })
  jobs.registerExecutor('archive.create', async (params, ctx) => {
    const { name } = (params as { name?: string }) ?? {}
    const { db, info } = requireProject()
    const result = createArchive(db, info.projectUid, info.rootPath, {
      name,
      onProgress: (percent, message) => ctx.reportProgress(percent, message)
    })
    ctx.log('info', `アーカイブを作成しました: ${result.fileName}`, {
      size: result.size,
      fileCount: result.fileCount
    })
    return { status: 'success', output: result }
  })

  // レポート生成ジョブ（P13、EXP-001〜006、sdd_ui_design §「長時間処理の非同期化」）
  jobs.registerExecutor('report.generate', async (params, ctx) => {
    const p = (params as Record<string, unknown>) ?? {}
    const { db, info } = requireProject()
    const options = toReportOptions(p)

    // LLM 要約候補の組み込み（EXP 任意機能）。失敗してもレポート本体は出力する
    if (p.llmSummary === true) {
      ctx.reportProgress(20, 'LLM 要約候補を生成中')
      try {
        const built = buildReportMarkdown(db, info.projectUid, options)
        const result = await runLlm(
          db,
          settings,
          { projectUid: info.projectUid, rootPath: info.rootPath },
          {
            processName: 'report-summary',
            messages: [
              {
                role: 'system',
                content:
                  'あなたは設計文書の要約AIです。与えられた設計レポートの要点を日本語で3〜5行に要約してください。要約だけを出力してください。'
              },
              { role: 'user', content: built.markdown.slice(0, 20_000) }
            ],
            signal: ctx.signal
          }
        )
        options.summaryText = result.content.trim()
      } catch (error) {
        ctx.log('warn', 'LLM 要約の生成に失敗したため、要約なしで出力します', {
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }

    ctx.reportProgress(60, 'レポートを構築中')
    const result = generateReport(db, info.projectUid, info.rootPath, options)
    ctx.log('info', `レポートを出力しました: ${result.fileName}`, result.stats)
    return { status: 'success', output: result }
  })

  // プロジェクト open/close に応じてジョブログ出力先を切り替える
  eventBus.on('project.opened', (_event, payload) => {
    const info = payload as ProjectInfo
    jobs.setLogDir(join(info.rootPath, 'logs', 'jobs'))
  })
  eventBus.on('project.closed', () => jobs.setLogDir(null))

  const router = new ApiRouter()
  registerAppApi(router, BACKEND_VERSION)
  registerProjectApi(router, settings)
  registerSettingsApi(router, settings)
  registerJobApi(router, jobs)
  registerFeatureApi(router)
  registerDocumentApi(router, jobs)
  registerLlmApi(router, jobs, settings)
  registerIntermediateApi(router, jobs)
  registerDesignApi(router, jobs)
  registerTraceApi(router)
  registerSecondaryApi(router)
  registerEditApi(router, settings)
  registerDataApi(router, jobs)
  registerReportApi(router, jobs)
  registerSearchApi(router, settings)
  registerResourceApi(router, jobs)
  registerSemanticApi(router, settings)
  registerLogsApi(router)
  // Backend API の失敗をデバッグログへ記録する（W11）。log.* 自身は除外
  router.onDispatchError = (method, error) => {
    if (method.startsWith('log.')) return
    appendDebugLog('backend', 'error', `API失敗: ${method}`, error instanceof Error ? error.message : String(error))
  }
  registerDbToTextHook()

  // Backend 内イベントを Renderer へ転送する（CORE-030〜032）
  eventBus.onAny((event, payload) => {
    port.postMessage({ event, payload })
  })

  port.on('message', (e) => {
    const data = e.data
    if (handleBridgeMessage(data)) return
    if (!isBackendRequest(data)) {
      console.error('[backend] 不正なリクエストを無視しました:', JSON.stringify(data).slice(0, 200))
      return
    }
    void router.dispatch(data).then((response) => {
      port.postMessage(response)
    })
  })

  // 起動完了イベント（Main の接続監視が購読する）
  port.postMessage({ event: 'backend.ready', payload: { pid: process.pid, version: BACKEND_VERSION } })
  console.log(`[backend] started pid=${process.pid} version=${BACKEND_VERSION}`)
}

main()
