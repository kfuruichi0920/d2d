/**
 * Markdown プレビュー（P3-6 / P10-1、EDIT-011/015/054/056）。
 * - marked でレンダリングし、表示前に必ず DOMPurify でサニタイズする
 * - 承認済み用語を <mark> でハイライトし、title に定義を表示する（EDIT-056）
 * - 設計要素コード（REQ-000001 等）をクリック可能なリンクにする（EDIT-015）
 */
import { useMemo } from 'react'
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { invoke } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'

export interface GlossaryHighlightTerm {
  term: string
  definition: string | null
}

const CODE_PATTERN = /\b(?:STD|REQ|CST|FUNC|STRUCT|BEH|STATE|IF|DATA|VERIF|MGMT|IMPL)-\d{6}\b/g

/** サニタイズ済み HTML のテキストノードに用語ハイライトと要素リンクを適用する */
function decorate(html: string, terms: GlossaryHighlightTerm[]): string {
  const doc = new DOMParser().parseFromString(`<div id="root">${html}</div>`, 'text/html')
  const root = doc.getElementById('root')!
  const defByTerm = new Map(terms.map((t) => [t.term, t.definition ?? '']))
  const termPattern =
    terms.length > 0 ? new RegExp(terms.map((t) => t.term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g') : null

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement?.closest('mark, a, code')) continue
    textNodes.push(node as Text)
  }

  for (const textNode of textNodes) {
    const text = textNode.textContent ?? ''
    if (!text.trim()) continue
    const fragments: (string | HTMLElement)[] = []
    let cursor = 0

    // 用語 + 要素コードのマッチ位置を統合して昇順に処理する
    const matches: { index: number; length: number; kind: 'term' | 'code'; value: string }[] = []
    if (termPattern) {
      for (const m of text.matchAll(termPattern)) {
        matches.push({ index: m.index, length: m[0].length, kind: 'term', value: m[0] })
      }
    }
    for (const m of text.matchAll(CODE_PATTERN)) {
      matches.push({ index: m.index, length: m[0].length, kind: 'code', value: m[0] })
    }
    if (matches.length === 0) continue
    matches.sort((a, b) => a.index - b.index)

    for (const match of matches) {
      if (match.index < cursor) continue // 重なりはスキップ
      fragments.push(text.slice(cursor, match.index))
      if (match.kind === 'term') {
        const mark = doc.createElement('mark')
        mark.className = 'd2d-term'
        mark.title = defByTerm.get(match.value) || '用語集に登録済み'
        mark.textContent = match.value
        fragments.push(mark)
      } else {
        const anchor = doc.createElement('a')
        anchor.setAttribute('data-design-code', match.value)
        anchor.setAttribute('href', '#')
        anchor.textContent = match.value
        fragments.push(anchor)
      }
      cursor = match.index + match.length
    }
    fragments.push(text.slice(cursor))

    const parent = textNode.parentNode!
    for (const fragment of fragments) {
      parent.insertBefore(typeof fragment === 'string' ? doc.createTextNode(fragment) : fragment, textNode)
    }
    parent.removeChild(textNode)
  }
  return root.innerHTML
}

export function MarkdownPreview({
  markdown,
  terms = []
}: {
  markdown: string
  terms?: GlossaryHighlightTerm[]
}): React.JSX.Element {
  const openResource = useEditorStore((s) => s.openResource)

  const html = useMemo(() => {
    const raw = marked.parse(markdown, { async: false })
    const sanitized = DOMPurify.sanitize(raw)
    return decorate(sanitized, terms)
  }, [markdown, terms])

  const onClick = async (e: React.MouseEvent): Promise<void> => {
    const target = (e.target as HTMLElement).closest('a[data-design-code]')
    if (!target) return
    e.preventDefault()
    const code = target.getAttribute('data-design-code')!
    const res = await invoke<{ uid: string }[]>('design.listElements')
    if (res.ok) {
      const element = (res.result as { uid: string; code: string }[]).find((el) => el.code === code)
      if (element) openResource(`design://${element.uid}`, code, { preview: true })
    }
  }

  return (
    <div
      className="d2d-markdown"
      style={{ padding: '8px 14px', lineHeight: 1.7 }}
      onClick={(e) => void onClick(e)}
      // DOMPurify でサニタイズ後、自前 DOM 加工のみ適用済み
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
