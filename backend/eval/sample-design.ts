/**
 * 評価用サンプルプロジェクト「温度監視装置」の設計データ定義（EVAL-001）。
 * 入力文書（要求仕様書・方式設計書）の本文、期待値となる④設計モデル・関係、
 * 仕様変更3ケースの期待影響範囲をツール側で腹持ちする。
 *
 * - 評価①（LLM変換精度）: 各セクション（=チャンク）から生成されるべき要素の期待値
 * - 評価②（影響分析精度）: 変更ケースごとの起点・DSL・期待影響集合
 */

export interface SampleElement {
  key: string
  modelType: string
  title: string
  summary: string
  /** 所属セクション（チャンク単位。評価①の期待値グルーピング） */
  section: SampleSectionKey
}

export interface SampleRelation {
  from: string
  relation: string
  to: string
  allocationKind?: string
  usageKind?: string
}

export interface SampleImpactCase {
  key: string
  name: string
  description: string
  startKey: string
  endKey?: string
  dsl: string
  /** 期待影響集合（起点を含む） */
  expectedKeys: string[]
}

export type SampleSectionKey = 'req' | 'cst' | 'verif' | 'func' | 'struct' | 'ifdata' | 'behstate'

export interface SampleSection {
  key: SampleSectionKey
  docIndex: 0 | 1
  heading: string
}

export const SAMPLE_PROJECT_TITLE = '温度監視装置'
export const SAMPLE_DOC_TITLES = ['温度監視装置 要求仕様書', '温度監視装置 方式設計書'] as const

export const SAMPLE_SECTIONS: SampleSection[] = [
  { key: 'req', docIndex: 0, heading: '2. 要求事項' },
  { key: 'cst', docIndex: 0, heading: '3. 制約条件' },
  { key: 'verif', docIndex: 0, heading: '4. 検証要求' },
  { key: 'func', docIndex: 1, heading: '2. 機能設計' },
  { key: 'struct', docIndex: 1, heading: '3. 構造設計' },
  { key: 'ifdata', docIndex: 1, heading: '4. インタフェース・データ設計' },
  { key: 'behstate', docIndex: 1, heading: '5. 振舞・状態設計' }
]

const e = (
  key: string,
  modelType: string,
  title: string,
  summary: string,
  section: SampleSectionKey
): SampleElement => ({
  key,
  modelType,
  title,
  summary,
  section
})

