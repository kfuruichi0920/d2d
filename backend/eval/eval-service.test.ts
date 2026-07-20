/**
 * 評価ハーネスのユニットテスト（EVAL-001〜003）。
 * サンプルプロジェクト投入の整合、評価①（決定論的スタブLLM）・評価②の指標計算とレポートを検証する。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { getProjectSettings } from '../settings/settings-service'
import { seedSampleProject, SAMPLE_CHUNK_SETTING_KEY, SAMPLE_ELEMENT_SETTING_KEY } from './sample-project-service'
import { SAMPLE_ELEMENTS, SAMPLE_IMPACT_CASES, expectedElementsBySection } from './sample-design'
import {
  buildConversionEvalMarkdown,
  buildImpactEvalMarkdown,
  computeMetrics,
  runConversionEval,
  runImpactEval,
  saveEvalReport,
  titlesMatch
} from './eval-service'

describe('評価ハーネス（EVAL-001〜003）', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-eval-'))
    root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('サンプルプロジェクトを投入できる（EVAL-001。①②③チャンク④正解モデル・関係）', () => {
    const result = seedSampleProject(db, projectUid, root)
    expect(result.documentCount).toBe(2)
    expect(result.chunkCount).toBe(7)
    expect(result.elementCount).toBe(SAMPLE_ELEMENTS.length)
    expect(result.relationCount).toBeGreaterThan(40)
    expect(result.basedOnCount).toBe(SAMPLE_ELEMENTS.length)

    // 正解モデルは approved で登録される
    const approved = db
      .prepare(
        `SELECT COUNT(*) AS n FROM entity_registry WHERE project_uid = ? AND entity_type LIKE 'model_%' AND status = 'approved'`
      )
      .get(projectUid) as { n: number }
    expect(approved.n).toBe(SAMPLE_ELEMENTS.length)

    // 対応表がプロジェクト設定へ保存される
    const settings = getProjectSettings(root)
    expect(Object.keys(settings[SAMPLE_CHUNK_SETTING_KEY] as Record<string, string>)).toHaveLength(7)
    expect(Object.keys(settings[SAMPLE_ELEMENT_SETTING_KEY] as Record<string, string>)).toHaveLength(
      SAMPLE_ELEMENTS.length
    )

    // 二重投入は conflict
    expect(() => seedSampleProject(db, projectUid, root)).toThrow(/投入済み/)
  })

  it('評価②: 影響分析精度が期待影響集合と一致し F1=1.0 になる（EVAL-003）', () => {
    seedSampleProject(db, projectUid, root)
    const result = runImpactEval(db, projectUid, root)
    expect(result.cases).toHaveLength(SAMPLE_IMPACT_CASES.length)
    for (const caseResult of result.cases) {
      expect(
        caseResult.metrics.f1,
        `${caseResult.name}: 未抽出=${caseResult.missedTitles} 過剰=${caseResult.extraTitles}`
      ).toBe(1)
    }
    expect(result.totals.metrics.f1).toBe(1)
    expect(result.totals.durationMs).toBeGreaterThanOrEqual(0)

    const markdown = buildImpactEvalMarkdown(result)
    expect(markdown).toContain('評価②レポート')
    expect(markdown).toContain('上限警報しきい値の仕様変更')
    expect(markdown).toContain('期待影響集合と完全一致')
    const saved = saveEvalReport(root, 'impact', markdown)
    expect(existsSync(join(root, saved.path))).toBe(true)
  })

  it('評価②: サンプル未投入時は validation エラー', () => {
    expect(() => runImpactEval(db, projectUid, root)).toThrow(/未投入/)
  })

  it('評価①: スタブLLMで正答率・トークン数を算出しレポート出力できる（EVAL-002）', async () => {
    seedSampleProject(db, projectUid, root)
    const chunkSections = getProjectSettings(root)[SAMPLE_CHUNK_SETTING_KEY] as Record<string, string>

    // 決定論的スタブ: req セクションだけ期待値どおり + 過剰1件を返し、他セクションは空を返す
    const result = await runConversionEval(db, projectUid, root, async (chunkUid) => {
      const section = chunkSections[chunkUid]
      const elements =
        section === 'req'
          ? [
              ...expectedElementsBySection('req').map((element, index) => ({
                temp_id: `T${index + 1}`,
                category: element.modelType,
                title: element.title
              })),
              { temp_id: 'T99', category: 'model_req', title: '存在しない要求' }
            ]
          : []
      return {
        content: JSON.stringify({ elements, relations: [] }),
        inputTokens: 1000,
        outputTokens: 100
      }
    })

    expect(result.chunks).toHaveLength(7)
    const reqChunk = result.chunks.find((chunk) => chunk.section === 'req')!
    expect(reqChunk.elementMetrics.recall).toBe(1)
    expect(reqChunk.elementMetrics.matched).toBe(expectedElementsBySection('req').length)
    expect(reqChunk.extraTitles).toEqual(['存在しない要求'])
    const cstChunk = result.chunks.find((chunk) => chunk.section === 'cst')!
    expect(cstChunk.elementMetrics.recall).toBe(0)
    expect(cstChunk.missedTitles.length).toBe(expectedElementsBySection('cst').length)
    expect(result.totals.inputTokens).toBe(7000)

    const markdown = buildConversionEvalMarkdown(result)
    expect(markdown).toContain('評価①レポート')
    expect(markdown).toContain('未生成（期待にあり）')
    const saved = saveEvalReport(root, 'conversion', markdown, 'html')
    expect(saved.fileName.endsWith('.html')).toBe(true)
    expect(readFileSync(join(root, saved.path), 'utf-8')).toContain('<!DOCTYPE html>')
  })

  it('指標計算とタイトル照合の規則（EVAL-002/003）', () => {
    expect(computeMetrics(10, 8, 6)).toMatchObject({ precision: 0.75, recall: 0.6 })
    expect(computeMetrics(0, 0, 0).f1).toBe(0)
    expect(titlesMatch('温度計測', '温度計測')).toBe(true)
    expect(titlesMatch('温度計測機能', '温度計測')).toBe(true) // 包含を許容
    expect(titlesMatch('警報出力', '温度計測')).toBe(false)
    expect(titlesMatch('', '温度計測')).toBe(false)
  })
})
