/**
 * 設計分析機能のユニットテスト（ANA-001〜006）。
 * DSL 解析・オントロジー整合検証・決定論的実行（過程記録）・経路検索・レポート出力を検証する。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { createDesignElement, createTraceLink } from '../design/design-service'
import {
  buildAnalysisReportMarkdown,
  loadAnalysisResult,
  normalizeAnalysisSlots,
  parseAnalysisDsl,
  runAnalysis,
  saveAnalysisReport,
  validateAgainstOntology
} from './analysis-service'

describe('設計分析（ANA-001〜006）', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string
  let reqUid: string
  let funcUid: string
  let verifUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-analysis-'))
    root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid

    // FUNC -[satisfies]-> REQ <-[verifies]- VERIF の小さな設計グラフを用意する
    reqUid = createDesignElement(db, projectUid, { modelType: 'model_req', title: '応答時間要求' }).uid
    funcUid = createDesignElement(db, projectUid, { modelType: 'model_func', title: '応答処理機能' }).uid
    verifUid = createDesignElement(db, projectUid, { modelType: 'model_verif', title: '応答時間試験' }).uid
    createTraceLink(db, projectUid, {
      fromUid: funcUid,
      toUid: reqUid,
      relationType: 'satisfies',
      createdBy: 'human',
      reviewStatus: 'approved'
    })
    createTraceLink(db, projectUid, {
      fromUid: verifUid,
      toUid: reqUid,
      relationType: 'verifies',
      createdBy: 'human',
      reviewStatus: 'approved'
    })
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('DSL を解析し、構文エラーを行番号付きで報告する（ANA-001）', () => {
    const valid = parseAnalysisDsl(
      ['# コメント', 'FROM TYPE model_req', 'TRAVERSE satisfies,verifies UP DEPTH 2', 'FILTER STATUS approved'].join(
        '\n'
      )
    )
    expect(valid.ok).toBe(true)
    expect(valid.commands.map((command) => command.kind)).toEqual(['from', 'traverse', 'filter'])
    expect(valid.requiresStart).toBe(false) // FROM があるため起点不要

    const invalid = parseAnalysisDsl(['TRAVERSE satisfies SIDEWAYS', 'UNKNOWN foo'].join('\n'))
    expect(invalid.ok).toBe(false)
    expect(invalid.errors).toEqual([
      { line: 1, message: expect.stringContaining('TRAVERSE') },
      { line: 2, message: expect.stringContaining('不明な命令') }
    ])

    expect(parseAnalysisDsl('').ok).toBe(false)
    // PATH は起点・終点とも必須、FROM なし TRAVERSE は起点必須
    expect(parseAnalysisDsl('PATH *').requiresEnd).toBe(true)
    expect(parseAnalysisDsl('TRAVERSE * DOWN').requiresStart).toBe(true)
  })

  it('未定義の関係種別をオントロジー照合で検出する（ANA-001）', () => {
    const validation = validateAgainstOntology(db, parseAnalysisDsl('TRAVERSE not_a_relation DOWN'))
    expect(validation.ok).toBe(false)
    expect(validation.errors[0]?.message).toContain('未定義の関係種別')
  })

  it('影響分析: TRAVERSE と FILTER の連続適用で影響範囲を過程付きで導出する（ANA-002）', () => {
    const result = runAnalysis(db, projectUid, {
      name: '影響分析テスト',
      dsl: ['TRAVERSE satisfies DOWN', 'TRAVERSE verifies UP', 'FILTER TYPE model_req,model_verif'].join('\n'),
      startUid: funcUid
    })
    // FUNC → (satisfies下流) REQ → (verifies上流) VERIF → FILTER で FUNC を除外
    expect(result.elements.map((element) => element.uid).sort()).toEqual([reqUid, verifUid].sort())
    expect(result.steps).toHaveLength(3)
    expect(result.steps[0]).toMatchObject({ kind: 'traverse', inputCount: 1, outputCount: 2 })
    expect(result.steps[1]).toMatchObject({ kind: 'traverse', inputCount: 2, outputCount: 3 })
    expect(result.steps[2]).toMatchObject({ kind: 'filter', inputCount: 3, outputCount: 2 })
    expect(result.steps[2]!.changedCodes).toEqual(['FUNC-000001'])
    // 集合内要素間の関係は VERIF-[verifies]->REQ のみ
    expect(result.relations).toHaveLength(1)
    expect(result.relations[0]).toMatchObject({ relation_type: 'verifies' })
  })

  it('起点不要クエリ: FROM TYPE で集合を初期化できる（ANA-002）', () => {
    const result = runAnalysis(db, projectUid, {
      name: '全要求',
      dsl: 'FROM TYPE model_req'
    })
    expect(result.elements.map((element) => element.uid)).toEqual([reqUid])
    // 起点必須クエリで起点未指定はエラー
    expect(() => runAnalysis(db, projectUid, { name: 'x', dsl: 'TRAVERSE * DOWN' })).toThrow(/起点要素の指定が必要/)
  })

  it('経路検索: 二要素間の意味的経路を辺の向き付きで列挙する（ANA-003）', () => {
    const result = runAnalysis(db, projectUid, {
      name: '経路検索テスト',
      dsl: 'PATH * MAXDEPTH 4',
      startUid: funcUid,
      endUid: verifUid
    })
    expect(result.paths).toHaveLength(1)
    const path = result.paths[0]!
    expect(path.nodes.map((node) => node.code)).toEqual(['FUNC-000001', 'REQ-000001', 'VERIF-000001'])
    expect(path.segments).toEqual([
      { relation_type: 'satisfies', along: 'forward' },
      { relation_type: 'verifies', along: 'backward' }
    ])
    // 終点未指定はエラー
    expect(() => runAnalysis(db, projectUid, { name: 'x', dsl: 'PATH *', startUid: funcUid })).toThrow(
      /終点要素の指定が必要/
    )
  })

  it('分析過程を含むレポートを exports/reports へ出力する（ANA-006）', () => {
    const result = runAnalysis(db, projectUid, {
      name: '影響レポート',
      dsl: 'TRAVERSE * DOWN DEPTH 2',
      startUid: funcUid
    })
    const markdown = buildAnalysisReportMarkdown(result)
    expect(markdown).toContain('# 設計分析レポート: 影響レポート')
    expect(markdown).toContain('## クエリ規則（DSL）')
    expect(markdown).toContain('## 分析過程')
    expect(markdown).toContain('## 分析結果: 対象要素')
    expect(markdown).toContain('REQ-000001')

    const saved = saveAnalysisReport(root, result)
    const fullPath = join(root, saved.path)
    expect(existsSync(fullPath)).toBe(true)
    expect(readFileSync(fullPath, 'utf-8')).toContain('分析過程')
    expect(saved.fileName.startsWith('analysis_')).toBe(true)
    expect(saved.fileName.endsWith('.md')).toBe(true)
  })

  it('クエリ規則スロットは常に10枠へ正規化される（ANA-004、MCP-011）', () => {
    const slots = normalizeAnalysisSlots([
      { name: 'A', dsl: 'FROM TYPE model_req', mcpDescription: '要求一覧を返す' },
      { bogus: true }
    ])
    expect(slots).toHaveLength(10)
    expect(slots[0]).toEqual({ name: 'A', dsl: 'FROM TYPE model_req', mcpDescription: '要求一覧を返す' })
    expect(slots[1]).toEqual({ name: '', dsl: '', mcpDescription: '' })
    expect(slots[9]).toEqual({ name: '', dsl: '', mcpDescription: '' })
  })

  it('DSL拡張: 関係属性WHERE・要素属性ATTR・否定NOTで絞り込める（ANA-007）', () => {
    // WHERE: satisfies(approved) は通り、存在しない値では辿らない
    const whereHit = runAnalysis(db, projectUid, {
      name: 'where-hit',
      dsl: 'TRAVERSE satisfies DOWN WHERE review_status=approved',
      startUid: funcUid
    })
    expect(whereHit.elements.map((element) => element.uid)).toContain(reqUid)
    const whereMiss = runAnalysis(db, projectUid, {
      name: 'where-miss',
      dsl: 'TRAVERSE satisfies DOWN WHERE review_status=draft',
      startUid: funcUid
    })
    expect(whereMiss.elements.map((element) => element.uid)).not.toContain(reqUid)

    // FILTER ATTR: title 部分一致
    const attr = runAnalysis(db, projectUid, {
      name: 'attr',
      dsl: ['FROM TYPE *', 'FILTER ATTR title~応答時間'].join('\n')
    })
    expect(attr.elements.map((element) => element.uid).sort()).toEqual([reqUid, verifUid].sort())

    // FILTER NOT TYPE: 要求を除外
    const negate = runAnalysis(db, projectUid, {
      name: 'not',
      dsl: ['FROM TYPE model_req,model_func', 'FILTER NOT TYPE model_req'].join('\n')
    })
    expect(negate.elements.map((element) => element.uid)).toEqual([funcUid])

    // 不正なWHERE属性は検証エラー
    expect(parseAnalysisDsl('TRAVERSE * DOWN WHERE bogus_attr=1').ok).toBe(false)
  })

  it('DSL拡張: SET による集合演算ができる（ANA-007）', () => {
    // 全モデル保存 → 要求だけ残す → 保存済み全集合との EXCEPT で「要求以外」を得る
    const result = runAnalysis(db, projectUid, {
      name: 'set-ops',
      dsl: [
        'FROM TYPE *',
        'SET SAVE all',
        'FILTER TYPE model_req',
        'SET SAVE reqs',
        'SET LOAD all',
        'SET EXCEPT reqs'
      ].join('\n')
    })
    expect(result.elements.map((element) => element.uid).sort()).toEqual([funcUid, verifUid].sort())
    expect(result.steps.filter((step) => step.kind === 'set')).toHaveLength(4)

    // SAVE していない集合の参照は静的エラー
    expect(parseAnalysisDsl('SET LOAD unknown').ok).toBe(false)
    // INTERSECT
    const intersect = runAnalysis(db, projectUid, {
      name: 'intersect',
      dsl: [
        'FROM TYPE model_req,model_func',
        'SET SAVE a',
        'FROM TYPE model_verif',
        'FILTER TYPE model_req',
        'SET UNION a',
        'SET INTERSECT a'
      ].join('\n')
    })
    expect(intersect.elements.map((element) => element.uid).sort()).toEqual([funcUid, reqUid].sort())
  })

  it('HTML形式レポートと構造化結果JSONを保存できる（ANA-008/009）', () => {
    const result = runAnalysis(db, projectUid, {
      name: 'html-report',
      dsl: 'TRAVERSE * DOWN DEPTH 2',
      startUid: funcUid
    })
    const saved = saveAnalysisReport(root, result, 'html')
    expect(saved.fileName.endsWith('.html')).toBe(true)
    const html = readFileSync(join(root, saved.path), 'utf-8')
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('設計分析レポート: html-report')
    // グラフ表示用 JSON（reportFileName 付き）
    const data = loadAnalysisResult(root, saved.dataFileName) as ReturnType<typeof runAnalysis> & {
      reportFileName?: string
    }
    expect(data.reportFileName).toBe(saved.fileName)
    expect(data.elements.map((element) => element.uid)).toContain(reqUid)
    expect(() => loadAnalysisResult(root, 'missing.json')).toThrow(/見つかりません/)
  })
})
