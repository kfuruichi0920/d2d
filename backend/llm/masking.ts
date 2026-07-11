/**
 * 機密情報マスキング（P6-4、LLM-041、NFR-023）。
 * 外部送信前にメッセージへ適用する。組込パターン + 設定の追加パターン。
 */
import type { ChatMessage } from './providers'

export const MASK_PLACEHOLDER = '«masked»'

/** 組込マスキングパターン（APIキー・トークン類の典型形式） */
const BUILTIN_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI 形式キー
  /AIza[A-Za-z0-9_-]{30,}/g, // Google API キー
  /Bearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
  /(?:api[_-]?key|token|password)\s*[:=]\s*\S+/gi
]

export function compileMaskPatterns(customPatterns: string[]): RegExp[] {
  const custom: RegExp[] = []
  for (const p of customPatterns) {
    try {
      custom.push(new RegExp(p, 'g'))
    } catch {
      // 不正な正規表現は無視（設定検証は UI 側で行う）
    }
  }
  return [...BUILTIN_PATTERNS, ...custom]
}

export function maskText(text: string, patterns: RegExp[]): { masked: string; hitCount: number } {
  let masked = text
  let hitCount = 0
  for (const pattern of patterns) {
    masked = masked.replace(pattern, () => {
      hitCount++
      return MASK_PLACEHOLDER
    })
  }
  return { masked, hitCount }
}

export function maskMessages(
  messages: ChatMessage[],
  customPatterns: string[] = []
): { messages: ChatMessage[]; hitCount: number } {
  const patterns = compileMaskPatterns(customPatterns)
  let total = 0
  const maskedMessages = messages.map((m) => {
    const { masked, hitCount } = maskText(m.content, patterns)
    total += hitCount
    return { ...m, content: masked }
  })
  return { messages: maskedMessages, hitCount: total }
}
