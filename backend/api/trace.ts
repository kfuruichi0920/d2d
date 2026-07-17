/**
 * トレーサビリティ API（P9）。
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import { requireProject } from '../project/project-service'
import {
  checkConsistency,
  exportSubgraph,
  getTraceMatrix,
  getTraceSubgraph,
  type ExportFormat,
  type TraceDirection
} from '../traceability/trace-service'
import {
  getEditableTraceMatrix,
  listTraceMatrixScopes,
  updateTraceMatrixLinks,
  type MatrixUpdateInput
} from '../traceability/trace-matrix-service'
import { RELATION_TYPES, type RelationType } from '../design/design-service'
import { getTraceImpactView, type TraceImpactColumnInput } from '../traceability/trace-impact-service'

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

export function registerTraceApi(router: ApiRouter): void {
  /** 双方向トレース探索（TRACE-001〜003/021/022） */
  router.register('trace.getSubgraph', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    return getTraceSubgraph(db, {
      rootUid: requireString(p, 'rootUid'),
      depth: p.depth === undefined ? undefined : Number(p.depth),
      direction: (p.direction as TraceDirection | undefined) ?? 'both',
      relationTypes: Array.isArray(p.relationTypes) ? (p.relationTypes as string[]) : undefined
    })
  })

  /** トレースマトリクス（UI-014） */
  router.register('trace.matrix', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return getTraceMatrix(
      db,
      info.projectUid,
      requireString(p, 'rowCategory'),
      requireString(p, 'colCategory'),
      p.relationType === undefined ? undefined : String(p.relationType)
    )
  })

  /** 整合性検査（srs §2.3、Problems Panel） */
  router.register('trace.check', () => {
    const { db, info } = requireProject()
    return checkConsistency(db, info.projectUid)
  })
  /** 汎用マトリクスの行・列候補Resource集合（TRACE-026/029）。 */
  router.register('trace.matrixScopes', () => {
    const { db, info } = requireProject()
    return listTraceMatrixScopes(db, info.projectUid)
  })

  /** 複数Resource集合と両方向リンクを返す編集用マトリクス（TRACE-026〜029）。 */
  router.register('trace.editableMatrix', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const strings = (key: string): string[] =>
      Array.isArray(p[key]) ? (p[key] as unknown[]).map((value) => String(value)) : []
    return getEditableTraceMatrix(
      db,
      info.projectUid,
      strings('rowScopeIds'),
      strings('colScopeIds'),
      strings('relationTypes')
    )
  })

  /** 選択セル群へ関係を同一トランザクションで追加／削除／トグルする（TRACE-027）。 */
  router.register('trace.updateMatrix', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const operation = String(p.operation)
    const direction = String(p.direction)
    const relationTypes = Array.isArray(p.relationTypes)
      ? (p.relationTypes.map((value) => String(value)) as RelationType[])
      : []
    if (!['add', 'delete', 'toggle'].includes(operation)) {
      throw new BackendError('validation', 'operation は add/delete/toggle のいずれかです', operation)
    }
    if (!['row_to_col', 'col_to_row'].includes(direction)) {
      throw new BackendError('validation', 'direction は row_to_col/col_to_row のいずれかです', direction)
    }
    if (relationTypes.some((type) => !RELATION_TYPES.includes(type))) {
      throw new BackendError('validation', 'relationTypesに未定義の関係種別があります', relationTypes.join(','))
    }
    const pairs = Array.isArray(p.pairs)
      ? p.pairs.map((value) => {
          const pair = asRecord(value)
          return { rowUid: requireString(pair, 'rowUid'), colUid: requireString(pair, 'colUid') }
        })
      : []
    return updateTraceMatrixLinks(db, info.projectUid, {
      pairs,
      relationTypes,
      direction,
      operation
    } as MatrixUpdateInput)
  })
  /** 複数のResource集合列と方向付きリンクを返すインパクト分析（TRACE-030〜038、UI-015）。 */
  router.register('trace.impactView', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const columns = Array.isArray(p.columns)
      ? p.columns.map((value): TraceImpactColumnInput => {
          const column = asRecord(value)
          return {
            id: requireString(column, 'id'),
            scopeIds: Array.isArray(column.scopeIds) ? column.scopeIds.map((scopeId) => String(scopeId)) : []
          }
        })
      : []
    const relationTypes = Array.isArray(p.relationTypes) ? p.relationTypes.map((value) => String(value)) : []
    if (relationTypes.some((type) => !RELATION_TYPES.includes(type as RelationType))) {
      throw new BackendError('validation', 'relationTypesに未定義の関係種別があります', relationTypes.join(','))
    }
    return getTraceImpactView(db, info.projectUid, columns, relationTypes)
  })

  /** クエリ結果の JSON/CSV/Markdown 出力（TRACE-024）。exports/trace/ へ保存する */
  router.register('trace.export', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const format = (['json', 'csv', 'markdown'].includes(String(p.format)) ? String(p.format) : 'json') as ExportFormat
    const subgraph = getTraceSubgraph(db, {
      rootUid: requireString(p, 'rootUid'),
      depth: p.depth === undefined ? undefined : Number(p.depth),
      direction: (p.direction as TraceDirection | undefined) ?? 'both'
    })
    const content = exportSubgraph(subgraph, format)
    const ext = format === 'markdown' ? 'md' : format
    const dir = join(info.rootPath, 'exports', 'trace')
    mkdirSync(dir, { recursive: true })
    const fileName = `trace_${Date.now()}.${ext}`
    writeFileSync(join(dir, fileName), content, 'utf-8')
    return { path: join('exports', 'trace', fileName), format, nodeCount: subgraph.nodes.length }
  })

  /** ④→③→②→① の根拠チェーン（UI-015 階層リスト間リンク） */
  router.register('trace.basisChains', () => {
    const { db, info } = requireProject()
    // 設計要素ごとに based_on を最大3段辿る（④→③→②→①）
    const elements = db
      .prepare(
        `SELECT uid, code, title, design_category FROM entity_registry
          WHERE project_uid = ? AND design_category IS NOT NULL AND status <> 'deleted' ORDER BY code`
      )
      .all(info.projectUid) as { uid: string; code: string; title: string | null; design_category: string }[]
    const basisOf = db.prepare(
      `SELECT t.to_uid, e.code, e.title, e.entity_type FROM trace_link t
         JOIN entity_registry le ON le.uid = t.uid AND le.status <> 'deleted'
         JOIN entity_registry e ON e.uid = t.to_uid
        WHERE t.from_uid = ? AND t.relation_type = 'based_on'`
    )
    const chainFor = (uid: string, hops: number): { code: string; title: string | null; entity_type: string }[] => {
      const chain: { code: string; title: string | null; entity_type: string }[] = []
      let current = uid
      for (let i = 0; i < hops; i++) {
        const next = basisOf.get(current) as
          { to_uid: string; code: string; title: string | null; entity_type: string } | undefined
        if (!next) break
        chain.push({ code: next.code, title: next.title, entity_type: next.entity_type })
        current = next.to_uid
      }
      return chain
    }
    return elements.map((e) => ({ ...e, basis: chainFor(e.uid, 3) }))
  })
}
