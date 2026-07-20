/**
 * 評価 API（EVAL-001〜003）。
 * サンプルデータ投入・評価②（影響分析精度）は同期実行、評価①（LLM変換精度）は
 * LLM 実行を伴うためジョブ（eval.runConversion）として実行する。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import { requireProject } from '../project/project-service'
import { seedSampleProject } from '../eval/sample-project-service'
import { buildImpactEvalMarkdown, runImpactEval, saveEvalReport } from '../eval/eval-service'
import { eventBus } from '../events/event-bus'

export function registerEvalApi(router: ApiRouter, jobs: JobManager): void {
  /** 評価用サンプルプロジェクトデータの投入（EVAL-001） */
  router.register('eval.seedSample', () => {
    const { db, info } = requireProject()
    const result = seedSampleProject(db, info.projectUid, info.rootPath)
    eventBus.emit('artifact.updated', { seeded: true })
    return result
  })

  /** 評価②: 影響範囲分析精度の実行とレポート出力（EVAL-003） */
  router.register('eval.runImpact', (params) => {
    const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    const { db, info } = requireProject()
    const result = runImpactEval(db, info.projectUid, info.rootPath)
    const report = saveEvalReport(
      info.rootPath,
      'impact',
      buildImpactEvalMarkdown(result),
      p.format === 'html' ? 'html' : 'markdown'
    )
    return {
      fileName: report.fileName,
      path: report.path,
      caseCount: result.cases.length,
      f1: result.totals.metrics.f1,
      precision: result.totals.metrics.precision,
      recall: result.totals.metrics.recall,
      durationMs: result.totals.durationMs
    }
  })

  /** 評価①: LLM変換精度評価のジョブ登録（EVAL-002。実Provider実行） */
  router.register('eval.runConversion', (params) => {
    const p = typeof params === 'object' && params !== null ? (params as Record<string, unknown>) : {}
    requireProject()
    if (p.format !== undefined && p.format !== 'markdown' && p.format !== 'html') {
      throw new BackendError('validation', 'format は markdown または html を指定してください', String(p.format))
    }
    return jobs.enqueue('eval.runConversion', { format: p.format ?? 'markdown' })
  })
}
