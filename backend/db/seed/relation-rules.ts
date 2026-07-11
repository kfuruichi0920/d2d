/**
 * relation_rule_master 初期データ（P1-6、sdd_data_structure §9.1 / srs §9.4）。
 * source_category / target_category は entity_registry.design_category（設計13分類）で解決する。
 * 「any」は全分類を許容するワイルドカード行として ANY を用いる（検査ロジック側で解釈する）。
 */
import type { Database } from 'better-sqlite3'

export interface RelationRule {
  relationType: string
  sourceCategory: string
  targetCategory: string
  allowed: 1 | 0
  requiredAttr: string | null
  description: string
}

const ALL = ['STD', 'REQ', 'CST', 'FUNC', 'STRUCT', 'BEH', 'STATE', 'IF', 'DATA', 'VERIF', 'MGMT', 'IMPL'] as const

function cross(
  relationType: string,
  sources: readonly string[],
  targets: readonly string[],
  requiredAttr: string | null,
  description: string
): RelationRule[] {
  const rules: RelationRule[] = []
  for (const s of sources) {
    for (const t of targets) {
      rules.push({ relationType, sourceCategory: s, targetCategory: t, allowed: 1, requiredAttr, description })
    }
  }
  return rules
}

export function buildRelationRules(): RelationRule[] {
  const rules: RelationRule[] = []

  // based_on: 根拠関係専用。全設計分類 + trace_link から SRC/中間要素/判断根拠へ（srs §9.4）
  rules.push(
    ...cross('based_on', [...ALL, 'SRC'], ['SRC', ...ALL], 'basis_kind', '根拠関係専用。SRCは設計意味関係から除外する')
  )

  // satisfies: 設計要素 → STD/REQ/CST
  rules.push(
    ...cross(
      'satisfies',
      ['FUNC', 'STRUCT', 'BEH', 'STATE', 'IF', 'DATA', 'IMPL'],
      ['STD', 'REQ', 'CST'],
      null,
      '要求・制約・規範への充足関係'
    )
  )

  // allocated_to: REQ/CST/FUNC/BEH → STRUCT/BEH/STATE/IF/DATA
  rules.push(
    ...cross(
      'allocated_to',
      ['REQ', 'CST', 'FUNC', 'BEH'],
      ['STRUCT', 'BEH', 'STATE', 'IF', 'DATA'],
      'allocation_kind',
      '要求・制約・機能・責務の割当'
    )
  )

  // verifies: VERIF → 検証対象
  rules.push(
    ...cross(
      'verifies',
      ['VERIF'],
      ['STD', 'REQ', 'CST', 'FUNC', 'STRUCT', 'BEH', 'STATE', 'IF', 'DATA', 'IMPL'],
      null,
      '検証情報から検証対象へ向ける'
    )
  )

  // contains: 構造的包含に限定
  rules.push(...cross('contains', ['STRUCT', 'DATA', 'IF'], ['STRUCT', 'DATA', 'IF'], null, '構造的包含に限定する'))

  // decomposes: 同種または詳細要素への展開
  for (const c of ['STD', 'REQ', 'CST', 'FUNC', 'BEH', 'STATE', 'IF', 'VERIF', 'MGMT']) {
    rules.push({
      relationType: 'decomposes',
      sourceCategory: c,
      targetCategory: c,
      allowed: 1,
      requiredAttr: 'decomposition_kind',
      description: '上位要素の下位・詳細展開。詳細化は decomposition_kind=refinement'
    })
  }

  // implements: IMPL → 設計要素
  rules.push(
    ...cross('implements', ['IMPL'], ['FUNC', 'STRUCT', 'BEH', 'STATE', 'IF', 'DATA'], null, '実装から設計要素への対応')
  )

  // uses: STRUCT/BEH/STATE/IF → STATE/IF/DATA
  rules.push(
    ...cross(
      'uses',
      ['STRUCT', 'BEH', 'STATE', 'IF'],
      ['STATE', 'IF', 'DATA'],
      'usage_kind',
      '入出力・読書き・発行購読は usage_kind で表す'
    )
  )

  // calls: IMPL/IF/BEH 間
  rules.push(
    ...cross('calls', ['IMPL', 'IF', 'BEH'], ['IMPL', 'IF', 'BEH'], null, '呼び出し関係が明確な場合に限定する')
  )

  // conflicts_with: 任意（ANY ワイルドカード）
  rules.push({
    relationType: 'conflicts_with',
    sourceCategory: 'ANY',
    targetCategory: 'ANY',
    allowed: 1,
    requiredAttr: 'conflict_status',
    description: '文脈依存の競合。context_uid・condition・severity を確認する'
  })

  // relates_to: 任意（暫定リンク専用）
  rules.push({
    relationType: 'relates_to',
    sourceCategory: 'ANY',
    targetCategory: 'ANY',
    allowed: 1,
    requiredAttr: 'review_status',
    description: '暫定リンク専用。レビュー後に他の relation_type へ置換する'
  })

  return rules
}

export function seedRelationRules(db: Database): number {
  const rules = buildRelationRules()
  const insert = db.prepare(
    `INSERT OR IGNORE INTO relation_rule_master
       (relation_type, source_category, target_category, allowed, required_attr, description)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
  const txn = db.transaction((rows: RelationRule[]) => {
    let n = 0
    for (const r of rows) {
      const result = insert.run(
        r.relationType,
        r.sourceCategory,
        r.targetCategory,
        r.allowed,
        r.requiredAttr,
        r.description
      )
      n += result.changes
    }
    return n
  })
  return txn(rules)
}
