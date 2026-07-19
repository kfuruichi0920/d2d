/**
 * ③中間データ処理（P7、MID-001〜005、sdd_data_structure §2.11）。
 *
 * - プロジェクト設定の成果物単位に intermediate_document を生成し、②抽出文書を任意に統合元登録する
 * - ③の要素は intermediate_item として resource_* を参照する（②とリソースを共有）
 * - 編集・マージ・分割は新リソース（新 uid/code）を作り、based_on + transform_note で
 *   元 ID を追跡する（MID-005、EXT-014/015）
 * - ③→② の根拠関係は structure_json.sources と based_on trace_link で同期する
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { eventBus } from '../events/event-bus'
import { registerEntity } from '../store/entity-registry'
import type { ExtractionElement } from '../extract/store-extraction'
import { createMergedResource, getResource } from '../resource/resource-service'

export interface IntermediateElement extends ExtractionElement {
  resource_uid?: string
  intermediate_item_uid?: string
}

export interface IntermediateStructure {
  metadata: {
    title: string
    artifact_type_id: string
    dev_phase_id: string
  }
  /** 統合対象の②抽出文書群と統合順序（DATA-009） */
  sources: { extracted_document_uid: string; order: number }[]
  elements: IntermediateElement[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function loadStructure(db: Database, uid: string): IntermediateStructure {
  const row = db.prepare(`SELECT structure_json FROM intermediate_document WHERE uid = ?`).get(uid) as
    { structure_json: string } | undefined
  if (!row) {
    throw new BackendError('not_found', `中間文書が見つかりません: ${uid}`, '')
  }
  return JSON.parse(row.structure_json) as IntermediateStructure
}

function saveStructure(db: Database, uid: string, structure: IntermediateStructure): void {
  db.prepare(`UPDATE intermediate_document SET structure_json = ? WHERE uid = ?`).run(JSON.stringify(structure), uid)
  db.prepare(`UPDATE entity_registry SET updated_at = ?, updated_by = 'user' WHERE uid = ?`).run(nowIso(), uid)
}

/** element.type → item_type（store-extraction と同じ写像） */
function itemTypeOf(
  element: IntermediateElement
): 'resource_label' | 'resource_list' | 'resource_table' | 'resource_figure' | 'resource_text' {
  switch (element.type) {
    case 'heading':
    case 'caption':
      return 'resource_label'
    case 'list_item':
      return 'resource_list'
    case 'table':
      return 'resource_table'
    case 'figure':
      return 'resource_figure'
    default:
      return 'resource_text'
  }
}

function addIntermediateItem(
  db: Database,
  projectUid: string,
  docUid: string,
  element: IntermediateElement,
  itemType?: string
): string {
  const item = registerEntity(db, { projectUid, entityType: 'intermediate_item', createdBy: 'user' })
  db.prepare(
    `INSERT INTO intermediate_item (uid, intermediate_document_uid, item_type, resource_uid) VALUES (?, ?, ?, ?)`
  ).run(item.uid, docUid, itemType ?? itemTypeOf(element), element.resource_uid)
  element.intermediate_item_uid = item.uid
  return item.uid
}

/** intermediate_item → extracted_item のアイテム単位 based_on を正本として登録する。 */
function addItemBasedOnLinks(
  db: Database,
  projectUid: string,
  intermediateItemUid: string,
  extractedItemUids: string[]
): void {
  const insert = db.prepare(
    `INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, basis_kind, created_by, review_status) VALUES (?, ?, ?, 'based_on', 'extracted', 'rule', 'approved')`
  )
  for (const extractedItemUid of [...new Set(extractedItemUids)]) {
    const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'rule' })
    insert.run(link.uid, intermediateItemUid, extractedItemUid)
  }
}

function extractedItemUidsForResource(db: Database, resourceUid: string): string[] {
  return (
    db.prepare(`SELECT uid FROM extracted_item WHERE resource_uid = ?`).all(resourceUid) as { uid: string }[]
  ).map((row) => row.uid)
}

/** 編集前の intermediate_item に張られたアイテム由来を退避する。 */
function sourceExtractedItemUids(db: Database, docUid: string, resourceUids: string[]): string[] {
  if (resourceUids.length === 0) return []
  return (
    db
      .prepare(
        `SELECT DISTINCT t.to_uid AS uid FROM intermediate_item i JOIN trace_link t ON t.from_uid=i.uid AND t.relation_type='based_on' JOIN extracted_item x ON x.uid=t.to_uid WHERE i.intermediate_document_uid=? AND i.resource_uid IN (${resourceUids.map(() => '?').join(',')})`
      )
      .all(docUid, ...resourceUids) as { uid: string }[]
  ).map((row) => row.uid)
}

/** intermediate_item（対応行）を物理削除する。リソース本体と②の対応は残る。 */
function removeIntermediateItems(db: Database, docUid: string, elements: IntermediateElement[]): void {
  const directItemUids = elements
    .map((element) => element.intermediate_item_uid)
    .filter((itemUid): itemUid is string => Boolean(itemUid))
  const legacyResourceUids = elements
    .filter((element) => !element.intermediate_item_uid)
    .map((element) => element.resource_uid)
    .filter((resourceUid): resourceUid is string => Boolean(resourceUid))
  const fallbackItemUids =
    legacyResourceUids.length === 0
      ? []
      : (
          db
            .prepare(
              `SELECT uid FROM intermediate_item WHERE intermediate_document_uid = ? AND resource_uid IN (${legacyResourceUids.map(() => '?').join(',')})`
            )
            .all(docUid, ...legacyResourceUids) as { uid: string }[]
        ).map((row) => row.uid)
  const remove = db.prepare(`DELETE FROM entity_registry WHERE uid = ?`)
  for (const itemUid of [...new Set([...directItemUids, ...fallbackItemUids])]) remove.run(itemUid)
}
/** 由来リンク: 新リソース → 元リソース（EXT-015。マージ・分割・編集の元 ID 追跡） */
function addDerivationLink(
  db: Database,
  projectUid: string,
  fromUid: string,
  toUid: string,
  basisKind: 'human_approved' | 'normalized',
  transformNote: string,
  llmRunUid?: string
): void {
  const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: llmRunUid ? 'llm' : 'human' })
  db.prepare(
    `INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, basis_kind, transform_note, created_by, review_status, llm_run_uid)
     VALUES (?, ?, ?, 'based_on', ?, ?, ?, 'approved', ?)`
  ).run(link.uid, fromUid, toUid, basisKind, transformNote, llmRunUid ? 'llm' : 'human', llmRunUid ?? null)
}

