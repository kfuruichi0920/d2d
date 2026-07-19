/** MathJaxによるTeX数式プレビュー（P7-3、EDIT-086）。 */
import { useEffect, useRef } from 'react'

export function MathJaxPreview({ tex }: { tex: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let disposed = false
    void Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/liteAdaptor.js'),
      import('mathjax-full/js/handlers/html.js')
    ]).then(([{ mathjax }, { TeX }, { SVG }, { liteAdaptor }, { RegisterHTMLHandler }]) => {
      if (disposed || !containerRef.current) return
      const adaptor = liteAdaptor()
      RegisterHTMLHandler(adaptor)
      const document = mathjax.document('', { InputJax: new TeX(), OutputJax: new SVG({ fontCache: 'none' }) })
      const node = document.convert(tex, { display: true })
      containerRef.current.innerHTML = adaptor.outerHTML(node)
    })
    return () => {
      disposed = true
    }
  }, [tex])
  return <div ref={containerRef} className="mathjax-preview" data-testid="mathjax-preview" />
}
