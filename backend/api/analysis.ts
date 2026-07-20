/**
 * 設計分析 API（ANA-001〜006）。
 * クエリ規則スロット（10種）の取得・保存、DSL 検証、分析実行＋レポート出力を提供する。
 * スロットの正本はプロジェクト設定 `analysis.querySlots`（設計モデル設定画面で編集）。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import { requireProject } from '../project/project-service'
import { getProjectSettings, setProjectSetting } from '../settings/settings-service'
import {
  ANALYSIS_SLOT_COUNT,
  DEFAULT_ANALYSIS_SLOTS,
  normalizeAnalysisSlots,
  parseAnalysisDsl,
  runAnalysis,
  saveAnalysisReport,
  validateAgainstOntology,
  type AnalysisQuerySlot
} from '../analysis/analysis-service'
import { eventBus } from '../events/event-bus'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', String(params))
  }
  return params as Record<string, unknown>
}

function loadSlots(projectRoot: string): AnalysisQuerySlot[] {
  const raw = getProjectSettings(projectRoot)['analysis.querySlots']
  if (raw === undefined) {
    // 未設定プロジェクトは既定スロット（先頭2件）を10枠へ展開して返す
    return normalizeAnalysisSlots(DEFAULT_ANALYSIS_SLOTS)
  }
  return normalizeAnalysisSlots(raw)
}

export function registerAnalysisApi(router: ApiRouter): void {
  /** クエリ規則スロット10種の取得（ANA-004） */
  router.register('analysis.getSlots', () => {
    const { info } = requireProject()
    return { slots: loadSlots(info.rootPath), slotCount: ANALYSIS_SLOT_COUNT }
  })

  /** クエリ規則スロットの保存（ANA-004。定義済みスロットは保存時に DSL を検証する） */
  router.register('analysis.saveSlots', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const slots = normalizeAnalysisSlots(p.slots)
    for (const [index, slot] of slots.entries()) {
      if (!slot.dsl.trim() && !slot.name.trim()) continue
      if (!slot.dsl.trim() || !slot.name.trim()) {
        throw new BackendError(
          'validation',
          `スロット${index + 1}: ボタン名とクエリ定義DSLの両方を入力してください`,
          ''
        )
      }
      const validation = validateAgainstOntology(db, parseAnalysisDsl(slot.dsl))
      if (!validation.ok) {
        const first = validation.errors[0]!
        throw new BackendError(
          'validation',
          `スロット${index + 1}「${slot.name}」のDSLが不正です（${first.line}行目: ${first.message}）`,
          ''
        )
      }
    }
    setProjectSetting(info.rootPath, 'analysis.querySlots', slots)
    eventBus.emit('analysis.slotsUpdated', { count: slots.filter((slot) => slot.dsl.trim()).length })
    return { saved: true }
  })

  /** DSL の構文・オントロジー整合の検証（ANA-001。設定画面の検証ボタンが使用） */
  router.register('analysis.validateDsl', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const dsl = typeof p.dsl === 'string' ? p.dsl : ''
    const validation = validateAgainstOntology(db, parseAnalysisDsl(dsl))
    return {
      ok: validation.ok,
      errors: validation.errors,
      requiresStart: validation.requiresStart,
      requiresEnd: validation.requiresEnd
    }
  })

  /** 分析の実行とレポート出力（ANA-002/003/006）。slotIndex または dsl 直接指定 */
  router.register('analysis.run', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    let name: string
    let dsl: string
    if (p.slotIndex !== undefined) {
      const index = Number(p.slotIndex)
      const slots = loadSlots(info.rootPath)
      const slot = Number.isInteger(index) ? slots[index] : undefined
      if (!slot || !slot.dsl.trim()) {
        throw new BackendError('validation', `スロット${index + 1} にクエリ規則が定義されていません`, '')
      }
      name = slot.name
      dsl = slot.dsl
    } else {
      name = typeof p.name === 'string' && p.name ? p.name : 'アドホック分析'
      dsl = typeof p.dsl === 'string' ? p.dsl : ''
    }
    const result = runAnalysis(db, info.projectUid, {
      name,
      dsl,
      startUid: typeof p.startUid === 'string' && p.startUid ? p.startUid : undefined,
      endUid: typeof p.endUid === 'string' && p.endUid ? p.endUid : undefined
    })
    const report = saveAnalysisReport(info.rootPath, result)
    return {
      name: result.name,
      fileName: report.fileName,
      path: report.path,
      elementCount: result.elements.length,
      relationCount: result.relations.length,
      pathCount: result.paths.length,
      stepCount: result.steps.length,
      truncated: result.truncated
    }
  })
}