/** 既存③データへアイテム単位 based_on を補完する（resource由来リンクを再帰探索）。 */
export function ensureIntermediateItemTraceLinks(db: Database, projectUid: string, docUid: string): number {
  const structure = loadStructure(db, docUid)
  const exactItemUids = new Set(
    structure.elements
      .map((element) => element.intermediate_item_uid)
      .filter((itemUid): itemUid is string => Boolean(itemUid))
  )
  const items = (
    db
      .prepare(
        `SELECT i.uid,i.resource_uid FROM intermediate_item i WHERE i.intermediate_document_uid=? AND NOT EXISTS (SELECT 1 FROM trace_link t JOIN extracted_item x ON x.uid=t.to_uid WHERE t.from_uid=i.uid AND t.relation_type='based_on')`
      )
      .all(docUid) as { uid: string; resource_uid: string }[]
  ).filter((item) => !exactItemUids.has(item.uid))
  let added = 0
  for (const item of items) {
    const sources = db
      .prepare(
        `WITH RECURSIVE ancestry(uid) AS (SELECT ? UNION SELECT t.to_uid FROM trace_link t JOIN ancestry a ON t.from_uid=a.uid WHERE t.relation_type='based_on') SELECT DISTINCT x.uid FROM ancestry a JOIN extracted_item x ON x.resource_uid=a.uid`
      )
      .all(item.resource_uid) as { uid: string }[]
    addItemBasedOnLinks(
      db,
      projectUid,
      item.uid,
      sources.map((source) => source.uid)
    )
    added += sources.length
  }
  return added
}

// ---- P7-1: 統合生成 ----

export interface CreateIntermediateInput {
  extractedDocumentUids: string[]
  title?: string
  artifactTypeId: string
  devPhaseId: string
  /** false の場合は統合元だけを登録し、要素は編集画面から明示的に統合する */
  importItems?: boolean
}

export interface CreateIntermediateResult {
  intermediateDocumentUid: string
  code: string
  elementCount: number
  sourceCount: number
}

export interface EnsureIntermediateInput {
  title: string
  artifactTypeId: string
  devPhaseId: string
}

/** 設定済み成果物に対応する③を返し、未作成なら統合元なしの空③を作成する（P7-1、MID-001）。 */
export function ensureIntermediateDocument(
  db: Database,
  projectUid: string,
  input: EnsureIntermediateInput
): CreateIntermediateResult & { created: boolean } {
  const existing = db
    .prepare(
      `SELECT d.uid, e.code,
              (SELECT COUNT(*) FROM intermediate_item i WHERE i.intermediate_document_uid=d.uid) AS element_count,
              d.structure_json
         FROM intermediate_document d JOIN entity_registry e ON e.uid=d.uid
        WHERE e.project_uid=? AND e.status<>'deleted' AND e.is_archived=0
          AND d.artifact_type_id=? AND d.dev_phase_id=?
        ORDER BY d.generated_at DESC, e.code DESC LIMIT 1`
    )
    .get(projectUid, input.artifactTypeId, input.devPhaseId) as
    { uid: string; code: string; element_count: number; structure_json: string } | undefined
  if (existing) {
    const structure = JSON.parse(existing.structure_json) as IntermediateStructure
    return {
      intermediateDocumentUid: existing.uid,
      code: existing.code,
      elementCount: existing.element_count,
      sourceCount: structure.sources.length,
      created: false
    }
  }
  return {
    ...createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [],
      title: input.title,
      artifactTypeId: input.artifactTypeId,
      devPhaseId: input.devPhaseId,
      importItems: false
    }),
    created: true
  }
}

export function createIntermediateDocument(
  db: Database,
  projectUid: string,
  input: CreateIntermediateInput
): CreateIntermediateResult {
  const txn = db.transaction((): CreateIntermediateResult => {
    // 統合元はレビュー状態を問わず登録し、各要素の状態を取込編集画面へ引き継ぐ。
    const sources: { uid: string; title: string | null; structure: { elements: IntermediateElement[] } }[] = []
    for (const uid of input.extractedDocumentUids) {
      const row = db
        .prepare(
          `SELECT e.status, e.title, x.structure_json FROM extracted_document x JOIN entity_registry e ON e.uid = x.uid WHERE x.uid = ?`
        )
        .get(uid) as { status: string; title: string | null; structure_json: string } | undefined
      if (!row) {
        throw new BackendError('not_found', `②抽出文書が見つかりません: ${uid}`, '')
      }
      sources.push({ uid, title: row.title, structure: JSON.parse(row.structure_json) })
    }

    const title = input.title ?? `統合設計書: ${sources.map((s) => s.title ?? '').join(', ')}`.slice(0, 120)
    const doc = registerEntity(db, {
      projectUid,
      entityType: 'intermediate_document',
      title,
      createdBy: 'user'
    })

    // ③要素: ②の要素を統合順に取り込み、新しい要素 ID（i1..）を付与する。
    // リソースは②と共有し（正規化）、編集時に初めて新リソースを作る（MID-005）
    const elements: IntermediateElement[] = []
    let seq = 0
    for (const source of input.importItems === false ? [] : sources) {
      for (const element of source.structure.elements) {
        if (!element.resource_uid) continue
        elements.push({ ...element, id: `i${++seq}` })
      }
    }

    const structure: IntermediateStructure = {
      metadata: { title, artifact_type_id: input.artifactTypeId, dev_phase_id: input.devPhaseId },
      sources: sources.map((s, i) => ({ extracted_document_uid: s.uid, order: i + 1 })),
      elements
    }

    db.prepare(
      `INSERT INTO intermediate_document
         (uid, source_extracted_document_uid, artifact_type_id, dev_phase_id, intermediate_status, processor_name, processor_version, structure_json)
       VALUES (?, ?, ?, ?, 'draft', 'd2d-composer', '0.1.0', ?)`
    ).run(doc.uid, null, input.artifactTypeId, input.devPhaseId, JSON.stringify(structure))

    for (const element of elements) {
      const itemUid = addIntermediateItem(db, projectUid, doc.uid, element)
      if (element.resource_uid)
        addItemBasedOnLinks(db, projectUid, itemUid, extractedItemUidsForResource(db, element.resource_uid))
    }
    saveStructure(db, doc.uid, structure)

    // ③→② の根拠リンクを sources と同期して自動生成する（§2.11）
    for (const source of sources) {
      const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'rule' })
      db.prepare(
        `INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, basis_kind, created_by, review_status)
         VALUES (?, ?, ?, 'based_on', 'extracted', 'rule', 'approved')`
      ).run(link.uid, doc.uid, source.uid)
    }

    return {
      intermediateDocumentUid: doc.uid,
      code: doc.code,
      elementCount: elements.length,
      sourceCount: sources.length
    }
  })

  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: result.intermediateDocumentUid, kind: 'created' })
  return result
}

