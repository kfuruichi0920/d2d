/**
 * ④設計モデル API（P8）。要素・関係・候補セット（生成→取得→採用）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import { requireProject } from '../project/project-service'
import {
  adoptCandidates,
  createDesignElement,
  createTraceLink,
  listDesignElements,
  listTraceLinks,
  RELATION_TYPES,
  type RelationType,
  type TraceLinkAttributes
} from '../design/design-service'
import { validateCandidateOutput } from '../llm/candidate-validation'
import type { DesignCategory } from '../store/entity-types'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', String(params))
  }
  return params as Record<string, unknown>
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new BackendError('validation', `${key} は必須の文字列です`, '')
  }
  return value
}

/** llm_run_ref から候補セット・入力チャンク・③中間文書を解決する */
function loadCandidateContext(uid: string): {
  llmRunUid: string
  chunkUid: string | null
  intermediateDocumentUid: string | null
  rawContent: string
  status: string
} {
  const { db, info } = requireProject()
  const run = db
    .prepare(
      `SELECT r.uid, r.status, r.input_ref_uid, b.relative_path AS result_path
         FROM llm_run_ref r LEFT JOIN blob_resource b ON b.uid = r.result_blob_uid
        WHERE r.uid = ?`
    )
    .get(uid) as { uid: string; status: string; input_ref_uid: string | null; result_path: string | null } | undefined
  if (!run) {
    throw new BackendError('not_found', `LLM 実行が見つかりません: ${uid}`, '')
  }
  let rawContent = ''
  if (run.result_path) {
    const path = join(info.rootPath, run.result_path)
    if (existsSync(path)) {
      const parsed = JSON.parse(readFileSync(path, 'utf-8')) as { content?: string }
      rawContent = parsed.content ?? ''
    }
  }
  let intermediateDocumentUid: string | null = null
  if (run.input_ref_uid) {
    const chunk = db.prepare(`SELECT intermediate_document_uid FROM chunk WHERE uid = ?`).get(run.input_ref_uid) as
      { intermediate_document_uid: string } | undefined
    intermediateDocumentUid = chunk?.intermediate_document_uid ?? null
  }
  return {
    llmRunUid: run.uid,
    chunkUid: run.input_ref_uid,
    intermediateDocumentUid,
    rawContent,
    status: run.status
  }
}

export function registerDesignApi(router: ApiRouter, jobs: JobManager): void {
  // ---- 要素（P8-1） ----

  router.register('design.createElement', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return createDesignElement(db, info.projectUid, {
      category: requireString(p, 'category') as DesignCategory,
      title: requireString(p, 'title'),
      description: p.description === undefined ? undefined : String(p.description),
      ownerUid: p.ownerUid === undefined ? undefined : String(p.ownerUid)
    })
  })

  router.register('design.listElements', (params) => {
    const p = asRecord(params ?? {})
    const { db, info } = requireProject()
    return listDesignElements(db, info.projectUid, {
      category: p.category === undefined ? undefined : (String(p.category) as DesignCategory),
      status: p.status === undefined ? undefined : String(p.status)
    })
  })

  // ---- 関係（P8-2） ----

  router.register('design.createRelation', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const relationType = requireString(p, 'relationType')
    if (!RELATION_TYPES.includes(relationType as RelationType)) {
      throw new BackendError('validation', `relation_type は11種類に限定されています: ${relationType}`, '')
    }
    return createTraceLink(db, info.projectUid, {
      fromUid: requireString(p, 'fromUid'),
      toUid: requireString(p, 'toUid'),
      relationType: relationType as RelationType,
      attributes: (p.attributes as TraceLinkAttributes | undefined) ?? {},
      createdBy: 'human',
      reviewStatus: 'approved'
    })
  })

  router.register('design.listRelations', (params) => {
    const p = asRecord(params ?? {})
    const { db, info } = requireProject()
    return listTraceLinks(db, info.projectUid, {
      uid: p.uid === undefined ? undefined : String(p.uid),
      relationType: p.relationType === undefined ? undefined : String(p.relationType)
    })
  })

  // ---- 候補セット（P8-3〜P8-5） ----

  /** チャンクから④候補生成ジョブを開始（LLM-030〜034、MID-025/028） */
  router.register('design.generateCandidates', (params) => {
    const p = asRecord(params)
    requireProject()
    return jobs.enqueue('design.generateCandidates', { chunkUid: requireString(p, 'chunkUid') })
  })

  /** 候補セットの取得 + 再検証（Candidate Set Review Editor 用。LLM-045/046） */
  router.register('design.getCandidateSet', (params) => {
    const p = asRecord(params)
    const context = loadCandidateContext(requireString(p, 'llmRunUid'))
    const validation = validateCandidateOutput(context.rawContent)
    return {
      llmRunUid: context.llmRunUid,
      chunkUid: context.chunkUid,
      intermediateDocumentUid: context.intermediateDocumentUid,
      candidateSet: validation.candidateSet,
      errors: validation.errors,
      ok: validation.ok
    }
  })

  /**
   * 編集済み候補セットの採用（MODEL-006〜009）。
   * スキーマ・参照・許容関係・重複を同一トランザクションで検査し、NG なら全体を反映しない。
   */
  router.register('design.adoptCandidates', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const llmRunUid = requireString(p, 'llmRunUid')
    const context = loadCandidateContext(llmRunUid)
    const intermediateDocumentUid =
      p.intermediateDocumentUid !== undefined ? String(p.intermediateDocumentUid) : context.intermediateDocumentUid
    if (!intermediateDocumentUid) {
      throw new BackendError('validation', '根拠となる③中間文書を特定できません', '根拠リンク不足（MODEL-009）')
    }

    // 保存前編集の結果を再検証（LLM-046: エラーは正本反映を止める）
    const edited = JSON.stringify({
      elements: p.elements ?? [],
      relations: p.relations ?? [],
      warnings: []
    })
    const validation = validateCandidateOutput(edited)
    if (!validation.ok || !validation.candidateSet) {
      throw new BackendError('validation', '候補セットに検証エラーがあります', validation.errors.join('; '))
    }

    return adoptCandidates(db, info.projectUid, {
      candidateSet: validation.candidateSet,
      intermediateDocumentUid,
      llmRunUid
    })
  })
}
