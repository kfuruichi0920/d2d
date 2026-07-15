/**
 * ③中間データ API（P7）。統合・編集・チャンク・LLM 候補（正規化/図表説明）。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import { requireProject } from '../project/project-service'
import { eventBus } from '../events/event-bus'
import { generateMarkdown, type MarkdownVariant } from '../extract/markdown-gen'
import {
  addIntermediateElement,
  createChunk,
  createIntermediateDocument,
  insertExtractedItems,
  unlinkExtractedItems,
  deleteIntermediateItems,
  duplicateIntermediateElement,
  reorderIntermediateItems,
  changeIntermediateHierarchy,
  updateIntermediateItemStatuses,
  deleteChunk,
  editElementText,
  editIntermediateElement,
  ensureIntermediateItemTraceLinks,
  getChunk,
  getChunkText,
  listChunks,
  updateChunk,
  updateIntermediateSources,
  mergeElements,
  reorderChunks,
  splitElement,
  syncIntermediateDocumentStatus,
  type IntermediateStructure
} from '../intermediate/intermediate-service'
import { listArtifactSettings, listDevPhases, saveArtifactSetting, saveDevPhase } from '../project/project-settings'

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

/**
 * 成果物種別・開発フェーズ設定を解決する。
 * 未設定プロジェクトでは既定値（統合設計書 / DD）を自動作成して通知する（MVP 運用）。
 */
function resolveArtifactAndPhase(
  db: ReturnType<typeof requireProject>['db'],
  projectUid: string,
  artifactTypeId?: string,
  devPhaseId?: string
): { artifactTypeId: string; devPhaseId: string } {
  let artifacts = listArtifactSettings(db, projectUid).filter((a) => a.is_active === 1)
  if (artifacts.length === 0) {
    saveArtifactSetting(db, projectUid, { artifactName: '統合設計書', artifactTypeId: 'design_doc' })
    artifacts = listArtifactSettings(db, projectUid)
    eventBus.emit('artifact.updated', { kind: 'default-artifact-created' })
  }
  let phases = listDevPhases(db, projectUid).filter((p) => p.is_active === 1)
  if (phases.length === 0) {
    saveDevPhase(db, projectUid, { devPhaseId: 'DD', devPhaseName: '詳細設計' })
    phases = listDevPhases(db, projectUid)
  }

  const artifact = artifactTypeId ?? artifacts[0]!.artifact_type_id
  const phase = devPhaseId ?? phases[0]!.dev_phase_id
  if (
    !artifacts.some((a) => a.artifact_type_id === artifact && (a.dev_phase_id === null || a.dev_phase_id === phase))
  ) {
    throw new BackendError(
      'validation',
      `未定義の成果物種別です: ${artifact}`,
      'プロジェクト設定で成果物を定義してください（CORE-012）'
    )
  }
  if (!phases.some((p) => p.dev_phase_id === phase)) {
    throw new BackendError(
      'validation',
      `未定義の開発フェーズです: ${phase}`,
      'プロジェクト設定で開発フェーズを定義してください（CORE-012）'
    )
  }
  return { artifactTypeId: artifact, devPhaseId: phase }
}

