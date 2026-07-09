/**
 * Markdown プレビュー（P3-6、sdd_tech_stack §3）。
 * marked でレンダリングし、表示前に必ず DOMPurify でサニタイズする。
 */
import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function MarkdownPreview({ markdown }: { markdown: string }): React.JSX.Element {
  const html = useMemo(() => {
    const raw = marked.parse(markdown, { async: false })
    return DOMPurify.sanitize(raw)
  }, [markdown])

  return (
    <div
      className="d2d-markdown"
      style={{ padding: '8px 14px', lineHeight: 1.7 }}
      // DOMPurify でサニタイズ済み
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
