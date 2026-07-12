/**
 * ③中間データ処理（P7、MID-001〜005、sdd_data_structure §2.11）。
 *
 * - ②抽出文書（承認済み）を成果物単位に統合して intermediate_document を生成する
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

export interface IntermediateElement extends ExtractionElement {
  resource_uid?: string
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
function itemTypeOf(element: IntermediateElement): string {
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

function addIntermediateItem(db: Database, projectUid: string, docUid: string, element: IntermediateElement): string {
  const item = registerEntity(db, { projectUid, entityType: 'intermediate_item', createdBy: 'user' })
  db.prepare(
    `INSERT INTO intermediate_item (uid, intermediate_document_uid, item_type, resource_uid) VALUES (?, ?, ?, ?)`
  ).run(item.uid, docUid, itemTypeOf(element), element.resource_uid)
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

/** intermediate_item（対応行）を物理削除する。リソース本体と②の対応は残る */
function removeIntermediateItems(db: Database, docUid: string, resourceUids: string[]): void {
  const rows = db
    .prepare(
      `SELECT uid FROM intermediate_item WHERE intermediate_document_uid = ? AND resource_uid IN (${resourceUids.map(() => '?').join(',')})`
    )
    .all(docUid, ...resourceUids) as { uid: string }[]
  const del = db.prepare(`DELETE FROM entity_registry WHERE uid = ?`) // CASCADE で intermediate_item も消える
  for (const row of rows) del.run(row.uid)
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
  const items = db
    .prepare(
      `SELECT i.uid,i.resource_uid FROM intermediate_item i WHERE i.intermediate_document_uid=? AND NOT EXISTS (SELECT 1 FROM trace_link t JOIN extracted_item x ON x.uid=t.to_uid WHERE t.from_uid=i.uid AND t.relation_type='based_on')`
    )
    .all(docUid) as { uid: string; resource_uid: string }[]
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

export function createIntermediateDocument(
  db: Database,
  projectUid: string,
  input: CreateIntermediateInput
): CreateIntermediateResult {
  if (input.extractedDocumentUids.length === 0) {
    throw new BackendError('validation', '統合対象の②抽出文書を 1 件以上指定してください', '')
  }

  const txn = db.transaction((): CreateIntermediateResult => {
    // 統合対象の検証: 承認済み（②正本）のみ統合できる
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
      if (row.status !== 'approved') {
        throw new BackendError(
          'validation',
          '未確定（レビュー前）の②抽出データは統合できません',
          `${uid} status=${row.status}。抽出レビューで採用確定してください（SRS §2.2）`
        )
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

/** 選択した②要素を、指定した③要素の前後へ統合する。文書 based_on は作成時に管理済み。 */
export function insertExtractedItems(
  db: Database,
  projectUid: string,
  docUid: string,
  resourceUids: string[],
  targetElementId: string | undefined,
  position: 'above' | 'below'
): { inserted: number } {
  if (resourceUids.length === 0) throw new BackendError('validation', '統合する抽出要素を選択してください', '')
  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    const sourceRows = structure.sources
      .map((source) => {
        const row = db
          .prepare(`SELECT structure_json FROM extracted_document WHERE uid = ?`)
          .get(source.extracted_document_uid) as { structure_json: string } | undefined
        return row ? (JSON.parse(row.structure_json) as { elements: IntermediateElement[] }).elements : []
      })
      .flat()
    const byUid = new Map(sourceRows.filter((e) => e.resource_uid).map((e) => [e.resource_uid!, e]))
    const selected = resourceUids
      .map((resourceUid) => byUid.get(resourceUid))
      .filter((e): e is IntermediateElement => Boolean(e))
    if (selected.length !== resourceUids.length)
      throw new BackendError('validation', '選択要素は登録済み統合元に含まれていません', '')
    const target = targetElementId ? structure.elements.findIndex((e) => e.id === targetElementId) : -1
    if (structure.elements.length > 0 && target < 0)
      throw new BackendError('not_found', `統合位置が見つかりません: ${targetElementId}`, '')
    let seq = structure.elements.reduce((max, e) => Math.max(max, Number(e.id.replace(/\D/g, '')) || 0), 0)
    const inserted = selected.map((e) => ({ ...e, id: `i${++seq}` }))
    structure.elements.splice(
      structure.elements.length === 0 ? 0 : target + (position === 'below' ? 1 : 0),
      0,
      ...inserted
    )
    for (const element of inserted) {
      const itemUid = addIntermediateItem(db, projectUid, docUid, element)
      if (element.resource_uid)
        addItemBasedOnLinks(db, projectUid, itemUid, extractedItemUidsForResource(db, element.resource_uid))
    }
    saveStructure(db, docUid, structure)
    return { inserted: inserted.length }
  })
  const result = txn()
  eventBus.emit('intermediate.updated', { intermediateDocumentUid: docUid, kind: 'items-inserted' })
  return result
}

export function deleteIntermediateItems(db: Database, docUid: string, elementIds: string[]): { deleted: number } {
  const structure = loadStructure(db, docUid)
  const removed = structure.elements.filter((e) => elementIds.includes(e.id))
  const resources = removed.map((e) => e.resource_uid).filter((uid): uid is string => Boolean(uid))
  structure.elements = structure.elements.filter((e) => !elementIds.includes(e.id))
  if (resources.length > 0) removeIntermediateItems(db, docUid, resources)
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
    removeIntermediateItems(db, docUid, [oldResourceUid])
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

/** 隣接する 2 要素のマージ: 新リソース 1 件へ統合し、両方の元 ID を追跡する */
export function mergeElements(
  db: Database,
  projectUid: string,
  docUid: string,
  elementIds: [string, string]
): { newElementId: string; newResourceUid: string } {
  const txn = db.transaction(() => {
    const structure = loadStructure(db, docUid)
    const indexA = structure.elements.findIndex((e) => e.id === elementIds[0])
    const indexB = structure.elements.findIndex((e) => e.id === elementIds[1])
    if (indexA < 0 || indexB < 0) {
      throw new BackendError('not_found', 'マージ対象の要素が見つかりません', elementIds.join(', '))
    }
    if (Math.abs(indexA - indexB) !== 1) {
      throw new BackendError('validation', '隣接する要素のみマージできます', '')
    }
    const [first, second] = indexA < indexB ? [indexA, indexB] : [indexB, indexA]
    const elementA = structure.elements[first]!
    const elementB = structure.elements[second]!
    for (const e of [elementA, elementB]) {
      if (!['paragraph', 'list_item'].includes(e.type) || !e.resource_uid) {
        throw new BackendError('validation', `マージできない要素種別です: ${e.type}`, '')
      }
    }

    const mergedText = `${elementA.text ?? ''}\n${elementB.text ?? ''}`
    const ctx: EditContext = { db, projectUid, docUid }
    const created = newTextResource(ctx, mergedText, mergedText, 'user')
    addDerivationLink(db, projectUid, created.uid, elementA.resource_uid!, 'human_approved', 'merge')
    addDerivationLink(db, projectUid, created.uid, elementB.resource_uid!, 'human_approved', 'merge')
    const sourceItemUids = sourceExtractedItemUids(db, docUid, [elementA.resource_uid!, elementB.resource_uid!])
    removeIntermediateItems(db, docUid, [elementA.resource_uid!, elementB.resource_uid!])

    const merged: IntermediateElement = {
      id: `${elementA.id}m`,
      type: 'paragraph',
      text: mergedText,
      section_path: elementA.section_path,
      resource_uid: created.uid
    }
    structure.elements.splice(first, 2, merged)
    const mergedItemUid = addIntermediateItem(db, projectUid, docUid, merged)
    addItemBasedOnLinks(db, projectUid, mergedItemUid, sourceItemUids)
    saveStructure(db, docUid, structure)
    return { newElementId: merged.id, newResourceUid: created.uid }
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
    removeIntermediateItems(db, docUid, [element.resource_uid])

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
    db.prepare(
      `INSERT INTO chunk (uid, intermediate_document_uid, prompt_template_uid, additional_prompt, token_count) VALUES (?, ?, ?, ?, ?)`
    ).run(chunk.uid, docUid, promptTemplateUid ?? null, additionalPrompt, estimateTokens(text))

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
      `SELECT e.uid, e.code, e.title, c.token_count, c.prompt_template_uid, c.additional_prompt, c.created_at,
              (SELECT COUNT(*) FROM chunk_item ci WHERE ci.chunk_uid = c.uid) AS item_count,
              (SELECT json_group_array(ci.intermediate_item_uid) FROM chunk_item ci WHERE ci.chunk_uid = c.uid) AS item_uids_json
         FROM chunk c JOIN entity_registry e ON e.uid = c.uid
        WHERE c.intermediate_document_uid = ? AND e.status <> 'deleted'
        ORDER BY c.created_at DESC`
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
      `SELECT e.uid, e.code, e.title, c.intermediate_document_uid, c.prompt_template_uid, c.additional_prompt, c.token_count
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
          const items = JSON.parse(r.items_json) as { text: string }[]
          parts.push(items.map((i) => `- ${i.text}`).join('\n'))
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
