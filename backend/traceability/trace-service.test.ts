import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createDesignElement, createTraceLink } from '../design/design-service'
import { checkConsistency, exportSubgraph, getTraceMatrix, getTraceSubgraph } from './trace-service'

import { getEditableTraceMatrix, listTraceMatrixScopes, updateTraceMatrixLinks } from './trace-matrix-service'
describe('トレーサビリティ（P9）', () => {
  let dir: string
  let db: Database
  let projectUid: string
  let req1: { uid: string; code: string }
  let req2: { uid: string; code: string }
  let func1: { uid: string; code: string }
  let struct1: { uid: string; code: string }
  let verif1: { uid: string; code: string }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-trace-'))
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid

    // グラフ: REQ1 <-satisfies- FUNC1 -allocated_to-> STRUCT1、REQ1 -decomposes-> REQ2、VERIF1 -verifies-> REQ1
    req1 = createDesignElement(db, projectUid, { category: 'REQ', title: '要求1' })
    req2 = createDesignElement(db, projectUid, { category: 'REQ', title: '要求2' })
    func1 = createDesignElement(db, projectUid, { category: 'FUNC', title: '機能1' })
    struct1 = createDesignElement(db, projectUid, { category: 'STRUCT', title: '構造1' })
    verif1 = createDesignElement(db, projectUid, { category: 'VERIF', title: '試験1' })

    createTraceLink(db, projectUid, {
      fromUid: func1.uid,
      toUid: req1.uid,
      relationType: 'satisfies',
      createdBy: 'human'
    })
    createTraceLink(db, projectUid, {
      fromUid: req1.uid,
      toUid: req2.uid,
      relationType: 'decomposes',
      attributes: { decompositionKind: 'refinement' },
      createdBy: 'human'
    })
    createTraceLink(db, projectUid, {
      fromUid: func1.uid,
      toUid: struct1.uid,
      relationType: 'allocated_to',
      attributes: { allocationKind: 'structure' },
      createdBy: 'human'
    })
    createTraceLink(db, projectUid, {
      fromUid: verif1.uid,
      toUid: req1.uid,
      relationType: 'verifies',
      createdBy: 'human'
    })
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('双方向探索: 起点から hop 付きでノード・エッジを返す（TRACE-001）', () => {
    const graph = getTraceSubgraph(db, { rootUid: req1.uid, depth: 3, direction: 'both' })
    const codes = graph.nodes.map((n) => n.code).sort()
    expect(codes).toEqual([func1.code, req1.code, req2.code, struct1.code, verif1.code].sort())
    expect(graph.nodes.find((n) => n.uid === req1.uid)?.hop).toBe(0)
    expect(graph.nodes.find((n) => n.uid === struct1.uid)?.hop).toBe(2) // REQ1←FUNC1→STRUCT1
    expect(graph.edges).toHaveLength(4)
    expect(graph.truncated).toBe(false)
  })

  it('方向指定: forward は下流のみ、backward は上流のみ（TRACE-022）', () => {
    const forward = getTraceSubgraph(db, { rootUid: req1.uid, depth: 3, direction: 'forward' })
    expect(forward.nodes.map((n) => n.code).sort()).toEqual([req1.code, req2.code].sort()) // REQ1 -decomposes-> REQ2

    const backward = getTraceSubgraph(db, { rootUid: req1.uid, depth: 1, direction: 'backward' })
    expect(backward.nodes.map((n) => n.code).sort()).toEqual([func1.code, req1.code, verif1.code].sort())
  })

  it('深さ制限: depth=1 では 2 hop 先を含まない（TRACE-003）', () => {
    const graph = getTraceSubgraph(db, { rootUid: req1.uid, depth: 1, direction: 'both' })
    expect(graph.nodes.some((n) => n.uid === struct1.uid)).toBe(false)
  })

  it('関係種別フィルタ（TRACE-002）', () => {
    const graph = getTraceSubgraph(db, { rootUid: req1.uid, depth: 3, direction: 'both', relationTypes: ['satisfies'] })
    expect(graph.nodes.map((n) => n.code).sort()).toEqual([func1.code, req1.code].sort())
    expect(graph.edges.every((e) => e.relation_type === 'satisfies')).toBe(true)
  })

  it('トレースマトリクス: FUNC×REQ に satisfies が入る（UI-014）', () => {
    const matrix = getTraceMatrix(db, projectUid, 'FUNC', 'REQ')
    expect(matrix.rows.map((r) => r.code)).toEqual([func1.code])
    expect(matrix.cols).toHaveLength(2)
    expect(matrix.cells[func1.uid]?.[req1.uid]).toEqual(['satisfies'])
    expect(matrix.cells[func1.uid]?.[req2.uid]).toBeUndefined()
  })

  it('汎用マトリクス: 複数Resource集合と両方向の関係を返す（TRACE-026/029）', () => {
    const scopes = listTraceMatrixScopes(db, projectUid)
    expect(scopes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'design:FUNC', count: 1 }),
        expect.objectContaining({ id: 'design:REQ', count: 2 })
      ])
    )

    const forward = getEditableTraceMatrix(db, projectUid, ['design:FUNC'], ['design:REQ'], ['satisfies'])
    expect(forward.rows.map((row) => row.code)).toEqual([func1.code])
    expect(forward.cells[func1.uid]?.[req1.uid]?.[0]).toMatchObject({
      relationType: 'satisfies',
      direction: 'row_to_col'
    })

    const reverse = getEditableTraceMatrix(db, projectUid, ['design:REQ'], ['design:FUNC'], ['satisfies'])
    expect(reverse.cells[req1.uid]?.[func1.uid]?.[0]).toMatchObject({
      relationType: 'satisfies',
      direction: 'col_to_row'
    })
  })

  it('汎用マトリクス: 選択セルへ関係を一括追加・論理削除できる（TRACE-027）', () => {
    const added = updateTraceMatrixLinks(db, projectUid, {
      pairs: [{ rowUid: func1.uid, colUid: req2.uid }],
      relationTypes: ['satisfies', 'relates_to'],
      direction: 'row_to_col',
      operation: 'add'
    })
    expect(added).toMatchObject({ added: 2, deleted: 0 })

    const matrix = getEditableTraceMatrix(db, projectUid, ['design:FUNC'], ['design:REQ'], ['satisfies', 'relates_to'])
    expect(matrix.cells[func1.uid]?.[req2.uid]?.map((link) => link.relationType).sort()).toEqual([
      'relates_to',
      'satisfies'
    ])

    const removed = updateTraceMatrixLinks(db, projectUid, {
      pairs: [{ rowUid: func1.uid, colUid: req2.uid }],
      relationTypes: ['satisfies', 'relates_to'],
      direction: 'row_to_col',
      operation: 'delete'
    })
    expect(removed.deleted).toBe(2)
    expect(
      getEditableTraceMatrix(db, projectUid, ['design:FUNC'], ['design:REQ']).cells[func1.uid]?.[req2.uid]
    ).toBeUndefined()
  })

  it('汎用マトリクス: セルクリック相当のtoggleで関係を反転する（TRACE-027）', () => {
    const input = {
      pairs: [{ rowUid: func1.uid, colUid: req2.uid }],
      relationTypes: ['satisfies'] as const,
      direction: 'row_to_col' as const,
      operation: 'toggle' as const
    }
    expect(updateTraceMatrixLinks(db, projectUid, input).added).toBe(1)
    expect(updateTraceMatrixLinks(db, projectUid, input).deleted).toBe(1)
  })

  it('汎用マトリクス: 一括追加の途中で許容関係エラーなら全体をロールバックする', () => {
    expect(() =>
      updateTraceMatrixLinks(db, projectUid, {
        pairs: [
          { rowUid: func1.uid, colUid: req2.uid },
          { rowUid: req1.uid, colUid: func1.uid }
        ],
        relationTypes: ['satisfies'],
        direction: 'row_to_col',
        operation: 'add'
      })
    ).toThrow(/許容されない関係/)
    expect(
      getEditableTraceMatrix(db, projectUid, ['design:FUNC'], ['design:REQ']).cells[func1.uid]?.[req2.uid]
    ).toBeUndefined()
  })
  it('整合性検査: 未接続・根拠不足・検証未対応・暫定リンク・循環を検出する（srs §2.3）', () => {
    // 未接続要素を追加
    const isolated = createDesignElement(db, projectUid, { category: 'MGMT', title: '未接続の判断' })
    // 暫定リンク
    createTraceLink(db, projectUid, {
      fromUid: req2.uid,
      toUid: struct1.uid,
      relationType: 'relates_to',
      createdBy: 'human'
    })
    // 循環: REQ2 -decomposes-> REQ1（REQ1 -decomposes-> REQ2 と合わせて閉路）
    createTraceLink(db, projectUid, {
      fromUid: req2.uid,
      toUid: req1.uid,
      relationType: 'decomposes',
      attributes: { decompositionKind: 'refinement' },
      createdBy: 'human'
    })

    const problems = checkConsistency(db, projectUid)
    const kinds = (kind: string): string[] => problems.filter((p) => p.kind === kind).map((p) => p.code)

    expect(kinds('unconnected')).toContain(isolated.code)
    // 全要素 based_on なし（このテストでは根拠を張っていない）
    expect(kinds('no_basis')).toContain(req1.code)
    // 検証未対応: REQ2 は verifies を受けていない（REQ1 は受けている）
    expect(kinds('unverified_requirement')).toContain(req2.code)
    expect(kinds('unverified_requirement')).not.toContain(req1.code)
    // 暫定リンク
    expect(kinds('provisional_link')).toHaveLength(1)
    // 循環: REQ1/REQ2 が閉路上
    expect(kinds('cycle').sort()).toEqual([req1.code, req2.code].sort())
  })

  it('クエリ結果の JSON/CSV/Markdown 出力（TRACE-024）', () => {
    const graph = getTraceSubgraph(db, { rootUid: req1.uid, depth: 2, direction: 'both' })

    const json = exportSubgraph(graph, 'json')
    expect(JSON.parse(json).nodes.length).toBe(graph.nodes.length)

    const csv = exportSubgraph(graph, 'csv')
    expect(csv).toContain(`node,${req1.uid}`)
    expect(csv.split('\n')[0]).toContain('type,uid')

    const md = exportSubgraph(graph, 'markdown')
    expect(md).toContain('| hop | code |')
    expect(md).toContain(req1.code)
  })
})
