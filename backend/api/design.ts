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
  createVerificationFor,
  listDesignElements,
  listAllowedRelationRules,
  listTraceLinks,
  setVerificationDetail,
  type TraceLinkAttributes,
  updateDesignElement
} from '../design/design-service'
import { validateCandidateOutput } from '../llm/candidate-validation'
import {
  confirmOntology,
  getOntology,
  saveModelDefinition,
  saveRelationDefinition,
  setAllowance
} from '../ontology/ontology-service'

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
      modelType: requireString(p, 'modelType'),
      title: requireString(p, 'title'),
      summary: p.summary === undefined ? undefined : String(p.summary),
      detail: typeof p.detail === 'object' && p.detail !== null ? (p.detail as Record<string, unknown>) : undefined,
      ownerUid: p.ownerUid === undefined ? undefined : String(p.ownerUid)
    })
  })

  router.register('design.listElements', (params) => {
    const p = asRecord(params ?? {})
    const { db, info } = requireProject()
    return listDesignElements(db, info.projectUid, {
      modelType: p.modelType === undefined ? undefined : String(p.modelType),
      status: p.status === undefined ? undefined : String(p.status)
    })
  })

  router.register('design.updateElement', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    updateDesignElement(db, requireString(p, 'uid'), {
      title: requireString(p, 'title'),
      summary: String(p.summary ?? ''),
      detail: typeof p.detail === 'object' && p.detail !== null ? (p.detail as Record<string, unknown>) : {},
      status: p.status === undefined ? undefined : String(p.status)
    })
    return { saved: true }
  })

  // ---- オントロジー設定（MODEL-019〜028） ----
  router.register('ontology.get', () => {
    const { db } = requireProject()
    return getOntology(db)
  })
  router.register('ontology.saveModel', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    saveModelDefinition(db, {
      modelType: requireString(p, 'modelType'),
      codePrefix: p.codePrefix === undefined ? undefined : String(p.codePrefix),
      label: requireString(p, 'label'),
      layer: requireString(p, 'layer'),
      definition: requireString(p, 'definition'),
      fieldSchemaJson: String(p.fieldSchemaJson ?? '[]'),
      enabled: p.enabled !== false
    })
    return getOntology(db)
  })
  router.register('ontology.saveRelation', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    saveRelationDefinition(db, {
      relationType: requireString(p, 'relationType'),
      label: requireString(p, 'label'),
      definition: requireString(p, 'definition'),
      requiredAttr: p.requiredAttr === undefined ? undefined : String(p.requiredAttr),
      enabled: p.enabled !== false
    })
    return getOntology(db)
  })
  router.register('ontology.setAllowance', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    setAllowance(db, {
      relationType: requireString(p, 'relationType'),
      sourceModelType: requireString(p, 'sourceModelType'),
      targetModelType: requireString(p, 'targetModelType'),
      allowed: p.allowed === true
    })
    return { saved: true }
  })
  router.register('ontology.confirm', () => {
    const { db } = requireProject()
    return { version: confirmOntology(db) }
  })
  /** 検証項目の作成 + verifies 紐づけ（P10-5、EDIT-040/041） */
  router.register('design.createVerification', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return createVerificationFor(
      db,
      info.projectUid,
      requireString(p, 'targetUid'),
      p.title === undefined ? undefined : String(p.title)
    )
  })

  /** 検証条件・手順・期待結果の保存（EDIT-042） */
  router.register('design.setVerificationDetail', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    setVerificationDetail(db, requireString(p, 'uid'), {
      condition: String(p.condition ?? ''),
      procedure: String(p.procedure ?? ''),
      expected: String(p.expected ?? '')
    })
    return { saved: true }
  })

  // ---- 関係（P8-2） ----

  router.register('design.listAllowedRelationRules', () => {
    const { db } = requireProject()
    return listAllowedRelationRules(db)
  })

  router.register('design.createRelation', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const relationType = requireString(p, 'relationType')

    return createTraceLink(db, info.projectUid, {
      fromUid: requireString(p, 'fromUid'),
      toUid: requireString(p, 'toUid'),
      relationType,
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
      chunkUid: context.chunkUid ?? undefined,
      intermediateDocumentUid: context.intermediateDocumentUid,
      candidateSet: validation.candidateSet,
      errors: validation.errors,
      ok: validation.ok
    }
  })

  /** 編集途中の候補セットは LLM 実行ごとに1件だけ保持する（MODEL-030）。 */
  router.register('design.getCandidateDraft', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const llmRunUid = requireString(p, 'llmRunUid')
    const row = db
      .prepare(
        `SELECT candidate_set_json AS candidateSetJson, updated_at AS updatedAt FROM llm_candidate_draft WHERE llm_run_uid=?`
      )
      .get(llmRunUid) as { candidateSetJson: string; updatedAt: string } | undefined
    return row ? { candidateSet: JSON.parse(row.candidateSetJson) as unknown, updatedAt: row.updatedAt } : null
  })

  router.register('design.saveCandidateDraft', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const llmRunUid = requireString(p, 'llmRunUid')
    const candidateSet = { elements: p.elements ?? [], relations: p.relations ?? [], warnings: [] }
    if (!Array.isArray(candidateSet.elements) || !Array.isArray(candidateSet.relations))
      throw new BackendError(
        'validation',
        '一時保存する候補セットの形式が不正です',
        'elements / relations は配列が必要です'
      )
    db.prepare(
      `INSERT INTO llm_candidate_draft(llm_run_uid,candidate_set_json,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)
       ON CONFLICT(llm_run_uid) DO UPDATE SET candidate_set_json=excluded.candidate_set_json,updated_at=CURRENT_TIMESTAMP`
    ).run(llmRunUid, JSON.stringify(candidateSet))
    return { saved: true }
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

    const result = adoptCandidates(db, info.projectUid, {
      candidateSet: validation.candidateSet,
      intermediateDocumentUid,
      chunkUid: context.chunkUid ?? undefined,
      llmRunUid
    })
    db.prepare('DELETE FROM llm_candidate_draft WHERE llm_run_uid=?').run(llmRunUid)
    return result
  })
}
