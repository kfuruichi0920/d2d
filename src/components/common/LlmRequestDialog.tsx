/**
 * 全画面共通のLLMプロンプト選択・編集・送信前確認（P6-3/P6-4、LLM-024/040）。
 * 明示承認まではProvider送信もジョブ登録も行わない。
 */
import { useEffect, useMemo, useState } from 'react'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'

export interface LlmRequestMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
  attachments?: Array<{ mediaType: string; data: string }>
}

export interface PreparedLlmRequest {
  operation:
    | 'connection-test'
    | 'semantic-terms'
    | 'semantic-proofread'
    | 'design-candidates'
    | 'resource-merge'
    | 'resource-description'
  purpose: string
  processName: string
  jsonMode: boolean
  messages: LlmRequestMessage[]
}

interface PromptTemplate {
  uid: string
  code: string
  template_name: string
  template_version: string
  purpose: string
  template_text: string
  variables_json: string | null
  model_hint: string | null
  is_active: number
}

interface LlmPreview {
  provider: string
  model: string
  external: boolean
  externalSendAllowed: boolean
  maskedMessages: LlmRequestMessage[]
  warnings: string[]
}

/** テンプレートの{{body}}は画面入力へ展開し、それ以外はsystem promptとして差し替える。 */
export function composePromptMessages(messages: LlmRequestMessage[], promptText: string): LlmRequestMessage[] {
  const nonSystem = messages.filter((message) => message.role !== 'system')
  const defaultSystem = messages.find((message) => message.role === 'system')?.content ?? ''
  const prompt = promptText.trim() || defaultSystem
  if (!prompt) return messages
  if (prompt.includes('{{body}}')) {
    const body = nonSystem
      .filter((message) => message.role === 'user')
      .map((message) => message.content)
      .join('\n\n')
    const attachments = nonSystem.flatMap((message) => message.attachments ?? [])
    return [
      { role: 'user', content: prompt.replaceAll('{{body}}', body), ...(attachments.length ? { attachments } : {}) }
    ]
  }
  return [{ role: 'system', content: prompt }, ...nonSystem]
}

