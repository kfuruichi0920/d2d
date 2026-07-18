/**
 * 汎用インパクト分析（P9-5、TRACE-030〜038、UI-015）。
 * 任意のResource集合を複数列へ配置し、表示中の全列組合せ間のtrace_linkと文書階層を返す。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { RELATION_TYPES, type RelationType } from '../design/design-service'
import { resolveMatrixResources, type TraceMatrixResource } from './trace-matrix-service'

export const MAX_IMPACT_COLUMNS = 8
export const MAX_IMPACT_ITEMS_PER_COLUMN = 1000
export const MAX_IMPACT_LINKS = 5000

export interface TraceImpactColumnInput {
  id: string
  scopeIds: string[]
}

export interface TraceImpactItem extends TraceMatrixResource {
  parentUid: string | null
  depth: number
  hasChildren: boolean
}

export interface TraceImpactColumn {
  id: string
  scopeIds: string[]
  items: TraceImpactItem[]
  truncated: boolean
}

export interface TraceImpactLink {
  uid: string
  leftColumnId: string
  rightColumnId: string
  leftUid: string
  rightUid: string
  fromUid: string
  toUid: string
  relationType: string
  displayDirection: 'left_to_right' | 'right_to_left' | 'bidirectional'
  reviewStatus: string | null
  rationale: string | null
  confidence: number | null
}

export interface TraceImpactView {
  columns: TraceImpactColumn[]
  links: TraceImpactLink[]
  relationTypes: readonly string[]
  truncatedLinks: boolean
}

interface HierarchyMeta {
  parentUid: string | null
  depth: number
  order: number
}

interface StructureElement {
  type?: string
  level?: number
  resource_uid?: string
  intermediate_item_uid?: string
}

function parseStructure(value: string): StructureElement[] {
  try {
    const parsed = JSON.parse(value) as { elements?: StructureElement[] }
    return Array.isArray(parsed.elements) ? parsed.elements : []
  } catch {
    return []
  }
}

function hierarchyForScope(db: Database, scopeId: string): Map<string, HierarchyMeta> {
  const separator = scopeId.indexOf(':')
  if (separator < 1) return new Map()
  const kind = scopeId.slice(0, separator)
  const docUid = scopeId.slice(separator + 1)
  if (kind !== 'extracted' && kind !== 'intermediate') return new Map()

  const row = db
    .prepare(
      kind === 'extracted'
        ? `SELECT structure_json FROM extracted_document WHERE uid=?`
        : `SELECT structure_json FROM intermediate_document WHERE uid=?`
    )
    .get(docUid) as { structure_json: string } | undefined
  if (!row) return new Map()

  const itemByResource =
    kind === 'extracted'
      ? new Map(
          (
            db.prepare(`SELECT uid, resource_uid FROM extracted_item WHERE extracted_document_uid=?`).all(docUid) as {
              uid: string
              resource_uid: string
            }[]
          ).map((item) => [item.resource_uid, item.uid])
        )
      : new Map<string, string>()
  const hierarchy = new Map<string, HierarchyMeta>()
  const headingStack: { uid: string; level: number }[] = []
  const elements = parseStructure(row.structure_json)

  elements.forEach((element, order) => {
    const uid =
      kind === 'intermediate'
        ? element.intermediate_item_uid
        : element.resource_uid
          ? itemByResource.get(element.resource_uid)
          : undefined
    if (!uid) return
    if (element.type === 'heading') {
      const level = Math.max(1, Number(element.level ?? 1))
      while (headingStack.length > 0 && headingStack[headingStack.length - 1]!.level >= level) headingStack.pop()
      hierarchy.set(uid, {
        parentUid: headingStack[headingStack.length - 1]?.uid ?? null,
        depth: headingStack.length,
        order
      })
      headingStack.push({ uid, level })
      return
    }
    hierarchy.set(uid, {
      parentUid: headingStack[headingStack.length - 1]?.uid ?? null,
      depth: headingStack.length + (element.type === 'list_item' ? Math.max(0, Number(element.level ?? 0)) : 0),
      order
    })
  })
  return hierarchy
}

function resolveImpactColumn(db: Database, projectUid: string, input: TraceImpactColumnInput): TraceImpactColumn {
  const scopeIds = [...new Set(input.scopeIds)].slice(0, 50)
  const resources = resolveMatrixResources(db, projectUid, scopeIds)
  const hierarchy = new Map<string, HierarchyMeta>()
  const scopeOrder = new Map<string, number>()
  scopeIds.forEach((scopeId, scopeIndex) => {
    const scoped = hierarchyForScope(db, scopeId)
    for (const [uid, meta] of scoped) {
      if (!hierarchy.has(uid)) hierarchy.set(uid, meta)
      if (!scopeOrder.has(uid)) scopeOrder.set(uid, scopeIndex * MAX_IMPACT_ITEMS_PER_COLUMN + meta.order)
    }
  })

  const ordered = [...resources].sort((a, b) => {
    const aOrder = scopeOrder.get(a.uid)
    const bOrder = scopeOrder.get(b.uid)
    if (aOrder !== undefined || bOrder !== undefined)
      return (aOrder ?? Number.MAX_SAFE_INTEGER) - (bOrder ?? Number.MAX_SAFE_INTEGER)
    return a.code.localeCompare(b.code)
  })
  const truncated = ordered.length > MAX_IMPACT_ITEMS_PER_COLUMN
  const limited = ordered.slice(0, MAX_IMPACT_ITEMS_PER_COLUMN)
  const visibleSet = new Set(limited.map((resource) => resource.uid))
  const parentSet = new Set<string>()
  for (const resource of limited) {
    const parentUid = hierarchy.get(resource.uid)?.parentUid
    if (parentUid && visibleSet.has(parentUid)) parentSet.add(parentUid)
  }
  const items = limited.map((resource): TraceImpactItem => {
    const meta = hierarchy.get(resource.uid)
    return {
      ...resource,
      parentUid: meta?.parentUid && visibleSet.has(meta.parentUid) ? meta.parentUid : null,
      depth: meta?.depth ?? 0,
      hasChildren: parentSet.has(resource.uid)
    }
  })
  return { id: input.id, scopeIds, items, truncated }
}

function linksBetween(
  db: Database,
  projectUid: string,
  left: TraceImpactColumn,
  right: TraceImpactColumn,
  relationTypes: readonly RelationType[],
  limit: number
): { links: TraceImpactLink[]; truncated: boolean } {
  if (left.items.length === 0 || right.items.length === 0 || relationTypes.length === 0 || limit <= 0)
    return { links: [], truncated: limit <= 0 }
  const leftIds = left.items.map((item) => item.uid)
  const rightIds = right.items.map((item) => item.uid)
  const leftPlaceholders = leftIds.map(() => '?').join(',')
  const rightPlaceholders = rightIds.map(() => '?').join(',')
  const relationFilter =
    relationTypes.length > 0 ? `AND t.relation_type IN (${relationTypes.map(() => '?').join(',')})` : ''
  const rows = db
    .prepare(
      `SELECT t.uid, t.from_uid, t.to_uid, t.relation_type, t.direction, t.review_status, t.rationale, t.confidence
         FROM trace_link t
         JOIN entity_registry link_entity ON link_entity.uid=t.uid
          AND link_entity.project_uid=? AND link_entity.status <> 'deleted'
        WHERE ((t.from_uid IN (${leftPlaceholders}) AND t.to_uid IN (${rightPlaceholders}))
            OR (t.to_uid IN (${leftPlaceholders}) AND t.from_uid IN (${rightPlaceholders})))
          ${relationFilter}
        ORDER BY t.relation_type, t.uid LIMIT ?`
    )
    .all(projectUid, ...leftIds, ...rightIds, ...leftIds, ...rightIds, ...relationTypes, limit + 1) as {
    uid: string
    from_uid: string
    to_uid: string
    relation_type: string
    direction: string
    review_status: string | null
    rationale: string | null
    confidence: number | null
  }[]
  const truncated = rows.length > limit
  const leftSet = new Set(leftIds)
  return {
    truncated,
    links: rows.slice(0, limit).map((row) => {
      const fromOnLeft = leftSet.has(row.from_uid)
      return {
        uid: row.uid,
        leftColumnId: left.id,
        rightColumnId: right.id,
        leftUid: fromOnLeft ? row.from_uid : row.to_uid,
        rightUid: fromOnLeft ? row.to_uid : row.from_uid,
        fromUid: row.from_uid,
        toUid: row.to_uid,
        relationType: row.relation_type,
        displayDirection:
          row.direction === 'bidirectional' ? 'bidirectional' : fromOnLeft ? 'left_to_right' : 'right_to_left',
        reviewStatus: row.review_status,
        rationale: row.rationale,
        confidence: row.confidence
      }
    })
  }
}

/** 複数列のResourceと表示中の全列組合せ間リンクを一括取得する。正本データは変更しない。 */
export function getTraceImpactView(
  db: Database,
  projectUid: string,
  columnInputs: readonly TraceImpactColumnInput[],
  requestedRelationTypes: readonly string[]
): TraceImpactView {
  const inputs = columnInputs.slice(0, MAX_IMPACT_COLUMNS)
  if (inputs.length < 2) throw new BackendError('validation', 'インパクト分析には2列以上必要です', '')
  if (inputs.some((input) => !input.id || !Array.isArray(input.scopeIds))) {
    throw new BackendError('validation', '列IDとResource集合を指定してください', '')
  }
  if (new Set(inputs.map((input) => input.id)).size !== inputs.length) {
    throw new BackendError('validation', '列IDが重複しています', '')
  }
  const relationTypes = [...new Set(requestedRelationTypes)].filter((type): type is RelationType =>
    RELATION_TYPES.includes(type as RelationType)
  )
  const columns = inputs.map((input) => resolveImpactColumn(db, projectUid, input))
  const links: TraceImpactLink[] = []
  let truncatedLinks = false
  outer: for (let leftIndex = 0; leftIndex < columns.length - 1; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < columns.length; rightIndex += 1) {
      const remaining = MAX_IMPACT_LINKS - links.length
      const result = linksBetween(db, projectUid, columns[leftIndex]!, columns[rightIndex]!, relationTypes, remaining)
      links.push(...result.links)
      truncatedLinks ||= result.truncated
      if (links.length >= MAX_IMPACT_LINKS) {
        truncatedLinks = true
        break outer
      }
    }
  }
  return { columns, links, relationTypes: RELATION_TYPES, truncatedLinks }
}
