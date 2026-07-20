/**
 * 評価ハーネス（EVAL-002/003）。
 * チューニング（設計モデル定義・DSL 編集）はマニュアル作業のまま、評価の実行と
 * 結果レポート出力を自動化する。結果は exports/reports/ へ保存し report:// で閲覧する。
 *
 * - EVAL-002 評価①: 入力文書（チャンク）→設計モデルの LLM 変換精度。
 *   期待値（サンプル正解モデル）との照合で適合率/再現率/F1 とトークン数を算出する。
 * - EVAL-003 評価②: 仕様変更ケースに対する影響範囲分析の精度。
 *   クエリ規則（DSL）の実行結果を期待影響集合と照合し、精度と分析時間を算出する。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { getProjectSettings } from '../settings/settings-service'
import { buildDesignCandidateMessages } from '../llm/request-messages'
import { validateCandidateOutput } from '../llm/candidate-validation'
import type { ChatMessage } from '../llm/providers'
import { runAnalysis } from '../analysis/analysis-service'
import { renderReportHtml } from '../report/report-service'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SAMPLE_IMPACT_CASES, expectedElementsBySection, type SampleSectionKey } from './sample-design'
import { SAMPLE_CHUNK_SETTING_KEY, SAMPLE_ELEMENT_SETTING_KEY } from './sample-project-service'

// ---- 共通: 指標計算とレポート保存 ----

export interface EvalMetrics {
  expected: number
  produced: number
  matched: number
  precision: number
  recall: number
  f1: number
}

export function computeMetrics(expected: number, produced: number, matched: number): EvalMetrics {
  const precision = produced === 0 ? 0 : matched / produced
  const recall = expected === 0 ? 0 : matched / expected
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { expected, produced, matched, precision, recall, f1 }
}

const normalize = (text: string): string => text.normalize('NFKC').replaceAll(/\s+/g, '').toLowerCase()

/** タイトル照合: 正規化後の完全一致または包含（LLM の表記揺れを許容する決定論的規則） */
export function titlesMatch(a: string, b: string): boolean {
  const na = normalize(a)
  const nb = normalize(b)
  if (!na || !nb) return false
  return na === nb || na.includes(nb) || nb.includes(na)
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

export function saveEvalReport(
  projectRoot: string,
  kind: 'conversion' | 'impact',
  markdown: string,
  format: 'markdown' | 'html' = 'markdown'
): { fileName: string; path: string } {
  const dir = join(projectRoot, 'exports', 'reports')
  mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-').replace('T', '_').slice(0, 19)
  const ext = format === 'html' ? 'html' : 'md'
  let fileName = `eval_${kind}_${stamp}.${ext}`
  let suffix = 1
  while (existsSync(join(dir, fileName))) {
    fileName = `eval_${kind}_${stamp}_${suffix}.${ext}`
    suffix += 1
  }
  writeFileSync(
    join(dir, fileName),
    format === 'html' ? renderReportHtml(markdown, `評価レポート（${kind}）`) : markdown,
    'utf-8'
  )
  return { fileName, path: join('exports', 'reports', fileName) }
}

// ---- 評価①: LLM 変換精度（EVAL-002） ----

/** LLM 実行の注入点。本番は runLlm、ユニットテストは決定論的スタブを渡す */
export type CandidateGenerator = (
  chunkUid: string,
  messages: ChatMessage[]
) => Promise<{ content: string; inputTokens: number | null; outputTokens: number | null }>

export interface ConversionChunkResult {
  chunkUid: string
  chunkCode: string
  section: SampleSectionKey
  inputTokens: number | null
  outputTokens: number | null
  /** メッセージ文字数（トークン数が取得できない Provider 向けの参考値） */
  inputChars: number
  elementMetrics: EvalMetrics
  relationCount: number
  errors: string[]
  /** 期待値のうち未生成だった要素タイトル */
  missedTitles: string[]
  /** 期待値に対応しない生成要素タイトル */
  extraTitles: string[]
  durationMs: number
}

export interface ConversionEvalResult {
  chunks: ConversionChunkResult[]
  totals: {
    elementMetrics: EvalMetrics
    inputTokens: number
    outputTokens: number
    inputChars: number
    durationMs: number
  }
}

function loadChunkSections(
  db: Database,
  projectUid: string,
  rootPath: string
): { chunkUid: string; chunkCode: string; section: SampleSectionKey }[] {
  const mapping = getProjectSettings(rootPath)[SAMPLE_CHUNK_SETTING_KEY]
  if (typeof mapping !== 'object' || mapping === null) {
    throw new BackendError(
      'validation',
      '評価用サンプルデータが未投入です（サンプルデータ投入を先に実行してください）',
      ''
    )
  }
  const rows = db
    .prepare(
      `SELECT uid, code FROM entity_registry WHERE project_uid = ? AND entity_type = 'chunk' AND status <> 'deleted'`
    )
    .all(projectUid) as { uid: string; code: string }[]
  const codeByUid = new Map(rows.map((row) => [row.uid, row.code]))
  return Object.entries(mapping as Record<string, SampleSectionKey>)
    .filter(([chunkUid]) => codeByUid.has(chunkUid))
    .map(([chunkUid, section]) => ({ chunkUid, chunkCode: codeByUid.get(chunkUid)!, section }))
    .sort((a, b) => a.chunkCode.localeCompare(b.chunkCode))
}

/**
 * 評価①を実行する（EVAL-002）。チャンクごとに候補生成し、期待値（サンプル正解モデル）と
 * model_type + タイトルで照合する。進捗コールバックでジョブへ経過を返す。
 */
export async function runConversionEval(
  db: Database,
  projectUid: string,
  rootPath: string,
  generator: CandidateGenerator,
  onProgress?: (percent: number, message: string) => void
): Promise<ConversionEvalResult> {
  const chunks = loadChunkSections(db, projectUid, rootPath)
  if (chunks.length === 0) throw new BackendError('validation', '評価対象のチャンクがありません', '')
  const results: ConversionChunkResult[] = []
  for (const [index, chunk] of chunks.entries()) {
    onProgress?.(Math.round((index / chunks.length) * 90), `チャンク ${chunk.chunkCode} を評価中`)
    const messages = buildDesignCandidateMessages(db, chunk.chunkUid)
    const inputChars = messages.reduce((sum, message) => sum + message.content.length, 0)
    const startedAt = Date.now()
    const generated = await generator(chunk.chunkUid, messages)
    const durationMs = Date.now() - startedAt
    const validation = validateCandidateOutput(generated.content)
    const candidates = validation.candidateSet?.elements ?? []
    const expected = expectedElementsBySection(chunk.section)

    // 期待値との照合: model_type（category）一致 + タイトル一致。期待1件につき候補1件を割当てる
    const usedCandidates = new Set<number>()
    let matched = 0
    const missedTitles: string[] = []
    for (const expectation of expected) {
      const candidateIndex = candidates.findIndex(
        (candidate, i) =>
          !usedCandidates.has(i) &&
          candidate.category === expectation.modelType &&
          titlesMatch(candidate.title, expectation.title)
      )
      if (candidateIndex >= 0) {
        usedCandidates.add(candidateIndex)
        matched++
      } else {
        missedTitles.push(expectation.title)
      }
    }
    const extraTitles = candidates.filter((_, i) => !usedCandidates.has(i)).map((candidate) => candidate.title)
    results.push({
      chunkUid: chunk.chunkUid,
      chunkCode: chunk.chunkCode,
      section: chunk.section,
      inputTokens: generated.inputTokens,
      outputTokens: generated.outputTokens,
      inputChars,
      elementMetrics: computeMetrics(expected.length, candidates.length, matched),
      relationCount: validation.candidateSet?.relations.length ?? 0,
      errors: validation.errors,
      missedTitles,
      extraTitles,
      durationMs
    })
  }
  onProgress?.(95, '評価レポートを構築中')
  const totals = {
    elementMetrics: computeMetrics(
      results.reduce((sum, row) => sum + row.elementMetrics.expected, 0),
      results.reduce((sum, row) => sum + row.elementMetrics.produced, 0),
      results.reduce((sum, row) => sum + row.elementMetrics.matched, 0)
    ),
    inputTokens: results.reduce((sum, row) => sum + (row.inputTokens ?? 0), 0),
    outputTokens: results.reduce((sum, row) => sum + (row.outputTokens ?? 0), 0),
    inputChars: results.reduce((sum, row) => sum + row.inputChars, 0),
    durationMs: results.reduce((sum, row) => sum + row.durationMs, 0)
  }
  return { chunks: results, totals }
}

export function buildConversionEvalMarkdown(result: ConversionEvalResult): string {
  const lines = [
    '# 評価①レポート: 入力文書→設計モデルの LLM 変換精度（EVAL-002）',
    '',
    `- 実行日時: ${new Date().toISOString()}`,
    `- 対象チャンク: ${result.chunks.length}件`,
    `- 総入力トークン: ${result.totals.inputTokens}（総入力文字数: ${result.totals.inputChars}）`,
    `- 総出力トークン: ${result.totals.outputTokens}`,
    `- 総所要時間: ${result.totals.durationMs}ms`,
    `- 要素正答率: 適合率 ${percent(result.totals.elementMetrics.precision)} / 再現率 ${percent(result.totals.elementMetrics.recall)} / F1 ${result.totals.elementMetrics.f1.toFixed(3)}`,
    '',
    '## チャンク別結果',
    '',
    '| chunk | セクション | 期待 | 生成 | 一致 | 適合率 | 再現率 | F1 | 入力tok | 出力tok | 時間ms |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...result.chunks.map(
      (row) =>
        `| ${row.chunkCode} | ${row.section} | ${row.elementMetrics.expected} | ${row.elementMetrics.produced} | ${row.elementMetrics.matched} | ${percent(row.elementMetrics.precision)} | ${percent(row.elementMetrics.recall)} | ${row.elementMetrics.f1.toFixed(3)} | ${row.inputTokens ?? '-'} | ${row.outputTokens ?? '-'} | ${row.durationMs} |`
    ),
    ''
  ]
  for (const row of result.chunks) {
    if (row.missedTitles.length === 0 && row.extraTitles.length === 0 && row.errors.length === 0) continue
    lines.push(`### ${row.chunkCode}（${row.section}）の差分`, '')
    if (row.missedTitles.length > 0) lines.push(`- 未生成（期待にあり）: ${row.missedTitles.join(', ')}`)
    if (row.extraTitles.length > 0) lines.push(`- 過剰生成（期待になし）: ${row.extraTitles.join(', ')}`)
    if (row.errors.length > 0) lines.push(`- 出力検証エラー: ${row.errors.join(' / ')}`)
    lines.push('')
  }
  lines.push(
    '## チューニング指針（検討課題A/B）',
    '',
    '- 入力トークンが多いチャンクは、チャンク分割・既存情報（用語集・既存モデル）添付の取捨選択を見直してください。',
    '- 再現率が低いセクションは、プロンプトテンプレート（画面別プロンプト設定）とチャンク追加プロンプトを調整してください。',
    ''
  )
  return lines.join('\n')
}

