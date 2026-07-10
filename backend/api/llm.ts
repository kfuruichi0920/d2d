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

  /** LLM 実行をジョブとして開始（NFR-003）。結果は job.output（llmRunUid） */
  router.register('llm.run', (params) => {
    const p = asRecord(params)
    requireProject()
    const messages = asMessages(p.messages)
    const processName = typeof p.processName === 'string' && p.processName ? p.processName : 'adhoc'
    return jobs.enqueue('llm.run', { messages, processName, jsonMode: p.jsonMode === true })
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
        `SELECT e.uid, e.code, r.*, pb.relative_path AS prompt_path, rb.relative_path AS result_path
           FROM llm_run_ref r
           JOIN entity_registry e ON e.uid = r.uid
           LEFT JOIN blob_resource pb ON pb.uid = r.prompt_blob_uid
           LEFT JOIN blob_resource rb ON rb.uid = r.result_blob_uid
          WHERE r.uid = ?`
      )
      .get(uid) as { prompt_path?: string; result_path?: string } | undefined
    if (!run) {
      throw new BackendError('not_found', `LLM 実行が見つかりません: ${uid}`, '')
    }
    const readBlob = (rel?: string): string | null => {
      if (!rel) return null
      const path = join(info.rootPath, rel)
      return existsSync(path) ? readFileSync(path, 'utf-8') : null
    }
    return { ...run, prompt_text: readBlob(run.prompt_path), result_text: readBlob(run.result_path) }
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
