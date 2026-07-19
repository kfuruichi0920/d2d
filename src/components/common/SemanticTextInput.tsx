/** セマンティック入力欄（P10-7、EDIT-057〜073）。 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import type {
  SemanticCandidate,
  SemanticDisplayMode,
  SemanticDocument,
  SemanticReference,
  SemanticRelationType
} from '../../types/semantic'
import { SEMANTIC_RELATIONS } from '../../types/semantic'
import { LlmRequestDialog, type LlmRequestMessage, type PreparedLlmRequest } from './LlmRequestDialog'
import { useEscapeToClose } from './useEscapeToClose'
import { CodeEditor } from './CodeEditor'
import { DiffEditor } from './DiffEditor'
import { MarkdownPreview } from './MarkdownPreview'
interface CandidateGroups {
  query: string
  tooBroad: boolean
  groups: { recent: SemanticCandidate[]; glossary: SemanticCandidate[]; model: SemanticCandidate[] }
}
interface Analysis {
  references: SemanticReference[]
  normalizations: Array<{ before: string; after: string; mechanical: boolean; targetUid: string }>
  unknownTerms: string[]
}
const LABELS = { recent: '最近使用', glossary: '辞書用語', model: 'モデル要素' } as const
export function isSemanticEditShortcut(key: string): boolean {
  return key === 'Enter' || key === 'F2'
}
function structured(doc: SemanticDocument): string {
  return JSON.stringify(
    {
      schemaVersion: 1,
      originalText: doc.originalText,
      displayText: doc.displayText,
      policy: doc.policy,
      references: doc.references
    },
    null,
    2
  )
}
function renderText(
  doc: SemanticDocument,
  candidates: Record<string, SemanticCandidate>,
  openResource: (uri: string, title: string) => void
): React.JSX.Element {
  const parts: React.ReactNode[] = []
  let cursor = 0
  for (const ref of [...doc.references]
    .filter((r) => r.status !== 'rejected')
    .sort((a, b) => a.startOffset - b.startOffset)) {
    if (ref.startOffset < cursor || ref.endOffset > doc.displayText.length) continue
    parts.push(doc.displayText.slice(cursor, ref.startOffset))
    const candidate = candidates[ref.targetUid]
    const label =
      ref.displayMode === 'uid'
        ? ref.targetUid
        : ref.displayMode === 'id'
          ? (candidate?.code ?? ref.targetUid)
          : ref.displayMode === 'string'
            ? (candidate?.title ?? ref.surfaceText)
            : ref.surfaceText
    parts.push(
      <button
        type="button"
        className={`semantic-mark ${ref.status}`}
        key={`${ref.startOffset}-${ref.targetUid}`}
        title={`${candidate?.code ?? ref.targetUid} / ${candidate?.title ?? ref.surfaceText}\n${candidate?.definition ?? ''}\n${ref.relationType} / ${ref.status}`}
        onClick={() =>
          openResource(
            ref.targetKind === 'glossary' ? 'glossary://workspace' : `resource://${ref.targetUid}`,
            candidate?.title ?? ref.surfaceText
          )
        }
      >
        {label}
      </button>
    )
    cursor = ref.endOffset
  }
  parts.push(doc.displayText.slice(cursor))
  return <div className="semantic-preview">{parts}</div>
}
export function SemanticTextInput({
  document,
  multiline,
  onChange,
  onDocumentChange,
  testId
}: {
  document: SemanticDocument
  multiline: boolean
  onChange: (value: string) => void
  onDocumentChange: (document: SemanticDocument) => void
  testId?: string
}): React.JSX.Element {
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null),
    openResource = useEditorStore((s) => s.openResource)
  const [mode, setMode] = useState<'preview' | 'structure' | 'proofread'>('preview'),
    [groups, setGroups] = useState<CandidateGroups | null>(null),
    [candidateMap, setCandidateMap] = useState<Record<string, SemanticCandidate>>({}),
    [analysis, setAnalysis] = useState<Analysis | null>(null),
    [raw, setRaw] = useState(() => structured(document)),
    [validation, setValidation] = useState<string>(''),
    [llmBusy, setLlmBusy] = useState(false),
    [llmRequest, setLlmRequest] = useState<PreparedLlmRequest | null>(null),
    [llmPurpose, setLlmPurpose] = useState<'terms' | 'proofread'>('terms'),
    [proofread, setProofread] = useState<{
      revisedText: string
      issues: Array<{ kind: string; message: string }>
    } | null>(null),
    [editing, setEditing] = useState(false)
  const activeRefs = useMemo(() => document.references.filter((r) => r.status !== 'rejected'), [document.references])
  const editorTestId = testId ? `${testId}-editor` : undefined
  const openEditor = (): void => {
    setMode('preview')
    setEditing(true)
  }
  const closeEditor = (): void => {
    setGroups(null)
    setEditing(false)
  }
  // モーダル最前面だけを閉じる共通 Escape（W10）。フォーカスが外れていても効く。
  useEscapeToClose(editing && !llmRequest, closeEditor)
  useEffect(() => {
    if (editing && !multiline) inputRef.current?.focus()
  }, [editing, multiline])
  const updateText = (value: string): void => {
    onChange(value)
    onDocumentChange({
      ...document,
      displayText: value,
      references: document.references.filter(
        (r) => r.endOffset <= value.length && value.slice(r.startOffset, r.endOffset) === r.surfaceText
      )
    })
    setRaw(structured({ ...document, displayText: value, references: [] }))
  }
  const search = async (prefixOverride?: string): Promise<void> => {
    const el = inputRef.current
    const caret = el?.selectionStart ?? document.displayText.length,
      before = document.displayText.slice(0, caret),
      prefix = prefixOverride ?? before.match(/[\p{L}\p{N}_./-]+$/u)?.[0] ?? ''
    const result = await invoke<CandidateGroups>('semantic.search', { prefix, policy: document.policy })
    if (result.ok) {
      setGroups(result.result)
      const all = [...result.result.groups.recent, ...result.result.groups.glossary, ...result.result.groups.model]
      setCandidateMap((m) => ({ ...m, ...Object.fromEntries(all.map((c) => [c.uid, c])) }))
    }
  }
  const choose = (candidate: SemanticCandidate): void => {
    const el = inputRef.current,
      caret = el?.selectionStart ?? document.displayText.length,
      before = document.displayText.slice(0, caret),
      prefix = before.match(/[\p{L}\p{N}_./-]+$/u)?.[0] ?? '',
      start = caret - prefix.length
    const display: SemanticDisplayMode = document.policy.defaultDisplayMode
    const inserted =
      display === 'string'
        ? candidate.title
        : display === 'id'
          ? candidate.code
          : display === 'uid'
            ? candidate.uid
            : prefix || candidate.title
    const next = document.displayText.slice(0, start) + inserted + document.displayText.slice(caret)
    const delta = inserted.length - (caret - start)
    const shifted = document.references
      .filter((r) => r.endOffset <= start || r.startOffset >= caret)
      .map((r) =>
        r.startOffset >= caret ? { ...r, startOffset: r.startOffset + delta, endOffset: r.endOffset + delta } : r
      )
    const ref: SemanticReference = {
      startOffset: start,
      endOffset: start + inserted.length,
      surfaceText: inserted,
      targetUid: candidate.uid,
      targetKind: candidate.kind,
      displayMode: display,
      relationType: document.policy.defaultRelationType,
      status: 'candidate',
      source: 'user'
    }
    const nextDoc = {
      ...document,
      displayText: next,
      references: [...shifted, ref].sort((a, b) => a.startOffset - b.startOffset)
    }
    onChange(next)
    onDocumentChange(nextDoc)
    setGroups(null)
    setTimeout(() => {
      el?.focus()
      el?.setSelectionRange(ref.endOffset, ref.endOffset)
    }, 0)
  }
  const analyze = async (): Promise<void> => {
    const result = await invoke<Analysis>('semantic.analyze', { text: document.displayText })
    if (!result.ok) {
      setValidation(result.error.message)
      return
    }
    let nextText = document.displayText
    let references = result.result.references
    const automatic = result.result.normalizations.filter(
      (item) => item.mechanical && document.policy.automaticMechanicalNormalization
    )
    for (const item of automatic) {
      const index = nextText.lastIndexOf(item.before)
      if (index < 0) continue
      const delta = item.after.length - item.before.length
      nextText = nextText.slice(0, index) + item.after + nextText.slice(index + item.before.length)
      references = references.map((ref) =>
        ref.targetUid === item.targetUid && ref.startOffset === index
          ? { ...ref, surfaceText: item.after, endOffset: index + item.after.length }
          : ref.startOffset > index
            ? { ...ref, startOffset: ref.startOffset + delta, endOffset: ref.endOffset + delta }
            : ref
      )
    }
    const next: SemanticDocument = {
      ...document,
      displayText: nextText,
      references,
      normalization: automatic.length
        ? {
            beforeText: document.displayText,
            afterText: nextText,
            method: 'mechanical',
            status: 'approved',
            detail: { count: automatic.length }
          }
        : document.normalization
    }
    if (nextText !== document.displayText) onChange(nextText)
    onDocumentChange(next)
    setAnalysis({
      ...result.result,
      references,
      normalizations: result.result.normalizations.filter((item) => !automatic.includes(item))
    })
  }
  const applyNormalization = (item: Analysis['normalizations'][number]): void => {
    const index = document.displayText.indexOf(item.before)
    if (index < 0) return
    const nextText =
      document.displayText.slice(0, index) + item.after + document.displayText.slice(index + item.before.length)
    const delta = item.after.length - item.before.length
    const refs = document.references.map((r) =>
      r.targetUid === item.targetUid && r.startOffset === index
        ? { ...r, surfaceText: item.after, endOffset: index + item.after.length }
        : r.startOffset > index
          ? { ...r, startOffset: r.startOffset + delta, endOffset: r.endOffset + delta }
          : r
    )
    const next = {
      ...document,
      displayText: nextText,
      references: refs,
      normalization: {
        beforeText: document.displayText,
        afterText: nextText,
        method: item.mechanical ? ('mechanical' as const) : ('dictionary' as const),
        status: 'approved' as const,
        detail: { targetUid: item.targetUid }
      }
    }
    onChange(nextText)
    onDocumentChange(next)
    setAnalysis((a) => (a ? { ...a, normalizations: a.normalizations.filter((n) => n !== item) } : a))
  }
  const registerUnknown = async (term: string): Promise<void> => {
    const result = await invoke('glossary.addTerm', { term })
    setValidation(result.ok ? `「${term}」を承認待ち候補として登録しました` : result.error.message)
    if (result.ok) setAnalysis((a) => (a ? { ...a, unknownTerms: a.unknownTerms.filter((t) => t !== term) } : a))
  }
  const validateRaw = async (): Promise<void> => {
    const result = await invoke<Omit<SemanticDocument, 'history'>>('semantic.validateStructured', {
      ownerUid: document.ownerUid,
      fieldName: document.fieldName,
      json: raw
    })
    if (!result.ok) {
      setValidation(`検証エラー: ${result.error.message}`)
      return
    }
    onChange(result.result.displayText)
    onDocumentChange({ ...result.result, history: document.history })
    setValidation('スキーマ・UID存在・参照整合性の検証に成功しました')
    setMode('preview')
  }
  const openLlmAnalysis = async (): Promise<void> => {
    const prepared = await invoke<PreparedLlmRequest>('llm.prepareRequest', {
      operation: 'semantic-terms',
      context: { text: document.displayText, ownerUid: document.ownerUid }
    })
    if (!prepared.ok) {
      setValidation(prepared.error.message)
      return
    }
    setLlmPurpose('terms')
    setLlmRequest(prepared.result)
  }
  const analyzeWithLlm = async (messages: LlmRequestMessage[], promptTemplateUid?: string): Promise<void> => {
    setLlmBusy(true)
    try {
      const started = await invoke<{ jobId: string }>('llm.runConfirmed', {
        operation: 'semantic-terms',
        context: { text: document.displayText, ownerUid: document.ownerUid },
        messages,
        promptTemplateUid
      })
      if (!started.ok) {
        setValidation(started.error.message)
        return
      }
      for (let i = 0; i < 240; i++) {
        const job = await invoke<{ status: string; output?: { content?: string }; error?: { message: string } }>(
          'job.get',
          { jobId: started.result.jobId }
        )
        if (job.ok && job.result.status === 'success') {
          try {
            const parsed = JSON.parse(job.result.output?.content ?? '{}') as { terms?: unknown[] }
            const terms = (parsed.terms ?? []).filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
            setAnalysis((current) => ({
              references: current?.references ?? document.references,
              normalizations: current?.normalizations ?? [],
              unknownTerms: [...new Set([...(current?.unknownTerms ?? []), ...terms])]
            }))
            setValidation('LLM結果を未登録用語候補として読み込みました。登録は個別承認が必要です。')
          } catch {
            setValidation('LLM結果のJSON形式を解釈できませんでした')
          }
          return
        }
        if (job.ok && ['failed', 'aborted', 'partial'].includes(job.result.status)) {
          setValidation(job.result.error?.message ?? 'LLM解析に失敗しました')
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      setValidation('LLM解析がタイムアウトしました')
    } finally {
      setLlmBusy(false)
    }
  }
  const openProofread = async (): Promise<void> => {
    const prepared = await invoke<PreparedLlmRequest>('llm.prepareRequest', {
      operation: 'semantic-proofread',
      context: { text: document.displayText, ownerUid: document.ownerUid }
    })
    if (!prepared.ok) return setValidation(prepared.error.message)
    setLlmPurpose('proofread')
    setLlmRequest(prepared.result)
  }
  const proofreadWithLlm = async (messages: LlmRequestMessage[], promptTemplateUid?: string): Promise<void> => {
    setLlmBusy(true)
    try {
      const started = await invoke<{ jobId: string }>('llm.runConfirmed', {
        operation: 'semantic-proofread',
        context: { text: document.displayText, ownerUid: document.ownerUid },
        messages,
        promptTemplateUid
      })
      if (!started.ok) return setValidation(started.error.message)
      for (let index = 0; index < 240; index++) {
        const job = await invoke<{ status: string; output?: { content?: string }; error?: { message: string } }>(
          'job.get',
          { jobId: started.result.jobId }
        )
        if (job.ok && job.result.status === 'success') {
          try {
            const parsed = JSON.parse(job.result.output?.content ?? '{}') as {
              revisedText?: string
              issues?: Array<{ kind?: string; message?: string }>
            }
            if (typeof parsed.revisedText !== 'string') throw new Error('revisedText missing')
            setProofread({
              revisedText: parsed.revisedText,
              issues: (parsed.issues ?? []).map((issue) => ({
                kind: issue.kind ?? 'review',
                message: issue.message ?? ''
              }))
            })
            setMode('proofread')
          } catch {
            setValidation('校正・正規化結果のJSON形式を解釈できませんでした')
          }
          return
        }
        if (job.ok && ['failed', 'aborted', 'partial'].includes(job.result.status)) {
          setValidation(job.result.error?.message ?? '校正・正規化に失敗しました')
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
      setValidation('校正・正規化がタイムアウトしました')
    } finally {
      setLlmBusy(false)
    }
  }
  const patchRef = (index: number, patch: Partial<SemanticReference>): void =>
    onDocumentChange({
      ...document,
      references: document.references.map((r, i) => (i === index ? { ...r, ...patch } : r))
    })
  return (
    <div className="semantic-input" data-testid={`semantic-input-${document.fieldName}`}>
      <div className="semantic-preview-field">
        <div
          className="semantic-preview-focus"
          data-testid={testId}
          role="textbox"
          aria-readonly="true"
          aria-label={`${document.fieldName} プレビュー。EnterまたはF2で編集`}
          tabIndex={0}
          title="EnterまたはF2でセマンティック編集ダイアログを開きます"
          onDoubleClick={openEditor}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget && isSemanticEditShortcut(event.key)) {
              event.preventDefault()
              openEditor()
            }
          }}
        >
          {renderText(document, candidateMap, openResource)}
        </div>
        <button
          type="button"
          className="d2d-btn small semantic-edit-trigger"
          title="セマンティック編集ダイアログを開きます（Enter / F2）"
          data-testid={`semantic-edit-${document.fieldName}`}
          onClick={openEditor}
        >
          編集
        </button>
      </div>
      {editing && (
        <div
          className="semantic-edit-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`semantic-edit-title-${document.fieldName}`}
          data-testid={`semantic-edit-dialog-${document.fieldName}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape' && !llmRequest) closeEditor()
          }}
        >
          <div className="semantic-edit-panel">
            <div className="semantic-edit-dialog-title">
              <b id={`semantic-edit-title-${document.fieldName}`}>{document.fieldName} のセマンティック編集</b>
              <button
                type="button"
                className="d2d-btn small"
                title="このテキスト欄を含むResourceをEditor Areaへ統合します"
                data-testid={`semantic-integrate-${document.fieldName}`}
                onClick={() => {
                  openResource(`resource://${document.ownerUid}`, `${document.fieldName} 編集`, { preview: false })
                  closeEditor()
                }}
              >
                エディタへ統合
              </button>
              <button
                type="button"
                className="d2d-btn small"
                data-testid={`semantic-edit-close-${document.fieldName}`}
                onClick={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  closeEditor()
                }}
              >
                閉じる
              </button>
            </div>
            <div className="semantic-edit-dialog-body">
              <div className="semantic-two-panel-controls">
                <div className="semantic-toolbar semantic-toolbar-left">
                  <b>左</b>
                  <button type="button" className="active">
                    編集
                  </button>
                  <button
                    type="button"
                    title="登録済み用語・モデルを文章から抽出し、承認待ち候補として表示します"
                    onClick={() => void analyze()}
                  >
                    用語候補
                  </button>
                  <button
                    type="button"
                    title="設定済みLLMへ送信し、未登録用語の候補だけを抽出します"
                    disabled={llmBusy}
                    onClick={() => void openLlmAnalysis()}
                  >
                    用語候補(LLM)
                  </button>
                  <small>入力補完: Ctrl+Space</small>
                </div>
                <div className="semantic-toolbar semantic-toolbar-right">
                  <b>右</b>
                  <button
                    type="button"
                    onClick={() => setMode('preview')}
                    className={mode === 'preview' ? 'active' : ''}
                  >
                    プレビュー
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRaw(structured(document))
                      setMode('structure')
                    }}
                    className={mode === 'structure' ? 'active' : ''}
                  >
                    構造化データ
                  </button>
                  <button
                    type="button"
                    disabled={llmBusy}
                    onClick={() => void openProofread()}
                    className={mode === 'proofread' ? 'active' : ''}
                  >
                    校正・正規化(LLM)
                  </button>
                </div>
              </div>
              <div className="semantic-two-panel-body">
                <div className="semantic-left-panel">
                  {multiline ? (
                    <CodeEditor
                      value={document.displayText}
                      language="markdown"
                      height={300}
                      onChange={updateText}
                      onCtrlSpace={(prefix) => void search(prefix)}
                    />
                  ) : (
                    <input
                      ref={inputRef as React.RefObject<HTMLInputElement>}
                      value={document.displayText}
                      data-testid={editorTestId}
                      onChange={(event) => updateText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.ctrlKey && event.code === 'Space') {
                          event.preventDefault()
                          void search()
                        }
                      }}
                    />
                  )}
                </div>
                <div className="semantic-right-panel">
                  {mode === 'preview' && (
                    <div>
                      <MarkdownPreview markdown={document.displayText} />
                      {activeRefs.length > 0 && renderText(document, candidateMap, openResource)}
                    </div>
                  )}
                  {mode === 'structure' && (
                    <div>
                      <textarea
                        className="semantic-structured"
                        value={raw}
                        onChange={(event) => setRaw(event.target.value)}
                        spellCheck={false}
                      />
                      <button type="button" className="d2d-btn" onClick={() => void validateRaw()}>
                        検証して反映
                      </button>
                    </div>
                  )}
                  {mode === 'proofread' && proofread && (
                    <div className="semantic-proofread-result">
                      <DiffEditor
                        original={document.displayText}
                        modified={proofread.revisedText}
                        language="markdown"
                        height={300}
                      />
                      {proofread.issues.map((issue, index) => (
                        <div key={`${issue.kind}-${index}`}>
                          <b>{issue.kind}</b>: {issue.message}
                        </div>
                      ))}
                      <button type="button" className="d2d-btn" onClick={() => updateText(proofread.revisedText)}>
                        校正候補を編集へ反映
                      </button>
                    </div>
                  )}
                </div>
              </div>{' '}
              {groups && (
                <div className="semantic-candidates" role="listbox">
                  {groups.tooBroad ? (
                    <div>候補が多いため、{document.policy.minimumPrefixLength}文字以上入力してください</div>
                  ) : (
                    (Object.keys(LABELS) as Array<keyof typeof LABELS>).map(
                      (key) =>
                        groups.groups[key].length > 0 && (
                          <section key={key}>
                            <b>{LABELS[key]}</b>
                            {groups.groups[key].map((c) => (
                              <button
                                type="button"
                                key={`${key}-${c.uid}`}
                                title={`${c.code}\n${c.definition ?? ''}\nscope=${c.scope} status=${c.status}`}
                                onClick={() => choose(c)}
                              >
                                <span>{c.title}</span>
                                <small>
                                  {c.code} / {c.category ?? c.kind}
                                </small>
                              </button>
                            ))}
                          </section>
                        )
                    )
                  )}
                </div>
              )}
              {activeRefs.length > 0 && (
                <div className="semantic-references">
                  <b>構造化参照</b>
                  {document.references.map(
                    (r, i) =>
                      r.status !== 'rejected' && (
                        <div key={`${r.startOffset}-${r.targetUid}`}>
                          <span title={r.targetUid}>{r.surfaceText}</span>
                          <select
                            value={r.displayMode}
                            onChange={(e) => patchRef(i, { displayMode: e.target.value as SemanticDisplayMode })}
                          >
                            <option value="link">リンクのみ</option>
                            <option value="string">文字列</option>
                            <option value="id">ID</option>
                            <option value="uid">UID</option>
                          </select>
                          <select
                            value={r.relationType}
                            onChange={(e) =>
                              patchRef(i, { relationType: e.target.value as SemanticRelationType, status: 'candidate' })
                            }
                          >
                            {document.policy.relationTypes.map((relation) => (
                              <option key={relation}>{relation}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            className={r.status === 'approved' ? 'approved' : ''}
                            title="関係ルール検証後、保存時にtrace_linkを確定します"
                            onClick={() => patchRef(i, { status: r.status === 'approved' ? 'candidate' : 'approved' })}
                          >
                            {r.status === 'approved' ? '承認済み' : '承認'}
                          </button>
                          <button type="button" onClick={() => patchRef(i, { status: 'rejected' })}>
                            取消し
                          </button>
                        </div>
                      )
                  )}
                </div>
              )}
              {analysis && (
                <div className="semantic-analysis">
                  {analysis.normalizations.map((n) => (
                    <div key={`${n.before}-${n.targetUid}`}>
                      <del>{n.before}</del> → <ins>{n.after}</ins>{' '}
                      <button type="button" onClick={() => applyNormalization(n)}>
                        {n.mechanical ? '機械的正規化を適用' : '置換を承認'}
                      </button>
                    </div>
                  ))}
                  {analysis.unknownTerms.map((term) => (
                    <div key={term}>
                      未登録候補: <b>{term}</b>{' '}
                      <button type="button" onClick={() => void registerUnknown(term)}>
                        辞書候補に登録
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <details className="semantic-policy">
                <summary>入力欄設定</summary>
                <label>
                  候補種別{' '}
                  {(['glossary', 'model', 'recent'] as const).map((kind) => (
                    <span key={kind}>
                      <input
                        type="checkbox"
                        checked={document.policy.candidateKinds.includes(kind)}
                        onChange={(e) =>
                          onDocumentChange({
                            ...document,
                            policy: {
                              ...document.policy,
                              candidateKinds: e.target.checked
                                ? [...document.policy.candidateKinds, kind]
                                : document.policy.candidateKinds.filter((v) => v !== kind)
                            }
                          })
                        }
                      />
                      {LABELS[kind]}
                    </span>
                  ))}
                </label>
                <label>
                  既定関係{' '}
                  <select
                    value={document.policy.defaultRelationType}
                    onChange={(e) =>
                      onDocumentChange({
                        ...document,
                        policy: { ...document.policy, defaultRelationType: e.target.value as SemanticRelationType }
                      })
                    }
                  >
                    {SEMANTIC_RELATIONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <label>
                  既定表示{' '}
                  <select
                    value={document.policy.defaultDisplayMode}
                    onChange={(e) =>
                      onDocumentChange({
                        ...document,
                        policy: { ...document.policy, defaultDisplayMode: e.target.value as SemanticDisplayMode }
                      })
                    }
                  >
                    <option value="link">リンクのみ</option>
                    <option value="string">文字列</option>
                    <option value="id">ID</option>
                    <option value="uid">UID</option>
                  </select>
                </label>
                <label>
                  最小前方一致文字数{' '}
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={document.policy.minimumPrefixLength}
                    onChange={(e) =>
                      onDocumentChange({
                        ...document,
                        policy: { ...document.policy, minimumPrefixLength: Number(e.target.value) }
                      })
                    }
                  />
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={document.policy.automaticMechanicalNormalization}
                    onChange={(e) =>
                      onDocumentChange({
                        ...document,
                        policy: { ...document.policy, automaticMechanicalNormalization: e.target.checked }
                      })
                    }
                  />
                  機械的表記差異を自動正規化
                </label>
                <small>辞書スコープ: project / 強い意味関係は承認と関係ルール検証が必要です</small>
              </details>
              {validation && <div className="semantic-validation">{validation}</div>}
            </div>
          </div>
        </div>
      )}
      {llmRequest && (
        <LlmRequestDialog
          request={llmRequest}
          screenId={`semantic.${document.fieldName}.${llmPurpose}`}
          title={llmPurpose === 'terms' ? '用語候補(LLM)' : '校正・正規化(LLM)'}
          onClose={() => setLlmRequest(null)}
          onConfirmed={llmPurpose === 'terms' ? analyzeWithLlm : proofreadWithLlm}
        />
      )}
    </div>
  )
}