// ---- 評価②: 影響分析精度（EVAL-003） ----

export interface ImpactCaseResult {
  key: string
  name: string
  dsl: string
  durationMs: number
  metrics: EvalMetrics
  missedTitles: string[]
  extraTitles: string[]
  pathCount: number
}

export interface ImpactEvalResult {
  cases: ImpactCaseResult[]
  totals: { metrics: EvalMetrics; durationMs: number }
}

/** 評価②を実行する（EVAL-003）。サンプル変更ケースの DSL を実行し期待影響集合と照合する */
export function runImpactEval(db: Database, projectUid: string, rootPath: string): ImpactEvalResult {
  const uidMap = getProjectSettings(rootPath)[SAMPLE_ELEMENT_SETTING_KEY]
  if (typeof uidMap !== 'object' || uidMap === null) {
    throw new BackendError(
      'validation',
      '評価用サンプルデータが未投入です（サンプルデータ投入を先に実行してください）',
      ''
    )
  }
  const uidByKey = uidMap as Record<string, string>
  const titleByUid = new Map(
    (
      db
        .prepare(`SELECT uid, title FROM entity_registry WHERE project_uid = ? AND status <> 'deleted'`)
        .all(projectUid) as { uid: string; title: string | null }[]
    ).map((row) => [row.uid, row.title ?? ''])
  )

  const cases: ImpactCaseResult[] = []
  for (const impactCase of SAMPLE_IMPACT_CASES) {
    const startUid = uidByKey[impactCase.startKey]
    const endUid = impactCase.endKey ? uidByKey[impactCase.endKey] : undefined
    if (!startUid || (impactCase.endKey && !endUid)) {
      throw new BackendError('validation', `サンプル要素が見つかりません: ${impactCase.startKey}`, '')
    }
    const startedAt = Date.now()
    const result = runAnalysis(db, projectUid, {
      name: impactCase.name,
      dsl: impactCase.dsl,
      startUid,
      endUid
    })
    const durationMs = Date.now() - startedAt

    const expectedUids = new Set(impactCase.expectedKeys.map((key) => uidByKey[key]).filter(Boolean) as string[])
    const actualUids = new Set(result.elements.map((element) => element.uid))
    let matched = 0
    const missedTitles: string[] = []
    for (const uid of expectedUids) {
      if (actualUids.has(uid)) matched++
      else missedTitles.push(titleByUid.get(uid) ?? uid)
    }
    const extraTitles = [...actualUids].filter((uid) => !expectedUids.has(uid)).map((uid) => titleByUid.get(uid) ?? uid)
    cases.push({
      key: impactCase.key,
      name: impactCase.name,
      dsl: impactCase.dsl,
      durationMs,
      metrics: computeMetrics(expectedUids.size, actualUids.size, matched),
      missedTitles,
      extraTitles,
      pathCount: result.paths.length
    })
  }
  const totals = {
    metrics: computeMetrics(
      cases.reduce((sum, row) => sum + row.metrics.expected, 0),
      cases.reduce((sum, row) => sum + row.metrics.produced, 0),
      cases.reduce((sum, row) => sum + row.metrics.matched, 0)
    ),
    durationMs: cases.reduce((sum, row) => sum + row.durationMs, 0)
  }
  return { cases, totals }
}