/** Explorer の成果物取込で、統合対象②と文書単位 based_on を同期する（P7-1 / DATA-009 / NFR-010）。 */
export function updateIntermediateSources(
  db: Database,
  projectUid: string,
  docUid: string,
  extractedDocumentUids: string[]
): { sourceCount: number } {
  const sourceUids = [...new Set(extractedDocumentUids)]

  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    for (const uid of sourceUids) {
      const source = db
        .prepare(`SELECT status FROM entity_registry WHERE uid=? AND entity_type='extracted_document'`)
        .get(uid) as { status: string } | undefined
      if (!source) throw new BackendError('not_found', `②抽出文書が見つかりません: ${uid}`, '')
    }

    const removed = structure.sources
      .map((source) => source.extracted_document_uid)
      .filter((uid) => !sourceUids.includes(uid))
    for (const uid of removed) {
      const used = db
        .prepare(
          `SELECT 1 FROM intermediate_item i
             JOIN trace_link t ON t.from_uid=i.uid AND t.relation_type='based_on'
             JOIN extracted_item x ON x.uid=t.to_uid
            WHERE i.intermediate_document_uid=? AND x.extracted_document_uid=? LIMIT 1`
        )
        .get(docUid, uid)
      if (used) {
        throw new BackendError(
          'validation',
          '成果物へ統合済みの②抽出データは取込元から外せません',
          '対応する成果物要素を削除してから取込元を変更してください。'
        )
      }
    }

    const oldLinks = db
      .prepare(
        `SELECT t.uid FROM trace_link t JOIN extracted_document x ON x.uid=t.to_uid
          WHERE t.from_uid=? AND t.relation_type='based_on' AND t.basis_kind='extracted'`
      )
      .all(docUid) as { uid: string }[]
    for (const link of oldLinks) db.prepare(`DELETE FROM entity_registry WHERE uid=?`).run(link.uid)

    structure.sources = sourceUids.map((uid, index) => ({ extracted_document_uid: uid, order: index + 1 }))
    saveStructure(db, docUid, structure)
    for (const uid of sourceUids) {
      const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'rule' })
      db.prepare(
        `INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, basis_kind, created_by, review_status)
         VALUES (?, ?, ?, 'based_on', 'extracted', 'rule', 'approved')`
      ).run(link.uid, docUid, uid)
    }
    return { sourceCount: sourceUids.length }
  })

  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'sources-updated' })
  return result
}
/** 選択した②要素を、指定した③要素の前後へ統合する。文書 based_on は作成時に管理済み。 */
export function insertExtractedItems(
  db: Database,
  projectUid: string,
  docUid: string,
  extractedItemUids: string[],
  targetElementId: string | undefined,
  position: 'above' | 'below'
): { inserted: number } {
  const uniqueUids = [...new Set(extractedItemUids)]
  if (uniqueUids.length === 0) throw new BackendError('validation', '統合する抽出要素を選択してください', '')
  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    const sourceByItemUid = new Map<string, IntermediateElement>()
    for (const source of structure.sources) {
      const row = db
        .prepare(`SELECT structure_json FROM extracted_document WHERE uid = ?`)
        .get(source.extracted_document_uid) as { structure_json: string } | undefined
      if (!row) continue
      const elements = (JSON.parse(row.structure_json) as { elements: IntermediateElement[] }).elements
      const byResource = new Map(elements.filter((e) => e.resource_uid).map((e) => [e.resource_uid!, e]))
      const items = db
        .prepare(`SELECT uid, resource_uid FROM extracted_item WHERE extracted_document_uid = ?`)
        .all(source.extracted_document_uid) as { uid: string; resource_uid: string }[]
      for (const item of items) {
        const element = byResource.get(item.resource_uid)
        if (element) sourceByItemUid.set(item.uid, element)
      }
    }
    const selected = uniqueUids
      .map((itemUid) => ({ itemUid, element: sourceByItemUid.get(itemUid) }))
      .filter((entry): entry is { itemUid: string; element: IntermediateElement } => Boolean(entry.element))
    if (selected.length !== uniqueUids.length)
      throw new BackendError('validation', '選択要素は登録済み統合元に含まれていません', '')
    const target = targetElementId ? structure.elements.findIndex((e) => e.id === targetElementId) : -1
    if (targetElementId && target < 0)
      throw new BackendError('not_found', `統合位置が見つかりません: ${targetElementId}`, '')
    let seq = structure.elements.reduce((max, e) => Math.max(max, Number(e.id.replace(/\D/g, '')) || 0), 0)
    const inserted = selected.map(({ element }) => ({ ...element, id: `i${++seq}` }))
    const insertAt = targetElementId
      ? target + (position === 'below' ? 1 : 0)
      : position === 'above'
        ? 0
        : structure.elements.length
    structure.elements.splice(insertAt, 0, ...inserted)
    inserted.forEach((element, index) => {
      const itemUid = addIntermediateItem(db, projectUid, docUid, element)
      addItemBasedOnLinks(db, projectUid, itemUid, [selected[index]!.itemUid])
    })
    saveStructure(db, docUid, structure)
    return { inserted: inserted.length }
  })
  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'items-inserted' })
  return result
}

