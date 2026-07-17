/**
 * 汎用トレースマトリクス（P9-4、TRACE-026〜029、UI-014）。
 * Resource集合の行列表示とtrace_linkの一括追加・論理削除を提供する。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { createTraceLink, RELATION_TYPES, type RelationType, type TraceLinkAttributes } from '../design/design-service'
import { eventBus } from '../events/event-bus'
import { updateEntityStatus } from '../store/entity-registry'

export interface TraceMatrixScope {
  id: string
  kind: 'design' | 'extracted' | 'intermediate' | 'resource_type'
  label: string
  description: string
  count: number
}

export interface TraceMatrixResource {
  uid: string
  code: string
  title: string | null
  entityType: string
  designCategory: string | null
  status: string
  itemType: string | null
  scopes: string[]
}

export interface EditableMatrixLink {
  uid: string
  relationType: string
  fromUid: string
  toUid: string
  direction: 'row_to_col' | 'col_to_row'
  reviewStatus: string | null
}

export interface EditableTraceMatrix {
  rows: TraceMatrixResource[]
  cols: TraceMatrixResource[]
  cells: Record<string, Record<string, EditableMatrixLink[]>>
  relationTypes: readonly string[]
}

const MATRIX_CATEGORIES = [
  'SRC',
  'STD',
  'REQ',
  'CST',
  'FUNC',
  'STRUCT',
  'BEH',
  'STATE',
  'IF',
  'DATA',
  'VERIF',
  'MGMT',
  'IMPL'
]

/** 行・列へ配置可能なResource集合を列挙する。③文書は複数Resourceの表示グループとして返す。 */
export function listTraceMatrixScopes(db: Database, projectUid: string): TraceMatrixScope[] {
  const scopes: TraceMatrixScope[] = []
  const categoryCounts = db
    .prepare(
      `SELECT design_category AS id, COUNT(*) AS count FROM entity_registry
        WHERE project_uid=? AND design_category IS NOT NULL AND status <> 'deleted'
        GROUP BY design_category`
    )
    .all(projectUid) as { id: string; count: number }[]
  const countByCategory = new Map(categoryCounts.map((row) => [row.id, row.count]))
  for (const category of MATRIX_CATEGORIES) {
    const count = countByCategory.get(category) ?? 0
    if (count > 0) {
      scopes.push({
        id: `design:${category}`,
        kind: 'design',
        label: `④設計分類: ${category}`,
        description: `${category}分類の設計Resource`,
        count
      })
    }
  }

  const extracted = db
    .prepare(
      `SELECT d.uid, e.code, e.title, COUNT(ie.uid) AS count
         FROM extracted_document d
         JOIN entity_registry e ON e.uid=d.uid AND e.project_uid=? AND e.status <> 'deleted'
         LEFT JOIN extracted_item i ON i.extracted_document_uid=d.uid
         LEFT JOIN entity_registry ie ON ie.uid=i.uid AND ie.status <> 'deleted'
        GROUP BY d.uid, e.code, e.title ORDER BY e.code`
    )
    .all(projectUid) as { uid: string; code: string; title: string | null; count: number }[]
  for (const doc of extracted) {
    if (doc.count === 0) continue
    scopes.push({
      id: `extracted:${doc.uid}`,
      kind: 'extracted',
      label: `② ${doc.code} ${doc.title ?? ''}`.trim(),
      description: '抽出文書配下のextracted_item',
      count: doc.count
    })
  }

  const intermediate = db
    .prepare(
      `SELECT d.uid, e.code, e.title, d.dev_phase_id, d.artifact_type_id, COUNT(ie.uid) AS count
         FROM intermediate_document d
         JOIN entity_registry e ON e.uid=d.uid AND e.project_uid=? AND e.status <> 'deleted'
         LEFT JOIN intermediate_item i ON i.intermediate_document_uid=d.uid
         LEFT JOIN entity_registry ie ON ie.uid=i.uid AND ie.status <> 'deleted'
        GROUP BY d.uid, e.code, e.title, d.dev_phase_id, d.artifact_type_id
        ORDER BY d.dev_phase_id, d.artifact_type_id, e.code`
    )
    .all(projectUid) as {
    uid: string
    code: string
    title: string | null
    dev_phase_id: string
    artifact_type_id: string
    count: number
  }[]
  for (const doc of intermediate) {
    if (doc.count === 0) continue
    scopes.push({
      id: `intermediate:${doc.uid}`,
      kind: 'intermediate',
      label: `③ ${doc.dev_phase_id} / ${doc.artifact_type_id}: ${doc.title ?? doc.code}`,
      description: '中間文書がグルーピングするintermediate_item',
      count: doc.count
    })
  }

  const resourceTypes = db
    .prepare(
      `SELECT entity_type AS type, COUNT(*) AS count FROM entity_registry
        WHERE project_uid=? AND entity_type LIKE 'resource_%' AND status <> 'deleted'
        GROUP BY entity_type ORDER BY entity_type`
    )
    .all(projectUid) as { type: string; count: number }[]
  for (const row of resourceTypes) {
    scopes.push({
      id: `resource_type:${row.type}`,
      kind: 'resource_type',
      label: `Resource種別: ${row.type}`,
      description: '共通台帳上のResource種別',
      count: row.count
    })
  }
  return scopes
}

