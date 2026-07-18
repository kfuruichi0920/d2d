/**
 * LLM 設定セクション・LLM Logs Panel・実行詳細ビューア（P6-7、UI-018、LLM-015/040）。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { LlmRequestDialog, type LlmRequestMessage, type PreparedLlmRequest } from '../common/LlmRequestDialog'

interface LlmSettings {
  provider: string
  model: string
  endpoint?: string
  deployment?: string
  preferLocal: boolean
  hasApiKey: boolean
  external: boolean
  externalSendAllowed: boolean
}

const PROVIDERS = ['ollama', 'openai', 'gemini', 'azure']

/** Settings Editor 内の LLM Provider 設定（LLM-005、V-12） */
export function LlmSettingsSection({ showExternalSend = true }: { showExternalSend?: boolean }): React.JSX.Element {
  const [config, setConfig] = useState<LlmSettings | null>(null)
  const [request, setRequest] = useState<PreparedLlmRequest | null>(null)
  const notify = useJobsStore((s) => s.notify)

  const load = useCallback(async () => {
    const res = await invoke<LlmSettings>('llm.getSettings')
    if (res.ok) setConfig(res.result)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const setSetting = async (key: string, value: unknown): Promise<void> => {
    await invoke('settings.set', { key, value })
    setRequest(null)
    await load()
  }

  const setProjectAllowed = async (allowed: boolean): Promise<void> => {
    const res = await invoke('settings.setProjectSetting', { key: 'llm.externalSendAllowed', value: allowed })
    if (!res.ok) notify('error', 'プロジェクト設定を更新できませんでした', res.error.message)
    setRequest(null)
    await load()
  }

  const openConnectionTest = async (): Promise<void> => {
    const result = await invoke<PreparedLlmRequest>('llm.prepareRequest', {
      operation: 'connection-test',
      context: {}
    })
    if (result.ok) setRequest(result.result)
    else notify('error', '接続テストの確認画面を開けませんでした', result.error.message)
  }

  const sendTest = async (messages: LlmRequestMessage[], promptTemplateUid?: string): Promise<void> => {
    const result = await invoke('llm.runConfirmed', {
      operation: 'connection-test',
      context: {},
      messages,
      promptTemplateUid
    })
    if (result.ok) notify('info', '接続テストジョブを開始しました（結果は LLM Logs へ）')
    else notify('error', '接続テストを開始できませんでした', result.error.message)
  }

  if (!config) return <div className="d2d-empty">読込中…</div>

  const rowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, margin: '6px 0' }
  const labelStyle: React.CSSProperties = { width: 150, color: 'var(--d2d-fg-muted)' }

  return (
    <div data-testid="llm-settings">
      <h2 style={{ fontSize: 14, marginTop: 20 }}>LLM Provider（LLM-001〜005）</h2>
      <div style={rowStyle}>
        <label style={labelStyle}>Provider</label>
        <select
          data-testid="llm-provider-select"
          value={config.provider}
          onChange={(e) => void setSetting('llm.provider', e.target.value)}
        >
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
              {p === 'ollama' ? '（ローカル）' : ''}
            </option>
          ))}
        </select>
        {config.external ? (
          <span className={`d2d-badge ${config.externalSendAllowed ? 'status-partial' : 'status-failed'}`}>
            外部送信{config.externalSendAllowed ? '許可' : '不可'}
          </span>
        ) : (
          <span className="d2d-badge status-success">ローカル</span>
        )}
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>モデル</label>
        <input
          data-testid="llm-model-input"
          defaultValue={config.model}
          onBlur={(e) => void setSetting(`llm.${config.provider}.model`, e.target.value)}
        />
      </div>
      <div style={rowStyle}>
        <label style={labelStyle}>Endpoint</label>
        <input
          data-testid="llm-endpoint-input"
          style={{ flex: 1 }}
          placeholder={config.provider === 'ollama' ? 'http://localhost:11434' : 'Azure/プロキシ利用時のみ'}
          defaultValue={config.endpoint ?? ''}
          onBlur={(e) => void setSetting(`llm.${config.provider}.endpoint`, e.target.value)}
        />
      </div>
      {config.provider === 'azure' && (
        <div style={rowStyle}>
          <label style={labelStyle}>Deployment</label>
          <input
            defaultValue={config.deployment ?? ''}
            onBlur={(e) => void setSetting('llm.azure.deployment', e.target.value)}
          />
        </div>
      )}
      <div style={rowStyle}>
        <label style={labelStyle}>ローカル優先（LLM-043）</label>
        <input
          type="checkbox"
          checked={config.preferLocal}
          onChange={(e) => void setSetting('llm.preferLocal', e.target.checked)}
        />
      </div>
      {showExternalSend && (
        <div style={rowStyle}>
          <label style={labelStyle}>外部送信可否（LLM-042）</label>
          <input
            type="checkbox"
            data-testid="llm-external-allowed"
            checked={config.externalSendAllowed}
            onChange={(e) => void setProjectAllowed(e.target.checked)}
          />
          <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>プロジェクト単位・既定は不可</span>
        </div>
      )}
      {config.external && !config.hasApiKey && (
        <p style={{ color: 'var(--d2d-warning)', fontSize: 11.5 }}>
          APIキー未登録です。上の「機密情報」で {config.provider}_api_key を登録してください。
        </p>
      )}

      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="d2d-btn"
          onClick={() => void openConnectionTest()}
          data-testid="llm-test-button"
        >
          接続テスト（送信前確認）
        </button>
      </div>

      {request && (
        <LlmRequestDialog
          request={request}
          screenId="settings.connection-test"
          title="LLM接続テスト"
          onClose={() => setRequest(null)}
          onConfirmed={sendTest}
        />
      )}
    </div>
  )
}

