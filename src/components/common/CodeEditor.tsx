/**
 * Monaco ベースのコード・テキストエディタ（P3-6、sdd_tech_stack §3）。
 * Markdown / PlantUML / JSON / SQL / ログの閲覧・編集に利用する。
 * Monaco 本体はチャンク分割されるよう動的 import する。
 */
import { useEffect, useRef } from 'react'
import type * as MonacoTypes from 'monaco-editor'
import { useWorkbenchStore } from '../../stores/workbench-store'

let monacoPromise: Promise<typeof import('monaco-editor')> | null = null

async function loadMonaco(): Promise<typeof import('monaco-editor')> {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      // ワーカーは editor 基本ワーカーのみ使用する（言語サービスは必要時に追加）
      const [monaco, { default: EditorWorker }] = await Promise.all([
        import('monaco-editor'),
        import('monaco-editor/esm/vs/editor/editor.worker?worker')
      ])
      self.MonacoEnvironment = {
        getWorker: () => new EditorWorker()
      }
      return monaco
    })()
  }
  return monacoPromise
}

export interface CodeEditorProps {
  value: string
  language?: string
  readOnly?: boolean
  onChange?: (value: string) => void
  height?: number | string
}

export function CodeEditor({
  value,
  language = 'markdown',
  readOnly = false,
  onChange,
  height = '100%'
}: CodeEditorProps): React.JSX.Element {
  const fontSize = useWorkbenchStore((state) => state.theme.fontSize)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoTypes.editor.IStandaloneCodeEditor | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    let disposed = false
    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return
      const isDark = document.documentElement.getAttribute('data-d2d-mode') !== 'light'
      const editor = monaco.editor.create(containerRef.current, {
        value,
        language,
        readOnly,
        theme: isDark ? 'vs-dark' : 'vs',
        minimap: { enabled: false },
        fontSize,
        automaticLayout: true,
        scrollBeyondLastLine: false
      })
      editor.onDidChangeModelContent(() => onChangeRef.current?.(editor.getValue()))
      editorRef.current = editor
    })
    return () => {
      disposed = true
      editorRef.current?.dispose()
      editorRef.current = null
    }
    // 初期化は 1 回のみ（value 変更は下の effect で反映）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize })
  }, [fontSize])

  useEffect(() => {
    const editor = editorRef.current
    if (editor && editor.getValue() !== value) {
      editor.setValue(value)
    }
  }, [value])

  return <div ref={containerRef} style={{ height, width: '100%' }} data-testid="code-editor" />
}