export const SAMPLE_ELEMENTS: SampleElement[] = [
  // 要求（model_req）
  e('req_measure', 'model_req', '温度計測', '装置は接続された温度センサの温度を1秒周期で計測すること。', 'req'),
  e('req_upper_alarm', 'model_req', '上限警報', '計測温度が上限しきい値を超えた場合、警報を出力すること。', 'req'),
  e('req_lower_alarm', 'model_req', '下限警報', '計測温度が下限しきい値を下回った場合、警報を出力すること。', 'req'),
  e('req_log', 'model_req', 'ログ記録', '計測温度と警報履歴を不揮発メモリへ記録すること。', 'req'),
  e('req_notify', 'model_req', '上位通知', '警報発生時に上位システムへ通知メッセージを送信すること。', 'req'),
  e('req_diag', 'model_req', '自己診断', '起動時に温度センサと記憶部の自己診断を実施すること。', 'req'),
  e('req_response', 'model_req', '警報応答時間', '警報判定から警報出力までを500ミリ秒以内で完了すること。', 'req'),
  e('req_accuracy', 'model_req', '計測精度', '温度計測の誤差を±0.5℃以内とすること。', 'req'),
  // 制約（model_cst）
  e('cst_temp_range', 'model_cst', '動作温度範囲', '装置の動作温度範囲は-10℃から+55℃とする。', 'cst'),
  e('cst_power', 'model_cst', '電源電圧', '装置はDC24V±10%で動作すること。', 'cst'),
  e('cst_protocol', 'model_cst', '通信規格', '上位システムとの通信はModbus TCPに準拠すること。', 'cst'),
  // 検証情報（model_verif）
  e('verif_accuracy', 'model_verif', '計測精度試験', '基準温度槽で±0.5℃以内の計測精度を確認する。', 'verif'),
  e('verif_alarm', 'model_verif', '警報試験', 'しきい値超過・復帰時の警報出力を確認する。', 'verif'),
  e('verif_log', 'model_verif', 'ログ試験', '計測値と警報履歴の記録・読出を確認する。', 'verif'),
  e('verif_comm', 'model_verif', '通信試験', 'Modbus TCPによる上位通知を確認する。', 'verif'),
  e('verif_diag', 'model_verif', '診断試験', '起動時自己診断の検出動作を確認する。', 'verif'),
  e(
    'verif_response',
    'model_verif',
    '応答時間試験',
    '警報判定から出力までの時間を計測し500ミリ秒以内を確認する。',
    'verif'
  ),
  // 機能（model_func）
  e('func_acquire', 'model_func', '温度取得機能', '温度センサから計測値を周期取得し温度データへ格納する。', 'func'),
  e('func_judge', 'model_func', '温度判定機能', '温度データをしきい値と比較し警報要否を判定する。', 'func'),
  e('func_alarm', 'model_func', '警報出力機能', '判定結果に応じて警報出力部を駆動する。', 'func'),
  e('func_log', 'model_func', 'ログ保存機能', '計測値と警報イベントをログレコードとして記憶部へ保存する。', 'func'),
  e('func_notify', 'model_func', '通知送信機能', '警報発生時に通信IF経由で上位システムへ通知する。', 'func'),
  e('func_diag', 'model_func', '自己診断機能', '起動時にセンサ・記憶部の診断を実行する。', 'func'),
  e('func_config', 'model_func', '設定管理機能', 'しきい値等の設定データを管理する。', 'func'),
  e('func_clock', 'model_func', '時刻管理機能', 'ログ記録に使用する時刻を管理する。', 'func'),
  // 構造（model_struct）
  e('struct_board', 'model_struct', '制御基板', '計測・判定・診断を実行する制御基板。', 'struct'),
  e('struct_sensor', 'model_struct', '温度センサ部', '温度を検出するセンサモジュール。', 'struct'),
  e('struct_alarm', 'model_struct', '警報出力部', 'ブザー・表示灯を駆動する警報出力回路。', 'struct'),
  e('struct_comm', 'model_struct', '通信モジュール', '上位システムと通信するEthernetモジュール。', 'struct'),
  e('struct_storage', 'model_struct', '記憶部', 'ログと設定を保持する不揮発メモリ。', 'struct'),
  e('struct_power', 'model_struct', '電源部', 'DC24Vから内部電源を生成する電源回路。', 'struct'),
  // インタフェース（model_if）・データ（model_data）
  e('if_sensor', 'model_if', 'センサIF', '温度センサとの入力インタフェース。', 'ifdata'),
  e('if_comm', 'model_if', '通信IF', '上位システムとのModbus TCPインタフェース。', 'ifdata'),
  e('if_alarm', 'model_if', '警報IF', '警報出力部への駆動インタフェース。', 'ifdata'),
  e('if_maint', 'model_if', '保守IF', '保守端末との診断用インタフェース。', 'ifdata'),
  e('data_temp', 'model_data', '温度データ', '最新計測値と計測時刻を保持するデータ。', 'ifdata'),
  e('data_log', 'model_data', 'ログレコード', '計測値・警報イベントの履歴レコード。', 'ifdata'),
  e('data_config', 'model_data', '設定データ', 'しきい値・通知先等の設定値。', 'ifdata'),
  // 振舞（model_beh）・状態（model_state）
  e('beh_cycle', 'model_beh', '計測周期処理', '1秒周期で温度取得から判定までを実行する処理。', 'behstate'),
  e('beh_alarm_seq', 'model_beh', '警報シーケンス', '警報判定から出力・通知・記録までの一連の処理。', 'behstate'),
  e('beh_boot_diag', 'model_beh', '起動診断シーケンス', '電源投入時に自己診断を実行する処理。', 'behstate'),
  e('state_ope', 'model_state', '運転状態モデル', '起動中・監視中・停止の運転状態と遷移。', 'behstate'),
  e('state_alarm', 'model_state', '警報状態モデル', '正常・警報中・復帰待ちの警報状態と遷移。', 'behstate')
]