export function registerIntermediateApi(router: ApiRouter, jobs: JobManager): void {
  /** ②（承認済み）→③ 統合生成（P7-1） */
  router.register('intermediate.create', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const uids = Array.isArray(p.extractedDocumentUids) ? (p.extractedDocumentUids as string[]) : []
    const resolved = resolveArtifactAndPhase(
      db,
      info.projectUid,
      p.artifactTypeId === undefined ? undefined : String(p.artifactTypeId),
      p.devPhaseId === undefined ? undefined : String(p.devPhaseId)
    )
    return createIntermediateDocument(db, info.projectUid, {
      extractedDocumentUids: uids,
      title: p.title === undefined ? undefined : String(p.title),
      importItems: p.importItems === undefined ? undefined : Boolean(p.importItems),
      ...resolved
    })
  })

  /** Explorer から成果物の統合元②を再設定する（P7-1 / DATA-009）。 */
  router.register('intermediate.updateSources', (params) => {
    const p = asRecord(params)
    const uid = requireString(p, 'uid')
    const extractedDocumentUids = Array.isArray(p.extractedDocumentUids)
      ? p.extractedDocumentUids.map((value) => String(value))
      : []
    const { db, info } = requireProject()
    return updateIntermediateSources(db, info.projectUid, uid, extractedDocumentUids)
  })
  router.register('intermediate.list', (params) => {
    const p = params === undefined ? {} : asRecord(params)
    const includeArchived = p.includeArchived === true
    const { db, info } = requireProject()
    const now = new Date().toISOString()
    db.prepare(
      `WITH ranked AS (
         SELECT d.uid,
                ROW_NUMBER() OVER (
                  PARTITION BY d.dev_phase_id, d.artifact_type_id
                  ORDER BY e.is_archived ASC, d.generated_at DESC, e.code DESC
                ) AS duplicate_rank
           FROM intermediate_document d
           JOIN entity_registry e ON e.uid=d.uid
          WHERE e.project_uid=? AND e.status <> 'deleted'
       )
       UPDATE entity_registry
          SET is_archived=1, updated_by='system', updated_at=?
        WHERE uid IN (SELECT uid FROM ranked WHERE duplicate_rank > 1)
          AND is_archived=0`
    ).run(info.projectUid, now)
    const documentUids = db
      .prepare(
        `SELECT d.uid FROM intermediate_document d JOIN entity_registry e ON e.uid=d.uid
          WHERE e.project_uid=? AND e.status <> 'deleted'`
      )
      .all(info.projectUid) as { uid: string }[]
    for (const document of documentUids) syncIntermediateDocumentStatus(db, document.uid)
    const rows = db
      .prepare(
        `SELECT e.uid, e.code, e.title, e.is_archived,
                CASE WHEN NOT EXISTS (SELECT 1 FROM intermediate_item ai WHERE ai.intermediate_document_uid=d.uid AND ai.uid IN (SELECT uid FROM entity_registry WHERE status <> 'deleted')) OR EXISTS (SELECT 1 FROM intermediate_item ai JOIN entity_registry ar ON ar.uid=ai.uid WHERE ai.intermediate_document_uid=d.uid AND ar.status NOT IN ('approved','deleted')) THEN 'draft' ELSE 'approved' END AS status,
                d.artifact_type_id, d.dev_phase_id, d.intermediate_status, d.generated_at, d.structure_json,
                (SELECT COUNT(*) FROM intermediate_item i WHERE i.intermediate_document_uid = d.uid) AS item_count,
                (SELECT COUNT(*) FROM intermediate_item i JOIN entity_registry ir ON ir.uid = i.uid
                  WHERE i.intermediate_document_uid = d.uid AND ir.status NOT IN ('approved', 'deleted')) AS unconfirmed_count
           FROM intermediate_document d JOIN entity_registry e ON e.uid = d.uid
          WHERE e.project_uid = ? AND e.status <> 'deleted' AND (? = 1 OR e.is_archived = 0)
          ORDER BY d.generated_at DESC`
      )
      .all(info.projectUid, includeArchived ? 1 : 0) as Array<Record<string, unknown> & { structure_json: string }>
    return rows.map(({ structure_json, ...row }) => ({
      ...row,
      sources: (JSON.parse(structure_json) as IntermediateStructure).sources
    }))
  })

  router.register('intermediate.setArchived', (params) => {
    const p = asRecord(params)
    const uid = requireString(p, 'uid')
    const archived = p.archived === true
    const { db, info } = requireProject()
    const target = db
      .prepare(
        `SELECT d.dev_phase_id, d.artifact_type_id
           FROM intermediate_document d JOIN entity_registry e ON e.uid=d.uid
          WHERE d.uid=? AND e.project_uid=? AND e.status <> 'deleted'`
      )
      .get(uid, info.projectUid) as { dev_phase_id: string; artifact_type_id: string } | undefined
    if (!target) throw new BackendError('not_found', '中間データが見つかりません', '')
    const now = new Date().toISOString()
    db.transaction(() => {
      if (!archived) {
        db.prepare(
          `UPDATE entity_registry SET is_archived=1, updated_by='user', updated_at=?
            WHERE uid IN (
              SELECT d.uid FROM intermediate_document d JOIN entity_registry e ON e.uid=d.uid
               WHERE e.project_uid=? AND e.status <> 'deleted'
                 AND d.dev_phase_id=? AND d.artifact_type_id=? AND d.uid<>?
            )`
        ).run(now, info.projectUid, target.dev_phase_id, target.artifact_type_id, uid)
      }
      db.prepare(
        `UPDATE entity_registry SET is_archived=?, updated_by='user', updated_at=?
          WHERE uid=? AND project_uid=? AND entity_type='intermediate_document' AND status <> 'deleted'`
      ).run(archived ? 1 : 0, now, uid, info.projectUid)
    })()
    eventBus.emit('intermediate.updated', { kind: 'archived' })
    return { archived }
  })
  router.register('intermediate.delete', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const result = db
      .prepare(
        `UPDATE entity_registry SET status='deleted', is_archived=0, updated_by='user', updated_at=?
          WHERE uid=? AND project_uid=? AND entity_type='intermediate_document' AND status <> 'deleted'`
      )
      .run(new Date().toISOString(), requireString(p, 'uid'), info.projectUid)
    if (result.changes === 0) throw new BackendError('not_found', '中間データが見つかりません', '')
    eventBus.emit('intermediate.updated', { kind: 'deleted' })
    return { deleted: true }
  })
  router.register('intermediate.get', (params) => {
    const p = asRecord(params)
    const uid = requireString(p, 'uid')
    const { db, info } = requireProject()
    ensureIntermediateItemTraceLinks(db, info.projectUid, uid)
    syncIntermediateDocumentStatus(db, uid)
    const doc = db
      .prepare(
        `SELECT e.uid, e.code, e.title, e.is_archived,
                CASE WHEN NOT EXISTS (SELECT 1 FROM intermediate_item ai WHERE ai.intermediate_document_uid=d.uid AND ai.uid IN (SELECT uid FROM entity_registry WHERE status <> 'deleted')) OR EXISTS (SELECT 1 FROM intermediate_item ai JOIN entity_registry ar ON ar.uid=ai.uid WHERE ai.intermediate_document_uid=d.uid AND ar.status NOT IN ('approved','deleted')) THEN 'draft' ELSE 'approved' END AS status,
                d.artifact_type_id, d.dev_phase_id, d.intermediate_status, d.structure_json,
                (SELECT a.artifact_name FROM project_artifact_setting a
                  WHERE a.project_uid=e.project_uid AND a.artifact_type_id=d.artifact_type_id
                    AND a.dev_phase_id=d.dev_phase_id LIMIT 1) AS artifact_name
           FROM intermediate_document d JOIN entity_registry e ON e.uid = d.uid WHERE d.uid = ?`
      )
      .get(uid) as { structure_json: string } | undefined
    if (!doc) {
      throw new BackendError('not_found', `中間文書が見つかりません: ${uid}`, '')
    }
    const structure = JSON.parse(doc.structure_json) as IntermediateStructure
    const itemRows = db
      .prepare(
        `SELECT i.resource_uid, i.uid, i.item_type, e.status FROM intermediate_item i JOIN entity_registry e ON e.uid = i.uid
          WHERE i.intermediate_document_uid = ?`
      )
      .all(uid) as { resource_uid: string; uid: string; status: string; item_type: string }[]
    const itemByUid = new Map(itemRows.map((row) => [row.uid, row]))
    const itemByResource = new Map(itemRows.map((row) => [row.resource_uid, row]))
    const sourceResourcesByItem = new Map<string, string[]>()
    const sourceItemsByItem = new Map<string, string[]>()
    const itemLinks = db
      .prepare(
        `SELECT i.uid AS intermediate_item_uid, x.uid AS source_extracted_item_uid, x.resource_uid AS source_resource_uid FROM intermediate_item i JOIN trace_link t ON t.from_uid=i.uid AND t.relation_type='based_on' JOIN extracted_item x ON x.uid=t.to_uid WHERE i.intermediate_document_uid=?`
      )
      .all(uid) as {
      intermediate_item_uid: string
      source_extracted_item_uid: string
      source_resource_uid: string
    }[]
    for (const link of itemLinks) {
      sourceResourcesByItem.set(link.intermediate_item_uid, [
        ...(sourceResourcesByItem.get(link.intermediate_item_uid) ?? []),
        link.source_resource_uid
      ])
      sourceItemsByItem.set(link.intermediate_item_uid, [
        ...(sourceItemsByItem.get(link.intermediate_item_uid) ?? []),
        link.source_extracted_item_uid
      ])
    }
    return {
      ...doc,
      structure_json: undefined,
      structure,
      metadata: structure.metadata,
      sources: structure.sources,
      elements: structure.elements.map((element) => {
        const item = element.intermediate_item_uid
          ? itemByUid.get(element.intermediate_item_uid)
          : element.resource_uid
            ? itemByResource.get(element.resource_uid)
            : undefined
        return {
          ...element,
          intermediate_item_uid: item?.uid,
          item_type: item?.item_type,
          review: { status: item?.status ?? 'draft' },
          source_resource_uids: item ? [...new Set(sourceResourcesByItem.get(item.uid) ?? [])] : [],
          source_extracted_item_uids: item ? [...new Set(sourceItemsByItem.get(item.uid) ?? [])] : []
        }
      })
    }
  })
  router.register('intermediate.getSourceItems', (params) => {
    const p = asRecord(params)
    const uid = requireString(p, 'uid')
    const { db, info } = requireProject()
    ensureIntermediateItemTraceLinks(db, info.projectUid, uid)
    syncIntermediateDocumentStatus(db, uid)
    const row = db.prepare(`SELECT structure_json FROM intermediate_document WHERE uid = ?`).get(uid) as
      { structure_json: string } | undefined
    if (!row) throw new BackendError('not_found', `中間文書が見つかりません: ${uid}`, '')
    const structure = JSON.parse(row.structure_json) as IntermediateStructure
    return structure.sources.flatMap((source) => {
      const extracted = db
        .prepare(
          `SELECT e.title, x.structure_json FROM extracted_document x JOIN entity_registry e ON e.uid=x.uid WHERE x.uid=?`
        )
        .get(source.extracted_document_uid) as { title: string | null; structure_json: string } | undefined
      if (!extracted) return []
      const parsed = JSON.parse(extracted.structure_json) as { elements: IntermediateStructure['elements'] }
      return parsed.elements.map((element) => {
        const item = element.resource_uid
          ? (db
              .prepare(
                `SELECT i.uid, i.item_type, e.status FROM extracted_item i JOIN entity_registry e ON e.uid=i.uid WHERE i.extracted_document_uid=? AND i.resource_uid=?`
              )
              .get(source.extracted_document_uid, element.resource_uid) as
              { uid: string; item_type: string; status: string } | undefined)
          : undefined
        return {
          ...element,
          id: `${source.extracted_document_uid}:${element.id}`,
          source_element_id: element.id,
          extracted_item_uid: item?.uid,
          item_type: item?.item_type,
          review: { status: item?.status ?? 'draft' },
          source_document_uid: source.extracted_document_uid,
          source_title: extracted.title
        }
      })
    })
  })

  router.register('intermediate.insertExtractedItems', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return insertExtractedItems(
      db,
      info.projectUid,
      requireString(p, 'uid'),
      Array.isArray(p.extractedItemUids) ? (p.extractedItemUids as string[]) : [],
      p.targetElementId === undefined ? undefined : String(p.targetElementId),
      p.position === 'above' ? 'above' : 'below'
    )
  })
  router.register('intermediate.unlinkExtractedItems', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    return unlinkExtractedItems(
      db,
      requireString(p, 'uid'),
      Array.isArray(p.extractedItemUids) ? p.extractedItemUids.map(String) : []
    )
  })
  router.register('intermediate.deleteItems', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    return deleteIntermediateItems(
      db,
      requireString(p, 'uid'),
      Array.isArray(p.elementIds) ? (p.elementIds as string[]) : []
    )
  })
  router.register('intermediate.reorderItems', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    reorderIntermediateItems(
      db,
      requireString(p, 'uid'),
      Array.isArray(p.elementIds) ? (p.elementIds as string[]) : [],
      p.direction === 'up' ? 'up' : 'down'
    )
    return { updated: true }
  })
  router.register('intermediate.changeHierarchy', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    changeIntermediateHierarchy(
      db,
      requireString(p, 'uid'),
      Array.isArray(p.elementIds) ? (p.elementIds as string[]) : [],
      Number(p.delta)
    )
    return { updated: true }
  })
  router.register('intermediate.updateItemStatuses', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    return {
      updated: updateIntermediateItemStatuses(
        db,
        requireString(p, 'uid'),
        Array.isArray(p.elementIds) ? (p.elementIds as string[]) : [],
        requireString(p, 'status')
      )
    }
  })

  router.register('intermediate.getMarkdown', (params) => {
    const p = asRecord(params)
    const uid = requireString(p, 'uid')
    const variant = (p.variant === 'clean' ? 'clean' : 'review') as MarkdownVariant
    const { db } = requireProject()
    const doc = db.prepare(`SELECT structure_json FROM intermediate_document WHERE uid = ?`).get(uid) as
      { structure_json: string } | undefined
    if (!doc) {
      throw new BackendError('not_found', `中間文書が見つかりません: ${uid}`, '')
    }
    const structure = JSON.parse(doc.structure_json) as IntermediateStructure
    return { markdown: generateMarkdown(structure.elements, variant), variant }
  })

  // ---- P7-2: 編集・マージ・分割 ----

  router.register('intermediate.addElement', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return addIntermediateElement(db, info.projectUid, requireString(p, 'uid'), {
      targetElementId: p.targetElementId === undefined ? undefined : String(p.targetElementId),
      position: p.position === 'above' ? 'above' : 'below',
      type: requireString(p, 'type'),
      text: requireString(p, 'text')
    })
  })

  router.register('intermediate.duplicateElement', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return duplicateIntermediateElement(db, info.projectUid, requireString(p, 'uid'), requireString(p, 'elementId'))
  })

  router.register('intermediate.editElement', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return editIntermediateElement(db, info.projectUid, requireString(p, 'uid'), requireString(p, 'elementId'), {
      type: requireString(p, 'type'),
      text: requireString(p, 'text')
    })
  })
  router.register('intermediate.editElementText', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return editElementText(
      db,
      info.projectUid,
      requireString(p, 'uid'),
      requireString(p, 'elementId'),
      requireString(p, 'newText')
    )
  })

  router.register('intermediate.mergeElements', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const ids = Array.isArray(p.elementIds) ? (p.elementIds as string[]) : []
    if (ids.length < 2) {
      throw new BackendError('validation', 'マージ対象は 2 要素以上を指定してください', '')
    }
    return mergeElements(db, info.projectUid, requireString(p, 'uid'), ids.map(String))
  })

  router.register('intermediate.splitElement', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const texts = Array.isArray(p.texts) ? (p.texts as string[]) : []
    if (texts.length !== 2) {
      throw new BackendError('validation', '分割後の 2 本文を指定してください', '')
    }
    return splitElement(db, info.projectUid, requireString(p, 'uid'), requireString(p, 'elementId'), [
      texts[0]!,
      texts[1]!
    ])
  })

  /** ③正本確定（intermediate.updated 発行） */
  router.register('intermediate.approve', (params) => {
    const p = asRecord(params)
    const uid = requireString(p, 'uid')
    const { db } = requireProject()
    const ts = new Date().toISOString()
    const txn = db.transaction(() => {
      const doc = db
        .prepare(`UPDATE entity_registry SET status = 'approved', updated_by = 'user', updated_at = ? WHERE uid = ?`)
        .run(ts, uid)
      if (doc.changes === 0) {
        throw new BackendError('not_found', `中間文書が見つかりません: ${uid}`, '')
      }
      db.prepare(`UPDATE intermediate_document SET intermediate_status = 'ready' WHERE uid = ?`).run(uid)
      return db
        .prepare(
          `UPDATE entity_registry SET status = 'approved', updated_by = 'user', updated_at = ?
            WHERE status <> 'deleted'
              AND uid IN (SELECT uid FROM intermediate_item WHERE intermediate_document_uid = ?)`
        )
        .run(ts, uid).changes
    })
    const approvedCount = txn()
    eventBus.emit('intermediate.updated', { intermediateDocumentUid: uid, kind: 'approved', approvedCount })
    return { approved: true, approvedCount }
  })

  // ---- P7-5: チャンク（MID-030〜034） ----

  router.register('chunk.create', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return createChunk(
      db,
      info.projectUid,
      requireString(p, 'intermediateDocumentUid'),
      Array.isArray(p.elementIds) ? (p.elementIds as string[]) : [],
      p.promptTemplateUid === undefined ? undefined : String(p.promptTemplateUid),
      p.additionalPrompt === undefined ? '' : String(p.additionalPrompt)
    )
  })

  router.register('chunk.list', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    return listChunks(db, requireString(p, 'intermediateDocumentUid'))
  })

  router.register('chunk.get', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    return getChunk(db, requireString(p, 'uid'))
  })

  router.register('chunk.update', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    updateChunk(
      db,
      info.projectUid,
      requireString(p, 'uid'),
      Array.isArray(p.intermediateItemUids) ? p.intermediateItemUids.map(String) : [],
      p.additionalPrompt === undefined ? '' : String(p.additionalPrompt)
    )
    return { updated: true }
  })
  router.register('chunk.reorder', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    reorderChunks(
      db,
      requireString(p, 'intermediateDocumentUid'),
      Array.isArray(p.chunkUids) ? p.chunkUids.map(String) : []
    )
    return { reordered: true }
  })
  router.register('chunk.getText', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    return { text: getChunkText(db, requireString(p, 'uid')) }
  })

  router.register('chunk.delete', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    deleteChunk(db, requireString(p, 'uid'))
    return { deleted: true }
  })

  // ---- P7-4/P7-6: LLM 候補（正規化テキスト・図表説明） ----

  /**
   * テキスト候補生成ジョブを開始する（purpose: normalize=正規化 / describe=図表説明）。
   * LLM 出力は候補であり、採用（adoptTextCandidate）まで③正本を変更しない（MID-013/026）。
   */
  router.register('intermediate.generateTextCandidate', (params) => {
    const p = asRecord(params)
    requireProject()
    const purpose = p.purpose === 'describe' ? 'describe' : 'normalize'
    return jobs.enqueue('intermediate.textCandidate', {
      uid: requireString(p, 'uid'),
      elementId: requireString(p, 'elementId'),
      purpose
    })
  })

  /** 候補の採用: 新リソース + basis_kind=normalized + llm_run 参照で③へ反映（MID-014/027） */
  router.register('intermediate.adoptTextCandidate', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return editElementText(
      db,
      info.projectUid,
      requireString(p, 'uid'),
      requireString(p, 'elementId'),
      requireString(p, 'newText'),
      { llmRunUid: requireString(p, 'llmRunUid') }
    )
  })
}
