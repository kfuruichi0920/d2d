// 機密情報マスキング: テキストを LLM 送信前にサニタイズする

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, '[EMAIL]'],
  [/\b(?:\+?81|0)\d{1,4}[-\s]?\d{1,4}[-\s]?\d{4}\b/g, '[PHONE]'],
  [/\b(?:\d{4}[-\s]?){3}\d{4}\b/g, '[CARD]'],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]'],
  [/(?:password|passwd|secret|api[_-]?key|token)\s*[=:]\s*\S+/gi, '[CREDENTIAL]'],
  [/\b(?:sk-|rk-|pk-)[A-Za-z0-9_-]{20,}/g, '[API_KEY]'],
]

export interface MaskResult {
  masked: string
  /** マスクした箇所の数 */
  maskCount: number
  /** 変換前後マップ（復元には使わない — ログ用） */
  changes: string[]
}

export function maskSensitiveData(text: string): MaskResult {
  let masked = text
  let maskCount = 0
  const changes: string[] = []

  for (const [pattern, label] of SECRET_PATTERNS) {
    const orig = masked
    masked = masked.replace(pattern, (m) => {
      changes.push(`${m.slice(0, 4)}… → ${label}`)
      maskCount++
      return label
    })
    if (masked !== orig) {
      pattern.lastIndex = 0
    }
  }

  return { masked, maskCount, changes }
}

export function buildUserConfirmSummary(text: string): string {
  const result = maskSensitiveData(text)
  if (result.maskCount === 0) return ''
  return (
    `以下の情報が含まれています（マスキング対象）:\n` +
    result.changes.map((c) => `  - ${c}`).join('\n')
  )
}