export function resolveMatrixResources(
  db: Database,
  projectUid: string,
  scopeIds: readonly string[]
): TraceMatrixResource[] {
  const resources = new Map<string, TraceMatrixResource>()
  const add = (rows: Omit<TraceMatrixResource, 'scopes'>[], scopeId: string): void => {
    for (const row of rows) {
      const current = resources.get(row.uid)
      if (current) {
        if (!current.scopes.includes(scopeId)) current.scopes.push(scopeId)
      } else {
        resources.set(row.uid, { ...row, scopes: [scopeId] })
      }
    }
  }
  for (const scopeId of [...new Set(scopeIds)].slice(0, 50)) {
    const separator = scopeId.indexOf(':')
    if (separator < 1) continue
    const kind = scopeId.slice(0, separator)
    const value = scopeId.slice(separator + 1)
    if (kind === 'design' && MATRIX_CATEGORIES.includes(value)) {
      add(
        db
          .prepare(
            `SELECT uid, code, title, entity_type AS entityType, design_category AS designCategory,
                    status, NULL AS itemType
               FROM entity_registry WHERE project_uid=? AND design_category=? AND status <> 'deleted'
              ORDER BY code`
          )
          .all(projectUid, value) as Omit<TraceMatrixResource, 'scopes'>[],
        scopeId
      )
    } else if (kind === 'resource_type' && value.startsWith('resource_')) {
      add(
        db
          .prepare(
            `SELECT uid, code, title, entity_type AS entityType, design_category AS designCategory,
                    status, NULL AS itemType
               FROM entity_registry WHERE project_uid=? AND entity_type=? AND status <> 'deleted'
              ORDER BY code`
          )
          .all(projectUid, value) as Omit<TraceMatrixResource, 'scopes'>[],
        scopeId
      )
    } else if (kind === 'extracted') {
      add(
        db
          .prepare(
            `SELECT i.uid, e.code, COALESCE(e.title, r.title) AS title, e.entity_type AS entityType,
                    e.design_category AS designCategory, e.status, i.item_type AS itemType
               FROM extracted_item i
               JOIN entity_registry e ON e.uid=i.uid AND e.project_uid=? AND e.status <> 'deleted'
               LEFT JOIN entity_registry r ON r.uid=i.resource_uid
              WHERE i.extracted_document_uid=? ORDER BY e.code`
          )
          .all(projectUid, value) as Omit<TraceMatrixResource, 'scopes'>[],
        scopeId
      )
    } else if (kind === 'intermediate') {
      add(
        db
          .prepare(
            `SELECT i.uid, e.code, COALESCE(e.title, r.title) AS title, e.entity_type AS entityType,
                    e.design_category AS designCategory, e.status, i.item_type AS itemType
               FROM intermediate_item i
               JOIN entity_registry e ON e.uid=i.uid AND e.project_uid=? AND e.status <> 'deleted'
               LEFT JOIN entity_registry r ON r.uid=i.resource_uid
              WHERE i.intermediate_document_uid=? ORDER BY e.code`
          )
          .all(projectUid, value) as Omit<TraceMatrixResource, 'scopes'>[],
        scopeId
      )
    }
  }
  return [...resources.values()].sort((a, b) => a.code.localeCompare(b.code))
}

/** 両方向のtrace_linkをセルへ集約する汎用マトリクス取得。 */
export function getEditableTraceMatrix(
  db: Database,
  projectUid: string,
  rowScopeIds: readonly string[],
  colScopeIds: readonly string[],
  relationTypes?: readonly string[]
): EditableTraceMatrix {
  const rows = resolveMatrixResources(db, projectUid, rowScopeIds)
  const cols = resolveMatrixResources(db, projectUid, colScopeIds)
  const cells: EditableTraceMatrix['cells'] = {}
  const allowedTypes = (relationTypes ?? []).filter((type) => RELATION_TYPES.includes(type as RelationType))
  if (rows.length === 0 || cols.length === 0) return { rows, cols, cells, relationTypes: RELATION_TYPES }

  const rowSet = new Set(rows.map((row) => row.uid))
  const colSet = new Set(cols.map((col) => col.uid))
  const allIds = [...new Set([...rowSet, ...colSet])]
  const placeholders = allIds.map(() => '?').join(',')
  const links = db
    .prepare(
      `SELECT t.uid, t.from_uid, t.to_uid, t.relation_type, t.review_status
         FROM trace_link t JOIN entity_registry le ON le.uid=t.uid AND le.status <> 'deleted'
        WHERE t.from_uid IN (${placeholders}) AND t.to_uid IN (${placeholders})
          ${allowedTypes.length > 0 ? `AND t.relation_type IN (${allowedTypes.map(() => '?').join(',')})` : ''}
        ORDER BY t.relation_type, t.uid`
    )
    .all(...allIds, ...allIds, ...allowedTypes) as {
    uid: string
    from_uid: string
    to_uid: string
    relation_type: string
    review_status: string | null
  }[]
  const seen = new Set<string>()
  for (const link of links) {
    const positions: { rowUid: string; colUid: string; direction: 'row_to_col' | 'col_to_row' }[] = []
    if (rowSet.has(link.from_uid) && colSet.has(link.to_uid)) {
      positions.push({ rowUid: link.from_uid, colUid: link.to_uid, direction: 'row_to_col' })
    }
    if (rowSet.has(link.to_uid) && colSet.has(link.from_uid)) {
      positions.push({ rowUid: link.to_uid, colUid: link.from_uid, direction: 'col_to_row' })
    }
    for (const position of positions) {
      const key = `${position.rowUid}\0${position.colUid}\0${link.uid}`
      if (seen.has(key)) continue
      seen.add(key)
      cells[position.rowUid] ??= {}
      ;(cells[position.rowUid]![position.colUid] ??= []).push({
        uid: link.uid,
        relationType: link.relation_type,
        fromUid: link.from_uid,
        toUid: link.to_uid,
        direction: position.direction,
        reviewStatus: link.review_status
      })
    }
  }
  return { rows, cols, cells, relationTypes: RELATION_TYPES }
}