export function LlmRequestDialog({
  request,
  screenId,
  title,
  onClose,
  onConfirmed
}: {
  request: PreparedLlmRequest
  screenId: string
  title: string
  onClose: () => void
  onConfirmed: (messages: LlmRequestMessage[], promptTemplateUid?: string) => Promise<void>
}): React.JSX.Element {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [selectedUid, setSelectedUid] = useState('')
  const [promptText, setPromptText] = useState('')
  const [preview, setPreview] = useState<LlmPreview | null>(null)
  const [templateName, setTemplateName] = useState('')
  const [templateVersion, setTemplateVersion] = useState('1.0.0')
  const [busy, setBusy] = useState(false)
  const notify = useJobsStore((state) => state.notify)
  const storageKey = `d2d.llm.prompt.${screenId}`

  useEffect(() => {
    const defaultPrompt = request.messages.find((message) => message.role === 'system')?.content ?? ''
    setPromptText(defaultPrompt)
    setPreview(null)
    void invoke<PromptTemplate[]>('prompt.list').then((result) => {
      if (!result.ok) return notify('error', 'プロンプト一覧を取得できませんでした', result.error.message)
      const candidates = result.result.filter(
        (template) => template.is_active === 1 && template.purpose === request.purpose
      )
      setTemplates(candidates)
      const saved = localStorage.getItem(storageKey) ?? ''
      const selected = candidates.find((template) => template.uid === saved)
      if (selected) {
        setSelectedUid(selected.uid)
        setPromptText(selected.template_text)
      }
    })
  }, [notify, request, storageKey])

  const messages = useMemo(() => composePromptMessages(request.messages, promptText), [promptText, request.messages])

  const selectTemplate = (uid: string): void => {
    setSelectedUid(uid)
    localStorage.setItem(storageKey, uid)
    const selected = templates.find((template) => template.uid === uid)
    setPromptText(
      selected?.template_text ?? request.messages.find((message) => message.role === 'system')?.content ?? ''
    )
    setPreview(null)
  }

  const saveTemplate = async (): Promise<void> => {
    const result = await invoke<PromptTemplate>('prompt.save', {
      templateName,
      templateVersion,
      purpose: request.purpose,
      templateText: promptText,
      variables: promptText.includes('{{body}}') ? ['body'] : []
    })
    if (!result.ok) return notify('error', 'プロンプトを保存できませんでした', result.error.message)
    setTemplates((current) => [result.result, ...current])
    setTemplateName('')
    setSelectedUid(result.result.uid)
    localStorage.setItem(storageKey, result.result.uid)
    notify('info', `プロンプト ${result.result.template_name}@${result.result.template_version} を保存しました`)
  }

  const showPreview = async (): Promise<void> => {
    const result = await invoke<LlmPreview>('llm.preview', { messages })
    if (!result.ok) return notify('error', '送信内容を確認できませんでした', result.error.message)
    setPreview(result.result)
  }

  const confirm = async (): Promise<void> => {
    setBusy(true)
    try {
      await onConfirmed(messages, selectedUid || undefined)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="llm-request-overlay" role="presentation">
      <div
        className="llm-request-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="llm-request-dialog"
      >
        <header className="llm-request-header">
          <div>
            <strong>{title}</strong>
            <div>プロンプト選択・編集 → 送信内容確認 → 明示承認</div>
          </div>
          <button type="button" className="d2d-btn small" onClick={onClose} disabled={busy} aria-label="閉じる">
            ×
          </button>
        </header>

        <section className="llm-request-section">
          <label>この画面で使用するプロンプト</label>
          <select
            value={selectedUid}
            onChange={(event) => selectTemplate(event.target.value)}
            data-testid="llm-prompt-select"
          >
            <option value="">画面既定プロンプト</option>
            {templates.map((template) => (
              <option key={template.uid} value={template.uid}>
                {template.template_name}@{template.template_version}
              </option>
            ))}
          </select>
          <textarea
            value={promptText}
            onChange={(event) => {
              setPromptText(event.target.value)
              setPreview(null)
            }}
            rows={8}
            data-testid="llm-prompt-editor"
            aria-label="実行時プロンプト"
          />
          <div className="llm-prompt-save-row">
            <input
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              placeholder="テンプレート名"
              data-testid="llm-prompt-save-name"
            />
            <input
              value={templateVersion}
              onChange={(event) => setTemplateVersion(event.target.value)}
              placeholder="版"
              data-testid="llm-prompt-save-version"
            />
            <button
              type="button"
              className="d2d-btn small"
              disabled={!templateName.trim() || !templateVersion.trim() || !promptText.trim()}
              onClick={() => void saveTemplate()}
              data-testid="llm-prompt-save"
            >
              新しい版として保存
            </button>
          </div>
        </section>

        <section className="llm-request-section">
          <div className="llm-request-summary">
            <span>処理: {request.processName}</span>
            <span>本文: {messages.reduce((sum, message) => sum + message.content.length, 0)}文字</span>
            <span>JSON: {request.jsonMode ? '有効' : '無効'}</span>
          </div>
          <button type="button" className="d2d-btn" onClick={() => void showPreview()} data-testid="llm-preview-button">
            送信内容を確認
          </button>
        </section>

        {preview && (
          <section className="llm-request-preview" data-testid="llm-preview">
            <strong>送信前確認（LLM-040）</strong>
            <div className="llm-request-summary">
              <span>送信先: {preview.provider}</span>
              <span>モデル: {preview.model}</span>
              <span>{preview.external ? '外部送信' : 'ローカル送信'}</span>
            </div>
            <pre>
              {preview.maskedMessages
                .map(
                  (message) =>
                    `[${message.role}] ${message.content}${
                      message.attachments?.length
                        ? `\n[添付画像: ${message.attachments.map((attachment) => attachment.mediaType).join(', ')}]`
                        : ''
                    }`
                )
                .join('\n\n')}
            </pre>
            {preview.warnings.map((warning) => (
              <div key={warning} className="llm-request-warning">
                ⚠ {warning}
              </div>
            ))}
          </section>
        )}

        <footer className="llm-request-actions">
          <button type="button" className="d2d-btn" onClick={onClose} disabled={busy}>
            キャンセル
          </button>
          <button
            type="button"
            className="d2d-btn primary"
            onClick={() => void confirm()}
            disabled={!preview || busy}
            data-testid="llm-send-button"
          >
            {busy ? '登録中…' : '確認して実行'}
          </button>
        </footer>
      </div>
    </div>
  )
}