/** 選択した統合元 extracted_item へのアイテム単位 based_on を成果物全体から解除する。 */
export function unlinkExtractedItems(db: Database, docUid: string, extractedItemUids: string[]): { unlinked: number } {
  const uniqueUids = [...new Set(extractedItemUids)]
  if (uniqueUids.length === 0) throw new BackendError('validation', '成果物対応を削除する統合元を選択してください', '')
  const placeholders = uniqueUids.map(() => '?').join(',')
  const txn = db.transaction(() => {
    const links = db
      .prepare(
        `SELECT t.uid FROM trace_link t
          JOIN intermediate_item i ON i.uid=t.from_uid
         WHERE i.intermediate_document_uid=?
           AND t.relation_type='based_on'
           AND t.basis_kind='extracted'
           AND t.to_uid IN (${placeholders})`
      )
      .all(docUid, ...uniqueUids) as { uid: string }[]
    const remove = db.prepare(`DELETE FROM entity_registry WHERE uid=?`)
    for (const link of links) remove.run(link.uid)
    return { unlinked: links.length }
  })
  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'items-unlinked' })
  return result
}
export function deleteIntermediateItems(db: Database, docUid: string, elementIds: string[]): { deleted: number } {
  const structure = loadStructure(db, docUid)
  const removed = structure.elements.filter((e) => elementIds.includes(e.id))
  structure.elements = structure.elements.filter((e) => !elementIds.includes(e.id))
  removeIntermediateItems(db, docUid, removed)
  saveStructure(db, docUid, structure)
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'items-deleted' })
  return { deleted: removed.length }
}

export function reorderIntermediateItems(
  db: Database,
  docUid: string,
  elementIds: string[],
  direction: 'up' | 'down'
): void {
  const structure = loadStructure(db, docUid)
  const indexes = elementIds.map((id) => structure.elements.findIndex((e) => e.id === id)).sort((a, b) => a - b)
  if (indexes.some((i) => i < 0) || indexes.some((v, i) => i > 0 && v !== indexes[i - 1]! + 1))
    throw new BackendError(
      'validation',
      '移動は連続した要素だけを選択してください',
      'Ctrlによる歯抜け選択は移動できません'
    )
  const first = indexes[0]!,
    last = indexes[indexes.length - 1]!
  if ((direction === 'up' && first === 0) || (direction === 'down' && last === structure.elements.length - 1)) return
  const block = structure.elements.splice(first, indexes.length)
  structure.elements.splice(direction === 'up' ? first - 1 : first + 1, 0, ...block)
  saveStructure(db, docUid, structure)
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'reordered' })
}

export function changeIntermediateHierarchy(db: Database, docUid: string, elementIds: string[], delta: number): void {
  const structure = loadStructure(db, docUid)
  for (const e of structure.elements) if (elementIds.includes(e.id)) e.level = Math.max(0, (e.level ?? 0) + delta)
  saveStructure(db, docUid, structure)
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'hierarchy-changed' })
}

