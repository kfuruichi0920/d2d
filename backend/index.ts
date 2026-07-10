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
    const { messages, processName, jsonMode } = params as {
      messages: ChatMessage[]
      processName: string
      jsonMode?: boolean
    }
    const { db, info } = requireProject()
    ctx.reportProgress(10, 'LLM へ送信中')
    const result = await runLlm(
      db,
      settings,
      { projectUid: info.projectUid, rootPath: info.rootPath },
      { processName, messages, jsonMode, signal: ctx.signal }
    )
    ctx.log('info', `LLM 実行完了: ${result.code}`, {
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      durationMs: result.durationMs
    })
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
  registerProjectApi(router)
  registerSettingsApi(router, settings)
  registerJobApi(router, jobs)
  registerFeatureApi(router)
  registerDocumentApi(router, jobs)
  registerLlmApi(router, jobs, settings)

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
