/**
 * レポート出力 API（P13、EXP-001〜006）。
 * 生成はジョブ（report.generate）として実行し、一覧・本文取得は同期 API で提供する。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { JobManager } from '../jobs/job-manager'
import { requireProject } from '../project/project-service'
import { getReportContent, listReports, type ReportOptions } from '../report/report-service'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', String(params))
  }
  return params as Record<string, unknown>
}

/** UI からの生成条件を ReportOptions へ正規化する */
export function toReportOptions(p: Record<string, unknown>): ReportOptions {
  const format = p.format === 'html' ? 'html' : 'markdown'
  const sections =
    typeof p.sections === 'object' && p.sections !== null ? (p.sections as ReportOptions['sections']) : undefined
  const filtersRaw = typeof p.filters === 'object' && p.filters !== null ? (p.filters as Record<string, unknown>) : {}
  const strList = (v: unknown): string[] | undefined => (Array.isArray(v) && v.length > 0 ? v.map(String) : undefined)
  return {
    format,
    sections,
    title: typeof p.title === 'string' && p.title.trim() ? p.title.trim() : undefined,
    filters: {
      artifactTypeId:
        typeof filtersRaw.artifactTypeId === 'string' && filtersRaw.artifactTypeId
          ? filtersRaw.artifactTypeId
          : undefined,
      sectionPath:
        typeof filtersRaw.sectionPath === 'string' && filtersRaw.sectionPath ? filtersRaw.sectionPath : undefined,
      infoTypes: strList(filtersRaw.infoTypes),
      categories: strList(filtersRaw.categories),
      status: typeof filtersRaw.status === 'string' && filtersRaw.status ? filtersRaw.status : undefined,
      elementCodes: strList(filtersRaw.elementCodes)
    }
  }
}

export function registerReportApi(router: ApiRouter, jobs: JobManager): void {
  /** レポート生成（EXP-001〜006）。長時間化しうるためジョブとして実行 */
  router.register('report.generate', (params) => {
    const p = asRecord(params)
    requireProject()
    return jobs.enqueue('report.generate', p)
  })

  router.register('report.list', () => {
    const { info } = requireProject()
    return listReports(info.rootPath)
  })

  router.register('report.getContent', (params) => {
    const p = asRecord(params)
    const { info } = requireProject()
    const fileName = p.fileName
    if (typeof fileName !== 'string' || !fileName) {
      throw new BackendError('validation', 'fileName は必須の文字列です', '')
    }
    return getReportContent(info.rootPath, fileName)
  })
}