/** 子要素の状態を正本として中間文書の状態へ集約する（MID-007）。 */
export function syncIntermediateDocumentStatus(db: Database, docUid: string): 'draft' | 'approved' {
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN e.status = 'approved' THEN 0 ELSE 1 END) AS unconfirmed
         FROM intermediate_item i JOIN entity_registry e ON e.uid=i.uid
        WHERE i.intermediate_document_uid=? AND e.status <> 'deleted'`
    )
    .get(docUid) as { total: number; unconfirmed: number | null }
  const status = counts.total > 0 && (counts.unconfirmed ?? 0) === 0 ? 'approved' : 'draft'
  db.prepare(
    `UPDATE entity_registry SET status=?, updated_at=?, updated_by='system'
      WHERE uid=? AND entity_type='intermediate_document' AND status <> 'deleted'`
  ).run(status, nowIso(), docUid)
  db.prepare(`UPDATE intermediate_document SET intermediate_status=? WHERE uid=?`).run(
    status === 'approved' ? 'ready' : 'draft',
    docUid
  )
  return status
}
export function updateIntermediateItemStatuses(
  db: Database,
  docUid: string,
  elementIds: string[],
  status: string
): number {
  if (!['draft', 'approved', 'needs_fix', 'rejected'].includes(status))
    throw new BackendError('validation', '不正なレビュー状態です', '')
  const dbStatus = status === 'needs_fix' ? 'review' : status
  const structure = loadStructure(db, docUid)
  const resources = structure.elements
    .filter((e) => elementIds.includes(e.id))
    .map((e) => e.resource_uid)
    .filter(Boolean)
  if (resources.length === 0) return 0
  const placeholders = resources.map(() => '?').join(',')
  const result = db
    .prepare(
      `UPDATE entity_registry SET status=?, updated_at=?, updated_by='user' WHERE uid IN (SELECT uid FROM intermediate_item WHERE intermediate_document_uid=? AND resource_uid IN (${placeholders}))`
    )
    .run(dbStatus, nowIso(), docUid, ...resources)
  syncIntermediateDocumentStatus(db, docUid)
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'review-status' })
  return result.changes
}

// ---- P7-2: 編集・マージ・分割（新 ID + 由来追跡） ----

interface EditContext {
  db: Database
  projectUid: string
  docUid: string
}

function newTextResource(ctx: EditContext, text: string, titleHint: string, createdBy: string): { uid: string } {
  const resource = registerEntity(ctx.db, {
    projectUid: ctx.projectUid,
    entityType: 'resource_text',
    title: titleHint.slice(0, 80),
    createdBy
  })
  ctx.db
    .prepare(`INSERT INTO resource_text (uid, text_body, text_role, language) VALUES (?, ?, 'body', 'ja')`)
    .run(resource.uid, text)
  return resource
}

const BASIC_EDITABLE_TYPES = ['paragraph', 'heading', 'list_item', 'caption'] as const
export type BasicIntermediateElementType = (typeof BASIC_EDITABLE_TYPES)[number]

function requireBasicElementType(value: string): BasicIntermediateElementType {
  if (!BASIC_EDITABLE_TYPES.includes(value as BasicIntermediateElementType)) {
    throw new BackendError(
      'validation',
      `基本編集に未対応の要素種別です: ${value}`,
      'table / figure 等の種別固有編集項目は個別編集APIを使用してください。'
    )
  }
  return value as BasicIntermediateElementType
}

function nextIntermediateElementId(structure: IntermediateStructure): string {
  const sequence = structure.elements.reduce((max, element) => {
    const value = Number(element.id.match(/^i(\d+)$/)?.[1] ?? 0)
    return Math.max(max, value)
  }, 0)
  return `i${sequence + 1}`
}

function createBasicElementResource(
  db: Database,
  projectUid: string,
  type: BasicIntermediateElementType,
  text: string,
  level?: number
): string {
  const entityType = itemTypeOf({ id: '', type })
  const resource = registerEntity(db, { projectUid, entityType, title: text.slice(0, 80), createdBy: 'user' })
  switch (entityType) {
    case 'resource_label':
      db.prepare(`INSERT INTO resource_label (uid, label_text, label_kind, level) VALUES (?, ?, ?, ?)`).run(
        resource.uid,
        text,
        type === 'heading' ? 'section' : 'other',
        type === 'heading' ? Math.max(1, level ?? 1) : 0
      )
      break
    case 'resource_list':
      db.prepare(
        `INSERT INTO resource_list (uid, list_kind, item_count, items_json, max_level) VALUES (?, 'unordered', 1, ?, 0)`
      ).run(resource.uid, `- ${text}`)
      break
    default:
      db.prepare(`INSERT INTO resource_text (uid, text_body, text_role, language) VALUES (?, ?, 'body', 'ja')`).run(
        resource.uid,
        text
      )
  }
  return resource.uid
}

function cloneElementResource(db: Database, projectUid: string, element: IntermediateElement): string {
  if (!element.resource_uid) throw new BackendError('validation', '複製元にResourceがありません', element.id)
  const entityType = itemTypeOf(element)
  const resource = registerEntity(db, {
    projectUid,
    entityType,
    title: (element.text ?? element.image ?? '複製').slice(0, 80),
    createdBy: 'user'
  })
  let changes = 0
  switch (entityType) {
    case 'resource_label':
      changes = db
        .prepare(
          `INSERT INTO resource_label (uid,label_text,label_kind,numbering,level,style_name,target_resource_uid)
           SELECT ?,label_text,label_kind,numbering,level,style_name,target_resource_uid FROM resource_label WHERE uid=?`
        )
        .run(resource.uid, element.resource_uid).changes
      break
    case 'resource_list':
      changes = db
        .prepare(
          `INSERT INTO resource_list (uid,list_kind,item_count,items_json,max_level)
           SELECT ?,list_kind,item_count,items_json,max_level FROM resource_list WHERE uid=?`
        )
        .run(resource.uid, element.resource_uid).changes
      break
    case 'resource_table':
      changes = db
        .prepare(
          `INSERT INTO resource_table (uid,table_title,row_count,column_count,table_kind,header_rows_json,header_columns_json,cells_json,source_range)
           SELECT ?,table_title,row_count,column_count,table_kind,header_rows_json,header_columns_json,cells_json,source_range FROM resource_table WHERE uid=?`
        )
        .run(resource.uid, element.resource_uid).changes
      break
    case 'resource_figure':
      changes = db
        .prepare(
          `INSERT INTO resource_figure (uid,image_uri,image_hash,figure_kind,width,height,ocr_texts_json,objects_json,caption_uid)
           SELECT ?,image_uri,image_hash,figure_kind,width,height,ocr_texts_json,objects_json,caption_uid FROM resource_figure WHERE uid=?`
        )
        .run(resource.uid, element.resource_uid).changes
      break
    default:
      changes = db
        .prepare(
          `INSERT INTO resource_text (uid,text_body,text_role,language,sentences_json,context_json)
           SELECT ?,text_body,text_role,language,sentences_json,context_json FROM resource_text WHERE uid=?`
        )
        .run(resource.uid, element.resource_uid).changes
  }
  if (changes !== 1) throw new BackendError('internal', `複製元Resourceが見つかりません: ${element.resource_uid}`, '')
  addDerivationLink(db, projectUid, resource.uid, element.resource_uid, 'human_approved', 'duplicate')
  return resource.uid
}

/** 単独編集: 選択要素の前後（空文書は先頭）へ基本要素を追加する（P7-2 / MID-004/005）。 */
export function addIntermediateElement(
  db: Database,
  projectUid: string,
  docUid: string,
  input: { targetElementId?: string; position: 'above' | 'below'; type: string; text: string }
): { elementId: string; resourceUid: string } {
  const type = requireBasicElementType(input.type)
  if (!input.text.trim()) throw new BackendError('validation', '要素のテキストを入力してください', '')
  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    let index = 0
    let sectionPath = ''
    if (structure.elements.length > 0) {
      if (!input.targetElementId) throw new BackendError('validation', '追加位置の基準要素を選択してください', '')
      const targetIndex = structure.elements.findIndex((element) => element.id === input.targetElementId)
      if (targetIndex < 0) throw new BackendError('not_found', `追加位置が見つかりません: ${input.targetElementId}`, '')
      index = targetIndex + (input.position === 'below' ? 1 : 0)
      sectionPath = structure.elements[targetIndex]?.section_path ?? ''
    }
    const elementId = nextIntermediateElementId(structure)
    const level = type === 'heading' ? 1 : 0
    const resourceUid = createBasicElementResource(db, projectUid, type, input.text, level)
    const element: IntermediateElement = {
      id: elementId,
      type,
      text: input.text,
      level,
      section_path: sectionPath,
      resource_uid: resourceUid
    }
    structure.elements.splice(index, 0, element)
    addIntermediateItem(db, projectUid, docUid, element)
    saveStructure(db, docUid, structure)
    return { elementId, resourceUid }
  })
  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'element-added' })
  return result
}

/** 単独編集: 任意要素を直後へ新ID・新Resourceで複製する（P7-2 / MID-004/005）。 */
export function duplicateIntermediateElement(
  db: Database,
  projectUid: string,
  docUid: string,
  elementId: string
): { elementId: string; resourceUid: string } {
  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    const index = structure.elements.findIndex((element) => element.id === elementId)
    const source = structure.elements[index]
    if (!source) throw new BackendError('not_found', `複製元要素が見つかりません: ${elementId}`, '')
    const newElementId = nextIntermediateElementId(structure)
    const resourceUid = cloneElementResource(db, projectUid, source)
    const duplicate: IntermediateElement = { ...source, id: newElementId, resource_uid: resourceUid }
    structure.elements.splice(index + 1, 0, duplicate)
    const itemUid = addIntermediateItem(db, projectUid, docUid, duplicate)
    addItemBasedOnLinks(db, projectUid, itemUid, sourceExtractedItemUids(db, docUid, [source.resource_uid!]))
    saveStructure(db, docUid, structure)
    return { elementId: newElementId, resourceUid }
  })
  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'element-duplicated' })
  return result
}

/** 共通編集: 基本種別・テキストを新Resourceへ置換し、元Resourceと②由来を保持する。 */
export function editIntermediateElement(
  db: Database,
  projectUid: string,
  docUid: string,
  elementId: string,
  input: { type: string; text: string }
): { resourceUid: string } {
  const type = requireBasicElementType(input.type)
  if (!input.text.trim()) throw new BackendError('validation', '要素のテキストを入力してください', '')
  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    const element = structure.elements.find((item) => item.id === elementId)
    if (!element?.resource_uid) throw new BackendError('not_found', `要素が見つかりません: ${elementId}`, '')
    const oldResourceUid = element.resource_uid
    const sources = sourceExtractedItemUids(db, docUid, [oldResourceUid])
    const resourceUid = createBasicElementResource(db, projectUid, type, input.text, element.level)
    addDerivationLink(db, projectUid, resourceUid, oldResourceUid, 'human_approved', 'edit')
    removeIntermediateItems(db, docUid, [element])
    element.type = type
    element.text = input.text
    element.level = type === 'heading' ? Math.max(1, element.level ?? 1) : 0
    element.resource_uid = resourceUid
    delete element.rows
    delete element.image
    const itemUid = addIntermediateItem(db, projectUid, docUid, element)
    addItemBasedOnLinks(db, projectUid, itemUid, sources)
    saveStructure(db, docUid, structure)
    return { resourceUid }
  })
  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'element-edited' })
  return result
}
/** 要素テキストの編集: 新リソースを作成し由来を追跡する（MID-005） */
export function editElementText(
  db: Database,
  projectUid: string,
  docUid: string,
  elementId: string,
  newText: string,
  options?: { llmRunUid?: string }
): { newResourceUid: string } {
  if (!newText.trim()) {
    throw new BackendError('validation', '本文が空です', '')
  }
  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    const element = structure.elements.find((e) => e.id === elementId)
    if (!element || !element.resource_uid) {
      throw new BackendError('not_found', `要素が見つかりません: ${elementId}`, '')
    }
    if (!['paragraph', 'heading', 'list_item', 'caption'].includes(element.type)) {
      throw new BackendError('validation', `テキスト編集できない要素種別です: ${element.type}`, '')
    }
    const oldResourceUid = element.resource_uid
    const ctx: EditContext = { db, projectUid, docUid }
    const created = newTextResource(ctx, newText, newText, options?.llmRunUid ? 'llm' : 'user')

    addDerivationLink(
      db,
      projectUid,
      created.uid,
      oldResourceUid,
      options?.llmRunUid ? 'normalized' : 'human_approved',
      options?.llmRunUid ? 'normalize' : 'edit',
      options?.llmRunUid
    )

    const sourceItemUids = sourceExtractedItemUids(db, docUid, [oldResourceUid])
    removeIntermediateItems(db, docUid, [element])
    // 編集後はテキスト要素（paragraph 系はそのまま、caption/heading もテキスト実体として保持）
    element.text = newText
    element.resource_uid = created.uid
    const newItemUid = addIntermediateItem(db, projectUid, docUid, element)
    addItemBasedOnLinks(db, projectUid, newItemUid, sourceItemUids)
    saveStructure(db, docUid, structure)
    return { newResourceUid: created.uid }
  })
  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'edited' })
  return result
}

/** 複数要素のマージ: 非連続選択を表示順で統合し、先頭位置・階層と全由来を引き継ぐ。 */
export function mergeElements(
  db: Database,
  projectUid: string,
  docUid: string,
  elementIds: string[]
): { newElementId: string; newResourceUid: string; warnings: string[] } {
  const uniqueIds = [...new Set(elementIds)]
  if (uniqueIds.length < 2) throw new BackendError('validation', 'マージ対象を2要素以上指定してください', '')
  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    const indexes = uniqueIds.map((id) => structure.elements.findIndex((element) => element.id === id))
    if (indexes.some((index) => index < 0))
      throw new BackendError('not_found', 'マージ対象の要素が見つかりません', uniqueIds.join(', '))
    const selected = indexes.sort((a, b) => a - b).map((index) => structure.elements[index]!)
    if (selected.some((element) => !element.resource_uid))
      throw new BackendError('validation', 'Resourceを持たない要素はマージできません', '')
    const sourceResources = selected.map((element) => {
      const resource = getResource(db, element.resource_uid!)
      return { uid: resource.uid, type: resource.type, values: resource.values }
    })
    const targetType = sourceResources.every((resource) => resource.type === sourceResources[0]!.type)
      ? sourceResources[0]!.type
      : 'resource_text'
    const created = createMergedResource(db, projectUid, targetType, sourceResources)
    const resourceUids = selected.map((element) => element.resource_uid!)
    const sourceItemUids = sourceExtractedItemUids(db, docUid, resourceUids)
    removeIntermediateItems(db, docUid, selected)

    const firstIndex = Math.min(...indexes)
    const first = selected[0]!
    const merged: IntermediateElement = {
      id: nextIntermediateElementId(structure),
      level: first.level,
      section_path: first.section_path,
      ...created.summary,
      type: (created.summary.type ?? 'paragraph') as IntermediateElement['type'],
      resource_uid: created.uid
    }
    structure.elements = structure.elements.filter((element) => !uniqueIds.includes(element.id))
    structure.elements.splice(firstIndex, 0, merged)
    const mergedItemUid = addIntermediateItem(db, projectUid, docUid, merged, created.type)
    addItemBasedOnLinks(db, projectUid, mergedItemUid, sourceItemUids)
    saveStructure(db, docUid, structure)
    return { newElementId: merged.id, newResourceUid: created.uid, warnings: created.warnings }
  })
  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'merged' })
  return result
}
/** 要素の分割: 2 つの新リソースへ分割し、双方から元 ID を追跡する */
export function splitElement(
  db: Database,
  projectUid: string,
  docUid: string,
  elementId: string,
  texts: [string, string]
): { newElementIds: [string, string] } {
  if (!texts[0].trim() || !texts[1].trim()) {
    throw new BackendError('validation', '分割後の本文が空です', '')
  }
  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    const index = structure.elements.findIndex((e) => e.id === elementId)
    const element = structure.elements[index]
    if (!element || !element.resource_uid) {
      throw new BackendError('not_found', `要素が見つかりません: ${elementId}`, '')
    }
    if (element.type !== 'paragraph') {
      throw new BackendError('validation', `分割できない要素種別です: ${element.type}`, '')
    }

    const ctx: EditContext = { db, projectUid, docUid }
    const createdA = newTextResource(ctx, texts[0], texts[0], 'user')
    const createdB = newTextResource(ctx, texts[1], texts[1], 'user')
    addDerivationLink(db, projectUid, createdA.uid, element.resource_uid, 'human_approved', 'split')
    addDerivationLink(db, projectUid, createdB.uid, element.resource_uid, 'human_approved', 'split')
    const sourceItemUids = sourceExtractedItemUids(db, docUid, [element.resource_uid])
    removeIntermediateItems(db, docUid, [element])

    const partA: IntermediateElement = { ...element, id: `${element.id}a`, text: texts[0], resource_uid: createdA.uid }
    const partB: IntermediateElement = { ...element, id: `${element.id}b`, text: texts[1], resource_uid: createdB.uid }
    structure.elements.splice(index, 1, partA, partB)
    const itemAUid = addIntermediateItem(db, projectUid, docUid, partA)
    const itemBUid = addIntermediateItem(db, projectUid, docUid, partB)
    addItemBasedOnLinks(db, projectUid, itemAUid, sourceItemUids)
    addItemBasedOnLinks(db, projectUid, itemBUid, sourceItemUids)
    saveStructure(db, docUid, structure)
    return { newElementIds: [partA.id, partB.id] as [string, string] }
  })
  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'split' })
  return result
}

// ---- P7-5: チャンク管理（MID-030〜034） ----

/** 日本語混じりテキストの粗いトークン数推定 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 2)
}

export function createChunk(
  db: Database,
  projectUid: string,
  docUid: string,
  elementIds: string[],
  promptTemplateUid?: string,
  additionalPrompt = ''
): { chunkUid: string; code: string; tokenCount: number } {
  if (elementIds.length === 0) {
    throw new BackendError('validation', 'チャンクへ含める要素を選択してください', '')
  }
  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    const selected = elementIds.map((id) => {
      const element = structure.elements.find((e) => e.id === id)
      if (!element || !element.resource_uid) {
        throw new BackendError('not_found', `要素が見つかりません: ${id}`, '')
      }
      return element
    })

    const text = selected.map((e) => e.text ?? '').join('\n')
    const chunk = registerEntity(db, {
      projectUid,
      entityType: 'chunk',
      title: (selected[0]!.text ?? '').slice(0, 60) || 'チャンク',
      createdBy: 'user'
    })
    const nextOrder = (
      db
        .prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS value FROM chunk WHERE intermediate_document_uid=?')
        .get(docUid) as { value: number }
    ).value
    db.prepare(
      'INSERT INTO chunk (uid, intermediate_document_uid, prompt_template_uid, additional_prompt, sort_order, token_count) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(chunk.uid, docUid, promptTemplateUid ?? null, additionalPrompt, nextOrder, estimateTokens(text))

    // chunk_item: intermediate_item を順序付きで対応付ける（本文は重複保持しない。§9.2）
    selected.forEach((element, i) => {
      const itemRow = db
        .prepare(`SELECT uid FROM intermediate_item WHERE intermediate_document_uid = ? AND resource_uid = ?`)
        .get(docUid, element.resource_uid) as { uid: string } | undefined
      if (!itemRow) {
        throw new BackendError('internal', `intermediate_item が見つかりません: ${element.id}`, '')
      }
      const chunkItem = registerEntity(db, { projectUid, entityType: 'chunk_item', createdBy: 'user' })
      db.prepare(`INSERT INTO chunk_item (uid, chunk_uid, intermediate_item_uid, sort_order) VALUES (?, ?, ?, ?)`).run(
        chunkItem.uid,
        chunk.uid,
        itemRow.uid,
        i
      )
      const trace = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'human' })
      db.prepare(
        "INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, basis_kind, created_by, review_status) VALUES (?, ?, ?, 'based_on', 'normalized', 'human', 'approved')"
      ).run(trace.uid, chunk.uid, itemRow.uid)
    })

    return { chunkUid: chunk.uid, code: chunk.code, tokenCount: estimateTokens(text) }
  })
  return txn()
}

export function listChunks(db: Database, docUid: string): unknown[] {
  const rows = db
    .prepare(
      `SELECT e.uid, e.code, e.title, c.token_count, c.prompt_template_uid, c.additional_prompt, c.sort_order, c.created_at,
              (SELECT COUNT(*) FROM chunk_item ci WHERE ci.chunk_uid = c.uid) AS item_count,
              (SELECT json_group_array(ci.intermediate_item_uid) FROM chunk_item ci WHERE ci.chunk_uid = c.uid) AS item_uids_json
         FROM chunk c JOIN entity_registry e ON e.uid = c.uid
        WHERE c.intermediate_document_uid = ? AND e.status <> 'deleted'
        ORDER BY c.sort_order, e.code`
    )
    .all(docUid) as Array<Record<string, unknown> & { item_uids_json: string }>
  return rows.map(({ item_uids_json, ...row }) => ({
    ...row,
    item_uids: JSON.parse(item_uids_json) as string[]
  }))
}

export function getChunk(db: Database, chunkUid: string): unknown {
  const chunk = db
    .prepare(
      `SELECT e.uid, e.code, e.title, c.intermediate_document_uid, c.prompt_template_uid, c.additional_prompt, c.sort_order, c.token_count
       FROM chunk c JOIN entity_registry e ON e.uid=c.uid WHERE c.uid=? AND e.status <> 'deleted'`
    )
    .get(chunkUid)
  if (!chunk) throw new BackendError('not_found', `チャンクが見つかりません: ${chunkUid}`, '')
  const items = db
    .prepare(
      `SELECT ci.intermediate_item_uid, ci.sort_order, ii.resource_uid
       FROM chunk_item ci JOIN intermediate_item ii ON ii.uid=ci.intermediate_item_uid
      WHERE ci.chunk_uid=? ORDER BY ci.sort_order`
    )
    .all(chunkUid)
  return { ...(chunk as object), items }
}

export function updateChunk(
  db: Database,
  projectUid: string,
  chunkUid: string,
  intermediateItemUids: string[],
  additionalPrompt: string
): void {
  const unique = [...new Set(intermediateItemUids)]
  if (unique.length === 0) throw new BackendError('validation', 'チャンクへ含める成果物項目を選択してください', '')
  const rows = db
    .prepare(
      `SELECT i.uid, e.status FROM intermediate_item i JOIN entity_registry e ON e.uid=i.uid
      WHERE i.uid IN (${unique.map(() => '?').join(',')})
        AND i.intermediate_document_uid=(SELECT intermediate_document_uid FROM chunk WHERE uid=?)`
    )
    .all(...unique, chunkUid) as { uid: string; status: string }[]
  if (rows.length !== unique.length || rows.some((row) => row.status !== 'approved'))
    throw new BackendError('validation', '同じ成果物の確認済み項目だけをチャンクへ設定できます', '')
  const txn = db.transaction(() => {
    const oldItems = db.prepare(`SELECT uid FROM chunk_item WHERE chunk_uid=?`).all(chunkUid) as { uid: string }[]
    const oldLinks = db
      .prepare(`SELECT uid FROM trace_link WHERE from_uid=? AND relation_type='based_on'`)
      .all(chunkUid) as { uid: string }[]
    for (const row of [...oldItems, ...oldLinks]) db.prepare(`DELETE FROM entity_registry WHERE uid=?`).run(row.uid)
    unique.forEach((itemUid, sortOrder) => {
      const item = registerEntity(db, { projectUid, entityType: 'chunk_item', createdBy: 'user' })
      db.prepare(`INSERT INTO chunk_item (uid, chunk_uid, intermediate_item_uid, sort_order) VALUES (?, ?, ?, ?)`).run(
        item.uid,
        chunkUid,
        itemUid,
        sortOrder
      )
      const trace = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'human' })
      db.prepare(
        `INSERT INTO trace_link (uid, from_uid, to_uid, relation_type, basis_kind, created_by, review_status) VALUES (?, ?, ?, 'based_on', 'normalized', 'human', 'approved')`
      ).run(trace.uid, chunkUid, itemUid)
    })
    const text = getChunkText(db, chunkUid)
    db.prepare(`UPDATE chunk SET additional_prompt=?, token_count=? WHERE uid=?`).run(
      additionalPrompt,
      estimateTokens(text),
      chunkUid
    )
  })
  txn()
  eventBus.emit('intermediate.updated', { kind: 'chunk-updated', chunkUid })
}

export function reorderChunks(db: Database, docUid: string, chunkUids: string[]): void {
  const current = db
    .prepare(
      `SELECT c.uid FROM chunk c JOIN entity_registry e ON e.uid=c.uid
      WHERE c.intermediate_document_uid=? AND e.status <> 'deleted' ORDER BY c.sort_order, e.code`
    )
    .all(docUid) as { uid: string }[]
  if (
    chunkUids.length !== current.length ||
    new Set(chunkUids).size !== current.length ||
    current.some((row) => !chunkUids.includes(row.uid))
  )
    throw new BackendError('validation', '成果物内の全チャンクを重複なく指定してください', '')
  const txn = db.transaction(() => {
    const update = db.prepare(`UPDATE chunk SET sort_order=? WHERE uid=? AND intermediate_document_uid=?`)
    chunkUids.forEach((chunkUid, index) => update.run(index, chunkUid, docUid))
  })
  txn()
  eventBus.emit('intermediate.updated', { kind: 'chunk-reordered', intermediateDocumentUid: docUid })
}
/** チャンクの LLM 入力テキストを resource_* から再生成する（本文の二重管理をしない） */
export function getChunkText(db: Database, chunkUid: string): string {
  const rows = db
    .prepare(
      `SELECT ii.item_type, ii.resource_uid
         FROM chunk_item ci
         JOIN intermediate_item ii ON ii.uid = ci.intermediate_item_uid
        WHERE ci.chunk_uid = ?
        ORDER BY ci.sort_order`
    )
    .all(chunkUid) as { item_type: string; resource_uid: string }[]
  if (rows.length === 0) {
    throw new BackendError('not_found', `チャンクが見つかりません: ${chunkUid}`, '')
  }
  const parts: string[] = []
  for (const row of rows) {
    switch (row.item_type) {
      case 'resource_text': {
        const r = db.prepare(`SELECT text_body FROM resource_text WHERE uid = ?`).get(row.resource_uid) as
          { text_body: string } | undefined
        if (r) parts.push(r.text_body)
        break
      }
      case 'resource_label': {
        const r = db.prepare(`SELECT label_text FROM resource_label WHERE uid = ?`).get(row.resource_uid) as
          { label_text: string } | undefined
        if (r) parts.push(`# ${r.label_text}`)
        break
      }
      case 'resource_list': {
        const r = db.prepare(`SELECT items_json FROM resource_list WHERE uid = ?`).get(row.resource_uid) as
          { items_json: string | null } | undefined
        if (r?.items_json) {
          try {
            const items = JSON.parse(r.items_json) as { text: string }[]
            parts.push(items.map((i) => `- ${i.text}`).join('\n'))
          } catch {
            parts.push(r.items_json)
          }
        }
        break
      }
      case 'resource_table': {
        const r = db.prepare(`SELECT cells_json FROM resource_table WHERE uid = ?`).get(row.resource_uid) as
          { cells_json: string | null } | undefined
        if (r?.cells_json) {
          const cells = JSON.parse(r.cells_json) as { text: string }[][]
          parts.push(cells.map((row2) => row2.map((c) => c.text).join(' | ')).join('\n'))
        }
        break
      }
      default:
        break
    }
  }
  return parts.join('\n')
}

export function deleteChunk(db: Database, chunkUid: string): void {
  // チャンクは一時的単位（MID-030）のため物理削除する（chunk_item は CASCADE）
  const chunkItems = db.prepare(`SELECT uid FROM chunk_item WHERE chunk_uid = ?`).all(chunkUid) as { uid: string }[]
  const txn = db.transaction(() => {
    for (const item of chunkItems) {
      db.prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(item.uid)
    }
    const result = db.prepare(`DELETE FROM entity_registry WHERE uid = ?`).run(chunkUid)
    if (result.changes === 0) {
      throw new BackendError('not_found', `チャンクが見つかりません: ${chunkUid}`, '')
    }
  })
  txn()
}