export const SAMPLE_RELATIONS: SampleRelation[] = [
  // satisfies（充足）
  { from: 'func_acquire', relation: 'satisfies', to: 'req_measure' },
  { from: 'func_acquire', relation: 'satisfies', to: 'req_accuracy' },
  { from: 'func_judge', relation: 'satisfies', to: 'req_upper_alarm' },
  { from: 'func_judge', relation: 'satisfies', to: 'req_lower_alarm' },
  { from: 'func_alarm', relation: 'satisfies', to: 'req_upper_alarm' },
  { from: 'func_alarm', relation: 'satisfies', to: 'req_lower_alarm' },
  { from: 'func_alarm', relation: 'satisfies', to: 'req_response' },
  { from: 'func_log', relation: 'satisfies', to: 'req_log' },
  { from: 'func_notify', relation: 'satisfies', to: 'req_notify' },
  { from: 'func_notify', relation: 'satisfies', to: 'cst_protocol' },
  { from: 'func_diag', relation: 'satisfies', to: 'req_diag' },
  { from: 'beh_alarm_seq', relation: 'satisfies', to: 'req_response' },
  { from: 'struct_power', relation: 'satisfies', to: 'cst_power' },
  { from: 'struct_sensor', relation: 'satisfies', to: 'cst_temp_range' },
  // allocated_to（割当。allocation_kind 必須）
  { from: 'func_acquire', relation: 'allocated_to', to: 'struct_board', allocationKind: 'structure' },
  { from: 'func_judge', relation: 'allocated_to', to: 'struct_board', allocationKind: 'structure' },
  { from: 'func_judge', relation: 'allocated_to', to: 'beh_cycle', allocationKind: 'behavior' },
  { from: 'func_alarm', relation: 'allocated_to', to: 'struct_alarm', allocationKind: 'structure' },
  { from: 'func_log', relation: 'allocated_to', to: 'struct_storage', allocationKind: 'structure' },
  { from: 'func_notify', relation: 'allocated_to', to: 'struct_comm', allocationKind: 'structure' },
  { from: 'func_diag', relation: 'allocated_to', to: 'struct_board', allocationKind: 'structure' },
  { from: 'func_config', relation: 'allocated_to', to: 'struct_storage', allocationKind: 'structure' },
  { from: 'func_clock', relation: 'allocated_to', to: 'struct_board', allocationKind: 'structure' },
  { from: 'beh_alarm_seq', relation: 'allocated_to', to: 'state_alarm', allocationKind: 'state' },
  // uses（利用。usage_kind 必須）
  { from: 'func_acquire', relation: 'uses', to: 'if_sensor', usageKind: 'input' },
  { from: 'func_acquire', relation: 'uses', to: 'data_temp', usageKind: 'write' },
  { from: 'func_judge', relation: 'uses', to: 'data_temp', usageKind: 'read' },
  { from: 'func_judge', relation: 'uses', to: 'data_config', usageKind: 'read' },
  { from: 'func_alarm', relation: 'uses', to: 'if_alarm', usageKind: 'output' },
  { from: 'func_log', relation: 'uses', to: 'data_log', usageKind: 'write' },
  { from: 'func_log', relation: 'uses', to: 'data_temp', usageKind: 'read' },
  { from: 'func_notify', relation: 'uses', to: 'if_comm', usageKind: 'output' },
  { from: 'func_config', relation: 'uses', to: 'data_config', usageKind: 'write' },
  { from: 'func_diag', relation: 'uses', to: 'if_maint', usageKind: 'output' },
  { from: 'beh_cycle', relation: 'uses', to: 'state_ope', usageKind: 'read' },
  { from: 'if_comm', relation: 'uses', to: 'data_log', usageKind: 'read' },
  // verifies（検証）
  { from: 'verif_accuracy', relation: 'verifies', to: 'req_accuracy' },
  { from: 'verif_alarm', relation: 'verifies', to: 'req_upper_alarm' },
  { from: 'verif_alarm', relation: 'verifies', to: 'req_lower_alarm' },
  { from: 'verif_alarm', relation: 'verifies', to: 'func_alarm' },
  { from: 'verif_log', relation: 'verifies', to: 'req_log' },
  { from: 'verif_comm', relation: 'verifies', to: 'req_notify' },
  { from: 'verif_comm', relation: 'verifies', to: 'cst_protocol' },
  { from: 'verif_diag', relation: 'verifies', to: 'req_diag' },
  { from: 'verif_response', relation: 'verifies', to: 'req_response' },
  // contains（包含。同一種別のみ）
  { from: 'state_ope', relation: 'contains', to: 'state_alarm' }
]

