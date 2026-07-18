/**
 * LLM API（P6）。実行はジョブ経由（llm.run）で行い、送信前確認は llm.preview で行う。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import type { SettingsService } from '../settings/settings-service'
import { requireProject } from '../project/project-service'
import { previewLlm, resolveLlmSettings } from '../llm/llm-service'
import type { ChatMessage } from '../llm/providers'
import {
  buildConnectionTestMessages,
  buildDesignCandidateMessages,
  buildResourceMergeMessages,
  buildSemanticTermMessages,
  type LlmRequestOperation,
  type ResourceMergeSource
} from '../llm/request-messages'
import {
  getPromptTemplate,
  listPromptTemplates,
  renderTemplate,
  savePromptTemplate,
  type TemplatePurpose
} from '../llm/prompt-templates'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', String(params))
  }
  return params as Record<string, unknown>
}

function asMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BackendError('validation', 'messages は必須の配列です', '')
  }
  return value.map((m) => {
    const r = m as { role?: string; content?: string }
    if (!r.role || !['system', 'user', 'assistant'].includes(r.role) || typeof r.content !== 'string') {
      throw new BackendError('validation', 'messages の形式が不正です', JSON.stringify(m).slice(0, 200))
    }
    return { role: r.role as ChatMessage['role'], content: r.content }
  })
}

export function registerLlmApi(router: ApiRouter, jobs: JobManager, settings: SettingsService): void {
  /** 現在の LLM 設定（APIキー実値は含まない） */
  router.register('llm.getSettings', () => {
    const project = requireProject()
    const resolved = resolveLlmSettings(settings)
    const preview = previewLlm(settings, project.info.rootPath, [{ role: 'user', content: '' }])
    return { ...resolved, external: preview.external, externalSendAllowed: preview.externalSendAllowed }
  })

  /** 送信前確認（LLM-040）: マスキング結果・送信先・警告を返す。送信しない */
  router.register('llm.preview', (params) => {
    const p = asRecord(params)
    const project = requireProject()
    return previewLlm(settings, project.info.rootPath, asMessages(p.messages))
  })

  /** 画面別の既定プロンプトと送信本文を構築する。Providerへの送信・ジョブ登録は行わない（LLM-024/040）。 */
  router.register('llm.prepareRequest', (params) => {
    const p = asRecord(params)
    const operation = String(p.operation ?? '') as LlmRequestOperation
    const context = asRecord(p.context ?? {})
    const { db } = requireProject()
    if (operation === 'connection-test') {
      return {
        operation,
        purpose: 'other',
        processName: 'connection-test',
        jsonMode: false,
        messages: buildConnectionTestMessages()
      }
    }
    if (operation === 'semantic-terms') {
      return {
        operation,
        purpose: 'glossary',
        processName: 'semantic-term-candidates',
        jsonMode: true,
        messages: buildSemanticTermMessages(String(context.text ?? ''))
      }
    }
    if (operation === 'design-candidates') {
      const chunkUid = String(context.chunkUid ?? '')
      if (!chunkUid) throw new BackendError('validation', 'chunkUidは必須です', '')
      return {
        operation,
        purpose: 'classify',
        processName: 'design-candidates',
        jsonMode: true,
        messages: buildDesignCandidateMessages(db, chunkUid)
      }
    }
    if (operation === 'resource-merge') {
      const targetType = String(context.targetType ?? '')
      const sources = Array.isArray(context.sources) ? (context.sources as ResourceMergeSource[]) : []
      return {
        operation,
        purpose: 'other',
        processName: 'resource-merge',
        jsonMode: true,
        messages: buildResourceMergeMessages(targetType, sources)
      }
    }
    throw new BackendError('validation', `未対応のLLM問い合わせです: ${operation}`, '')
  })

  /** 確認画面で承認済みのメッセージだけを対応ジョブへ登録する（LLM-040）。 */
  router.register('llm.runConfirmed', (params) => {
    const p = asRecord(params)
    const operation = String(p.operation ?? '') as LlmRequestOperation
    const context = asRecord(p.context ?? {})
    const messages = asMessages(p.messages)
    const promptTemplateUid = typeof p.promptTemplateUid === 'string' ? p.promptTemplateUid : undefined
    requireProject()
    if (operation === 'connection-test' || operation === 'semantic-terms') {
      return jobs.enqueue('llm.run', {
        messages,
        processName: operation === 'connection-test' ? 'connection-test' : 'semantic-term-candidates',
        jsonMode: operation === 'semantic-terms',
        promptTemplateUid
      })
    }
    if (operation === 'design-candidates') {
      const chunkUid = String(context.chunkUid ?? '')
      if (!chunkUid) throw new BackendError('validation', 'chunkUidは必須です', '')
      return jobs.enqueue('design.generateCandidates', { chunkUid, messages, promptTemplateUid })
    }
    if (operation === 'resource-merge') {
      const targetType = String(context.targetType ?? '')
      const sources = Array.isArray(context.sources) ? (context.sources as ResourceMergeSource[]) : []
      buildResourceMergeMessages(targetType, sources)
      return jobs.enqueue('resource.mergeCandidate', { targetType, sources, messages, promptTemplateUid })
    }
    throw new BackendError('validation', `未対応のLLM問い合わせです: ${operation}`, '')
  })

  /** LLM 実行をジョブとして開始（NFR-003）。結果は job.output（llmRunUid） */
  router.register('llm.run', (params) => {
    const p = asRecord(params)
    requireProject()
    const messages = asMessages(p.messages)
    const processName = typeof p.processName === 'string' && p.processName ? p.processName : 'adhoc'
    return jobs.enqueue('llm.run', {
      messages,
      processName,
      jsonMode: p.jsonMode === true,
      promptTemplateUid: typeof p.promptTemplateUid === 'string' ? p.promptTemplateUid : undefined
    })
  })

  /** LLM 実行ログ一覧（LLM-015、Panel LLM Logs） */
  router.register('llm.listRuns', () => {
    const { db, info } = requireProject()
    return db
      .prepare(
        `SELECT e.uid, e.code, r.tool_name, r.process_name, r.model_name, r.input_tokens, r.output_tokens,
                r.estimated_cost, r.duration_ms, r.status, r.error_detail, r.executed_at
           FROM llm_run_ref r JOIN entity_registry e ON e.uid = r.uid
          WHERE e.project_uid = ?
          ORDER BY r.executed_at DESC LIMIT 200`
      )
      .all(info.projectUid)
  })

  /** LLM 実行の詳細（prompt / result 本文を blob から読み出す） */
  router.register('llm.getRun', (params) => {
    const p = asRecord(params)
    const uid = String(p.uid ?? '')
    const { db, info } = requireProject()
    const run = db
      .prepare(
        `SELECT e.uid, e.code, r.*, pb.relative_path AS prompt_path, rb.relative_path AS result_path,
                rqb.relative_path AS raw_request_path, rsb.relative_path AS raw_response_path
           FROM llm_run_ref r
           JOIN entity_registry e ON e.uid = r.uid
           LEFT JOIN blob_resource pb ON pb.uid = r.prompt_blob_uid
           LEFT JOIN blob_resource rb ON rb.uid = r.result_blob_uid
           LEFT JOIN blob_resource rqb ON rqb.uid = r.raw_request_blob_uid
           LEFT JOIN blob_resource rsb ON rsb.uid = r.raw_response_blob_uid
          WHERE r.uid = ?`
      )
      .get(uid) as
      { prompt_path?: string; result_path?: string; raw_request_path?: string; raw_response_path?: string } | undefined
    if (!run) {
      throw new BackendError('not_found', `LLM 実行が見つかりません: ${uid}`, '')
    }
    const readBlob = (rel?: string): string | null => {
      if (!rel) return null
      const path = join(info.rootPath, rel)
      return existsSync(path) ? readFileSync(path, 'utf-8') : null
    }
    return {
      ...run,
      prompt_text: readBlob(run.prompt_path),
      result_text: readBlob(run.result_path),
      raw_request_text: readBlob(run.raw_request_path),
      raw_response_text: readBlob(run.raw_response_path)
    }
  })

  /**
   * LLM ログからの候補再作成（W12）。
   * 入力参照（チャンク／中間要素）を保持する実行だけ、同じ入力で候補生成ジョブを再登録する。
   */
  router.register('llm.retryRun', (params) => {
    const p = asRecord(params)
    const uid = String(p.uid ?? '')
    const { db } = requireProject()
    const run = db.prepare(`SELECT process_name, input_ref_uid FROM llm_run_ref WHERE uid = ?`).get(uid) as
      { process_name: string; input_ref_uid: string | null } | undefined
    if (!run) throw new BackendError('not_found', `LLM 実行が見つかりません: ${uid}`, '')
    if (!run.input_ref_uid) {
      throw new BackendError('validation', 'この実行は入力参照を持たないため再作成できません', run.process_name)
    }
    if (run.process_name === 'design-candidates') {
      return jobs.enqueue('design.generateCandidates', { chunkUid: run.input_ref_uid })
    }
    throw new BackendError(
      'validation',
      `この処理種別の再作成には未対応です: ${run.process_name}`,
      '対応種別: design-candidates（④候補生成）'
    )
  })

  // ---- プロンプトテンプレート（P6-3） ----

  router.register('prompt.list', () => {
    const { db, info } = requireProject()
    return listPromptTemplates(db, info.projectUid)
  })

  router.register('prompt.save', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return savePromptTemplate(db, info.projectUid, {
      templateName: String(p.templateName ?? ''),
      templateVersion: String(p.templateVersion ?? ''),
      purpose: String(p.purpose ?? 'other') as TemplatePurpose,
      templateText: String(p.templateText ?? ''),
      variables: Array.isArray(p.variables) ? (p.variables as string[]) : undefined,
      modelHint: p.modelHint === undefined ? undefined : String(p.modelHint)
    })
  })

  router.register('prompt.render', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const template = getPromptTemplate(db, String(p.uid ?? ''))
    return { rendered: renderTemplate(template.template_text, (p.variables as Record<string, string>) ?? {}) }
  })
}
