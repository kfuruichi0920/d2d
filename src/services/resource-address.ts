/** WorkbenchアドレスバーのResource URI検証（P3-7、UI-046）。 */
const RESOURCE_ADDRESS_PATTERNS: Array<{ pattern: RegExp; title: string }> = [
  { pattern: /^project:\/\/current$/, title: 'ダッシュボード' },
  { pattern: /^stage:\/\/(source|extracted|intermediate|design)$/, title: 'ステージ一覧' },
  { pattern: /^settings:\/\/tool$/, title: 'ツール設定' },
  { pattern: /^project-settings:\/\/current$/, title: 'プロジェクト設定' },
  { pattern: /^help:\/\/(workflow|schema|design-model)$/, title: 'ヘルプ' },
  { pattern: /^(original|extracted|intermediate|chunk|candidate|design|resource):\/\/[^\s/]+$/, title: 'Resource' },
  { pattern: /^log:\/\/(job|llm)\/[^\s/]+$/, title: 'ログ' },
  { pattern: /^trace:\/\/(?:graph|matrix)\/[^\s]+$/, title: 'トレーサビリティ' },
  { pattern: /^trace:\/\/list-link(?:\/[^\s]+)?$/, title: 'トレーサビリティ' },
  { pattern: /^glossary:\/\/[^\s]*$/, title: '用語集' },
  { pattern: /^model:\/\/playground$/, title: 'モデルエディタ' },
  { pattern: /^diff:\/\/(archive|git\/[^\s/]+)$/, title: '差分' },
  { pattern: /^store:\/\/tables$/, title: 'ストア閲覧' },
  { pattern: /^report:\/\/[^\s]+$/, title: 'レポート' }
]

export function resolveResourceAddress(input: string): { uri: string; title: string } | null {
  const uri = input.trim()
  if (!uri) return null
  const matched = RESOURCE_ADDRESS_PATTERNS.find(({ pattern }) => pattern.test(uri))
  return matched ? { uri, title: matched.title } : null
}