interface LlmRunRow {
  uid: string
  code: string
  tool_name: string
  process_name: string
  model_name: string
  input_tokens: number | null
  output_tokens: number | null
  estimated_cost: number | null
  duration_ms: number | null
  status: string
  executed_at: string
}

/** Panel の LLM Logs タブ（UI-018、LLM-015） */
export function LlmLogsPanel(): React.JSX.Element {
  const [runs, setRuns] = useState<LlmRunRow[]>([])
  const openResource = useEditorStore((s) => s.openResource)

  const refresh = useCallback(async () => {
    const res = await invoke<LlmRunRow[]>('llm.listRuns')
    if (res.ok) setRuns(res.result)
  }, [])

  useEffect(() => {
    void refresh()
    return onBackendEvent((event) => {
      if (event === 'llm.run.completed' || event === 'job.updated') void refresh()
    })
  }, [refresh])

  if (runs.length === 0) {
    return <div className="d2d-empty">LLM 実行ログはまだありません</div>
  }

  return (
    <div data-testid="llm-logs-list">
      {runs.map((run) => (
        <div
          key={run.uid}
          className="d2d-list-row"
          onClick={() => openResource(`log://llm/${run.uid}`, `LLM ${run.code}`, { preview: true })}
        >
          <span className={`d2d-badge status-${run.status === 'success' ? 'success' : 'failed'}`}>{run.status}</span>
          <span>{run.process_name}</span>
          <span style={{ color: 'var(--d2d-fg-muted)' }}>
            {run.tool_name}/{run.model_name}
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>
            in:{run.input_tokens ?? '-'} out:{run.output_tokens ?? '-'} {run.duration_ms ?? '-'}ms
            {run.estimated_cost !== null ? ` $${run.estimated_cost.toFixed(4)}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

/** LLM 実行詳細ビューア（log://llm/<uid>、V-09。W12: 生送受信ログ・候補再作成） */
export function LlmRunViewer({ uid }: { uid: string }): React.JSX.Element {
  const [run, setRun] = useState<
    | (LlmRunRow & {
        prompt_text: string | null
        result_text: string | null
        raw_request_text: string | null
        raw_response_text: string | null
        error_detail: string | null
        input_ref_uid: string | null
        prompt_template_uid: string | null
      })
    | null
  >(null)
  const notify = useJobsStore((s) => s.notify)
  const [retryRequest, setRetryRequest] = useState<PreparedLlmRequest | null>(null)

  useEffect(() => {
    void invoke<typeof run>('llm.getRun', { uid }).then((res) => {
      if (res.ok) setRun(res.result)
    })
  }, [uid])

  const openRetry = (): void => {
    if (!run?.prompt_text) {
      notify('error', '候補を再作成できませんでした', '保存済みの送信内容がありません')
      return
    }
    try {
      const messages = run.prompt_text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as LlmRequestMessage)
      setRetryRequest({
        operation: 'design-candidates',
        purpose: 'classify',
        processName: 'design-candidates',
        jsonMode: true,
        messages
      })
    } catch {
      notify('error', '候補を再作成できませんでした', '保存済みの送信内容を解釈できません')
    }
  }

  const retry = async (messages: LlmRequestMessage[], promptTemplateUid?: string): Promise<void> => {
    const result = await invoke('llm.runConfirmed', {
      operation: 'design-candidates',
      context: { chunkUid: run?.input_ref_uid },
      messages,
      promptTemplateUid
    })
    if (result.ok) notify('info', '候補再作成ジョブを登録しました', 'Jobs Panel で進捗を確認できます')
    else notify('error', '候補を再作成できませんでした', result.error.message)
  }

  if (!run) return <div className="d2d-empty">読込中…</div>

  const preStyle: React.CSSProperties = {
    background: 'var(--d2d-bg)',
    border: '1px solid var(--d2d-border)',
    borderRadius: 'var(--d2d-radius)',
    padding: 10,
    fontSize: 11.5,
    whiteSpace: 'pre-wrap',
    overflow: 'auto',
    maxHeight: '30vh'
  }

  return (
    <div style={{ padding: 16 }} data-testid="llm-run-viewer">
      <h1 style={{ fontSize: 15, marginTop: 0 }}>
        {run.code} — {run.process_name}
      </h1>
      <dl className="d2d-kv" style={{ padding: 0 }}>
        <dt>Provider / モデル</dt>
        <dd>
          {run.tool_name} / {run.model_name}
        </dd>
        <dt>トークン / コスト</dt>
        <dd>
          in:{run.input_tokens ?? '-'} out:{run.output_tokens ?? '-'}
          {run.estimated_cost !== null ? ` / $${run.estimated_cost?.toFixed(4)}` : ''}（{run.duration_ms}ms）
        </dd>
        <dt>状態</dt>
        <dd>{run.status}</dd>
      </dl>
      {run.error_detail && <div style={{ color: 'var(--d2d-error)' }}>{run.error_detail}</div>}
      {run.process_name === 'design-candidates' && run.input_ref_uid && (
        <button
          type="button"
          className="d2d-btn primary small"
          onClick={openRetry}
          title="この実行と同じ入力チャンクで④候補生成ジョブを再実行します"
          data-testid="llm-retry-run"
        >
          このログから候補を再作成
        </button>
      )}
      {retryRequest && (
        <LlmRequestDialog
          request={retryRequest}
          screenId="llm-log.design-candidates"
          title="このログから候補を再作成"
          onClose={() => setRetryRequest(null)}
          onConfirmed={retry}
        />
      )}
      <h2 style={{ fontSize: 13 }}>送信内容（マスキング後）</h2>
      <pre style={preStyle}>{run.prompt_text ?? '（なし）'}</pre>
      <h2 style={{ fontSize: 13 }}>応答</h2>
      <pre style={preStyle} data-testid="llm-result-text">
        {run.result_text ?? '（なし）'}
      </pre>
      <h2 style={{ fontSize: 13 }}>生リクエスト（Provider送信ボディ・APIキーなし）</h2>
      <pre style={preStyle} data-testid="llm-raw-request">
        {run.raw_request_text ?? '（記録なし: 1.8.0 以前の実行）'}
      </pre>
      <h2 style={{ fontSize: 13 }}>生レスポンス（Provider応答）</h2>
      <pre style={preStyle} data-testid="llm-raw-response">
        {run.raw_response_text ?? '（記録なし: 1.8.0 以前の実行）'}
      </pre>
    </div>
  )
}
