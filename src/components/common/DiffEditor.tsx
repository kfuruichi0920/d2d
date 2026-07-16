/**
 * Monaco Diff エディタ（P12-6、UI-017）。左右テキストの読み取り専用比較表示。
 * CodeEditor と同じく Monaco 本体は動的 import する。
 */
import { useEffect, useRef } from 'react'
import type * as MonacoTypes from 'monaco-editor'
import { useWorkbenchStore } from '../../stores/workbench-store'

let monacoPromise: Promise<typeof import('monaco-editor')> | null = null

async function loadMonaco(): Promise<typeof import('monaco-editor')> {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      const [monaco, { default: EditorWorker }] = await Promise.all([
        import('monaco-editor'),
        import('monaco-editor/esm/vs/editor/editor.worker?worker')
      ])
      self.MonacoEnvironment = { getWorker: () => new EditorWorker() }
      return monaco
    })()
  }
  return monacoPromise
}

export interface DiffEditorProps {
  /** 左（比較元＝過去/アーカイブ） */
  original: string
  /** 右（比較先＝現在） */
  modified: string
  language?: string
  height?: number | string
}

export function DiffEditor({
  original,
  modified,
  language = 'plaintext',
  height = '100%'
}: DiffEditorProps): React.JSX.Element {
  const fontSize = useWorkbenchStore((state) => state.theme.fontSize)
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<MonacoTypes.editor.IStandaloneDiffEditor | null>(null)
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null)

  useEffect(() => {
    let disposed = false
    void loadMonaco().then((monaco) => {
      if (disposed || !containerRef.current) return
      monacoRef.current = monaco
      const isDark = document.documentElement.getAttribute('data-d2d-mode') !== 'light'
      const editor = monaco.editor.createDiffEditor(containerRef.current, {
        readOnly: true,
        renderSideBySide: true,
        automaticLayout: true,
        theme: isDark ? 'vs-dark' : 'vs',
        minimap: { enabled: false },
        fontSize,
        scrollBeyondLastLine: false
      })
      editor.setModel({
        original: monaco.editor.createModel(original, language),
        modified: monaco.editor.createModel(modified, language)
      })
      editorRef.current = editor
    })
    return () => {
      disposed = true
      const model = editorRef.current?.getModel()
      editorRef.current?.dispose()
      model?.original.dispose()
      model?.modified.dispose()
      editorRef.current = null
    }
    // 初期化は 1 回のみ（内容変更は下の effect で反映）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize })
  }, [fontSize])

  useEffect(() => {
    const editor = editorRef.current
    const model = editor?.getModel()
    if (!editor || !model) return
    if (model.original.getValue() !== original) model.original.setValue(original)
    if (model.modified.getValue() !== modified) model.modified.setValue(modified)
  }, [original, modified])

  return <div ref={containerRef} style={{ height, width: '100%' }} data-testid="diff-editor" />
}
