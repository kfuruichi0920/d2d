/**
 * ②抽出データの派生 Markdown 生成（P5-5、EXT-018/019）。
 * structure_json からレビュー用（アンカー付き）と LLM 入力用（クリーン）を再生成する。
 * Markdown は派生成果物であり正本ではない（正本は structure_json + resource_*）。
 */
import type { ExtractionElement } from './store-extraction'

export type MarkdownVariant = 'review' | 'clean'

interface StructureElement extends ExtractionElement {
  resource_uid?: string
}

function escapeCell(text: string): string {
  return text.replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

export function generateMarkdown(elements: StructureElement[], variant: MarkdownVariant): string {
  const lines: string[] = []
  let pendingListGap = false

  const anchor = (e: StructureElement): string => (variant === 'review' ? ` <!-- ${e.id} -->` : '')

  for (const e of elements) {
    if (e.type !== 'list_item' && pendingListGap) {
      lines.push('')
      pendingListGap = false
    }
    switch (e.type) {
      case 'heading':
        lines.push(`${'#'.repeat(Math.min(e.level ?? 1, 6))} ${e.text ?? ''}${anchor(e)}`)
        lines.push('')
        break
      case 'paragraph':
        lines.push(`${e.text ?? ''}${anchor(e)}`)
        lines.push('')
        break
      case 'list_item':
        lines.push(`${'  '.repeat(e.level ?? 0)}- ${e.text ?? ''}${anchor(e)}`)
        pendingListGap = true
        break
      case 'caption':
        lines.push(`*${e.text ?? ''}*${anchor(e)}`)
        lines.push('')
        break
      case 'figure':
        // 画像はレビュー表示では参照情報のみ（実表示は Original/図リソースビューで行う）
        lines.push(variant === 'review' ? `![図](${e.image ?? ''})${anchor(e)}` : `（図: ${e.image ?? ''}）`)
        lines.push('')
        break
      case 'shape':
      case 'group_shape':
      case 'connector':
        if (e.text) {
          lines.push(`${e.text}${anchor(e)}`)
          lines.push('')
        }
        break
      case 'table': {
        const rows = e.rows ?? []
        if (rows.length === 0) break
        const colCount = Math.max(...rows.map((r) => r.reduce((n, c) => n + (c.colspan ?? 1), 0)))
        const toCells = (row: { text: string; colspan?: number }[]): string[] => {
          const cells: string[] = []
          for (const cell of row) {
            cells.push(escapeCell(cell.text))
            for (let i = 1; i < (cell.colspan ?? 1); i++) cells.push('')
          }
          while (cells.length < colCount) cells.push('')
          return cells
        }
        // アンカーを表ヘッダ行に付けると GFM 表として解釈されないため、表の前に独立行で置く
        if (variant === 'review') {
          lines.push(`<!-- ${e.id} -->`)
          lines.push('')
        }
        lines.push(`| ${toCells(rows[0]!).join(' | ')} |`)
        lines.push(`|${' --- |'.repeat(colCount)}`)
        for (const row of rows.slice(1)) {
          lines.push(`| ${toCells(row).join(' | ')} |`)
        }
        lines.push('')
        break
      }
    }
  }
  if (pendingListGap) lines.push('')
  return (
    lines
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trimEnd() + '\n'
  )
}