/** 評価②の仕様変更ケース（EVAL-003）。期待影響集合は SAMPLE_RELATIONS と整合させて手計算済み */
export const SAMPLE_IMPACT_CASES: SampleImpactCase[] = [
  {
    key: 'case_upper_alarm',
    name: '上限警報しきい値の仕様変更',
    description: '上限警報要求のしきい値仕様が変更された場合の影響確認範囲。',
    startKey: 'req_upper_alarm',
    dsl: ['TRAVERSE satisfies,verifies UP', 'TRAVERSE allocated_to DOWN'].join('\n'),
    expectedKeys: [
      'req_upper_alarm',
      'func_judge',
      'func_alarm',
      'verif_alarm',
      'struct_board',
      'struct_alarm',
      'beh_cycle'
    ]
  },
  {
    key: 'case_protocol',
    name: '通信規格の変更',
    description: '通信規格制約（Modbus TCP）が別規格へ変更された場合の影響確認範囲。',
    startKey: 'cst_protocol',
    dsl: ['TRAVERSE satisfies,verifies UP', 'TRAVERSE allocated_to,uses DOWN'].join('\n'),
    expectedKeys: ['cst_protocol', 'func_notify', 'verif_comm', 'struct_comm', 'if_comm']
  },
  {
    key: 'case_log_path',
    name: 'ログ記録要求と記憶部の経路確認',
    description: 'ログ記録要求から記憶部への意味的経路の確認。',
    startKey: 'req_log',
    endKey: 'struct_storage',
    dsl: 'PATH * MAXDEPTH 2 LIMIT 20',
    expectedKeys: ['req_log', 'func_log', 'struct_storage']
  }
]

/** 評価①の期待値: セクション（チャンク）ごとに生成されるべき設計モデル要素 */
export function expectedElementsBySection(section: SampleSectionKey): SampleElement[] {
  return SAMPLE_ELEMENTS.filter((element) => element.section === section)
}

/** 文書本文の生成元。見出し＋要素説明の段落で構成する */
export function buildDocumentOutline(docIndex: 0 | 1): {
  title: string
  blocks: { heading?: string; text?: string; section?: SampleSectionKey }[]
} {
  const blocks: { heading?: string; text?: string; section?: SampleSectionKey }[] = []
  if (docIndex === 0) {
    blocks.push({ heading: '1. 概要' })
    blocks.push({
      text: '本書は温度監視装置の要求仕様を定める。本装置は設備の温度を常時監視し、異常時に警報と上位通知を行う。'
    })
  } else {
    blocks.push({ heading: '1. 方式概要' })
    blocks.push({
      text: '本書は温度監視装置の方式設計を定める。要求仕様書で定めた要求を実現する機能・構造・インタフェース・振舞を記述する。'
    })
  }
  for (const section of SAMPLE_SECTIONS.filter((candidate) => candidate.docIndex === docIndex)) {
    blocks.push({ heading: section.heading, section: section.key })
    for (const element of expectedElementsBySection(section.key)) {
      blocks.push({ text: `【${element.title}】${element.summary}`, section: section.key })
    }
  }
  return { title: SAMPLE_DOC_TITLES[docIndex], blocks }
}