export function buildImpactEvalMarkdown(result: ImpactEvalResult): string {
  const lines = [
    '# 評価②レポート: 設計モデル影響範囲の分析精度（EVAL-003）',
    '',
    `- 実行日時: ${new Date().toISOString()}`,
    `- 変更ケース: ${result.cases.length}件`,
    `- 総分析時間: ${result.totals.durationMs}ms`,
    `- 影響範囲正答率: 適合率 ${percent(result.totals.metrics.precision)} / 再現率 ${percent(result.totals.metrics.recall)} / F1 ${result.totals.metrics.f1.toFixed(3)}`,
    '',
    '## ケース別結果',
    '',
    '| ケース | 期待 | 抽出 | 一致 | 適合率 | 再現率 | F1 | 経路 | 時間ms |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...result.cases.map(
      (row) =>
        `| ${row.name} | ${row.metrics.expected} | ${row.metrics.produced} | ${row.metrics.matched} | ${percent(row.metrics.precision)} | ${percent(row.metrics.recall)} | ${row.metrics.f1.toFixed(3)} | ${row.pathCount} | ${row.durationMs} |`
    ),
    ''
  ]
  for (const row of result.cases) {
    lines.push(`### ${row.name}`, '', '```', row.dsl, '```', '')
    if (row.missedTitles.length > 0) lines.push(`- 未抽出（期待にあり）: ${row.missedTitles.join(', ')}`)
    if (row.extraTitles.length > 0) lines.push(`- 過剰抽出（期待になし）: ${row.extraTitles.join(', ')}`)
    if (row.missedTitles.length === 0 && row.extraTitles.length === 0) lines.push('- 期待影響集合と完全一致')
    lines.push('')
  }
  lines.push(
    '## チューニング指針（検討課題A/B）',
    '',
    '- 未抽出が多い場合は TRAVERSE の関係種別・方向・DEPTH を広げてください。',
    '- 過剰抽出が多い場合は FILTER / WHERE / SET EXCEPT による絞り込みを追加してください。',
    '- 分析時間が長い場合は DEPTH・LIMIT の上限と FROM TYPE による初期集合の限定を検討してください。',
    ''
  )
  return lines.join('\n')
}