export interface MatrixUpdateInput {
  pairs: readonly { rowUid: string; colUid: string }[]
  relationTypes: readonly RelationType[]
  direction: 'row_to_col' | 'col_to_row'
  operation: 'add' | 'delete' | 'toggle'
}

function defaultRelationAttributes(relationType: RelationType, targetCategory: string | null): TraceLinkAttributes {
  if (relationType === 'based_on') return { basisKind: 'human_approved' }
  if (relationType === 'allocated_to') {
    const kinds = {
      STRUCT: 'structure',
      BEH: 'behavior',
      STATE: 'state',
      IF: 'interface',
      DATA: 'data'
    } as const
    return { allocationKind: kinds[targetCategory as keyof typeof kinds] ?? 'structure' }
  }
  if (relationType === 'decomposes') return { decompositionKind: 'refinement' }
  if (relationType === 'uses') return { usageKind: 'read' }
  if (relationType === 'conflicts_with') return { conflictStatus: 'suspected' }
  return {}
}

/** 選択セル群の関係を同一トランザクションで追加・論理削除・トグルする。 */
export function updateTraceMatrixLinks(
  db: Database,
  projectUid: string,
  input: MatrixUpdateInput
): { added: number; deleted: number; unchanged: number } {
  const relationTypes = [...new Set(input.relationTypes)].filter((type) => RELATION_TYPES.includes(type))
  const pairs = [...new Map(input.pairs.map((pair) => [`${pair.rowUid}\0${pair.colUid}`, pair])).values()].slice(
    0,
    5000
  )
  if (relationTypes.length === 0 || pairs.length === 0) {
    throw new BackendError('validation', '対象セルと関係種別を選択してください', '')
  }
  const txn = db.transaction(() => {
    let added = 0
    let deleted = 0
    let unchanged = 0
    for (const pair of pairs) {
      if (pair.rowUid === pair.colUid) {
        unchanged += relationTypes.length
        continue
      }
      const fromUid = input.direction === 'row_to_col' ? pair.rowUid : pair.colUid
      const toUid = input.direction === 'row_to_col' ? pair.colUid : pair.rowUid
      const target = db
        .prepare(`SELECT design_category FROM entity_registry WHERE uid=? AND project_uid=? AND status <> 'deleted'`)
        .get(toUid, projectUid) as { design_category: string | null } | undefined
      const source = db
        .prepare(`SELECT uid FROM entity_registry WHERE uid=? AND project_uid=? AND status <> 'deleted'`)
        .get(fromUid, projectUid)
      if (!source || !target) throw new BackendError('validation', '選択したResourceが見つかりません', '')
      for (const relationType of relationTypes) {
        const existing = db
          .prepare(
            `SELECT t.uid FROM trace_link t JOIN entity_registry e ON e.uid=t.uid AND e.status <> 'deleted'
              WHERE t.from_uid=? AND t.to_uid=? AND t.relation_type=?`
          )
          .all(fromUid, toUid, relationType) as { uid: string }[]
        const shouldDelete = input.operation === 'delete' || (input.operation === 'toggle' && existing.length > 0)
        if (shouldDelete) {
          if (existing.length === 0) {
            unchanged += 1
          } else {
            for (const link of existing) updateEntityStatus(db, link.uid, 'deleted', 'human')
            deleted += existing.length
          }
        } else if (existing.length > 0) {
          unchanged += 1
        } else {
          createTraceLink(db, projectUid, {
            fromUid,
            toUid,
            relationType,
            attributes: defaultRelationAttributes(relationType, target.design_category),
            createdBy: 'human',
            reviewStatus: relationType === 'relates_to' ? 'provisional' : 'approved'
          })
          added += 1
        }
      }
    }
    return { added, deleted, unchanged }
  })
  const result = txn()
  eventBus.emit('relation.updated', { ...result, source: 'trace-matrix' })
  return result
}
