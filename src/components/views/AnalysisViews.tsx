/**
 * 設計分析 UI（ANA-001〜009、MCP-011/012）。
 * - AnalysisSideBarSection: Trace（分析）サイドバーの実行ボタン10種＋起点・終点要素設定
 * - AnalysisSlotSettingsSection: 設計モデル設定画面のクエリ規則（ボタン名＋DSL＋MCP向け説明）編集
 * - AnalysisGraphEditor: analysis://<dataFileName> の分析結果グラフ表示（ANA-008）
 * 実行結果は分析過程を含むレポート（Markdown/HTML、exports/reports/）へ出力し、report:// で開く。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import type { DesignElementRow } from './DesignModelViews'
import { LlmRequestDialog, type LlmRequestMessage, type PreparedLlmRequest } from '../common/LlmRequestDialog'

export interface AnalysisQuerySlot {
  name: string
  dsl: string
  mcpDescription: string
}

interface AnalysisRunResult {
  name: string
  fileName: string
  path: string
  dataFileName: string
  elementCount: number
  relationCount: number
  pathCount: number
  truncated: boolean
}

interface DslValidationResult {
  ok: boolean
  errors: { line: number; message: string }[]
  requiresStart: boolean
  requiresEnd: boolean
}

// ---- Trace サイドバーの分析セクション（ANA-005） ----

export function AnalysisSideBarSection(): React.JSX.Element {
  const [slots, setSlots] = useState<AnalysisQuerySlot[]>([])
  const [elements, setElements] = useState<DesignElementRow[]>([])
  const [startUid, setStartUid] = useState('')
  const [endUid, setEndUid] = useState('')
  const [format, setFormat] = useState<'markdown' | 'html'>('markdown')
  const [running, setRunning] = useState<number | null>(null)
  const [lastData, setLastData] = useState<{ dataFileName: string; name: string } | null>(null)
  const openResource = useEditorStore((s) => s.openResource)
  const notify = useJobsStore((s) => s.notify)

  const reload = useCallback(async (): Promise<void> => {
    const [slotsResult, elementsResult] = await Promise.all([
      invoke<{ slots: AnalysisQuerySlot[] }>('analysis.getSlots'),
      invoke<DesignElementRow[]>('design.listElements')
    ])
    if (slotsResult.ok) setSlots(slotsResult.result.slots)
    if (elementsResult.ok) setElements(elementsResult.result)
  }, [])

  useEffect(() => {
    void reload()
    // 設計モデル設定でのクエリ規則更新を即時反映する
    return onBackendEvent((event) => {
      if (event === 'analysis.slotsUpdated') void reload()
    })
  }, [reload])

  const run = async (index: number): Promise<void> => {
    setRunning(index)
    const result = await invoke<AnalysisRunResult>('analysis.run', {
      slotIndex: index,
      startUid: startUid || undefined,
      endUid: endUid || undefined,
      format
    })
    setRunning(null)
    if (result.ok) {
      const r = result.result
      notify(
        'info',
        `設計分析を実行しました: ${r.name}（要素${r.elementCount}件 / 関係${r.relationCount}件 / 経路${r.pathCount}件）`
      )
      setLastData({ dataFileName: r.dataFileName, name: r.name })
      openResource(`report://${r.fileName}`, `分析: ${r.name}`, { preview: false })
    } else {
      notify('error', '設計分析の実行に失敗しました', result.error.message)
    }
  }

  const definedSlots = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.dsl.trim())
  const selectStyle: React.CSSProperties = { width: '100%', margin: '2px 0' }

  return (
    <div data-testid="analysis-sidebar-section">
      <hr style={{ border: 'none', borderTop: '1px solid var(--d2d-border)', margin: '10px 0' }} />
      <div style={{ fontWeight: 600, marginBottom: 2 }}>設計分析（クエリ規則）</div>
      <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11, margin: '2px 0' }}>
        設計モデル設定で定義したクエリ規則（DSL）を適用し、影響範囲・意味的経路を決定論的に導出します。
        結果は分析過程を含むレポートで出力されます。
      </p>
      <div style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>起点要素（クエリにより不要）</div>
      <select
        style={selectStyle}
        value={startUid}
        onChange={(e) => setStartUid(e.target.value)}
        data-testid="analysis-start-select"
        title="分析の起点要素。FROM TYPE で始まるクエリでは未指定でも実行できます"
      >
        <option value="">（未指定）</option>
        {elements.map((el) => (
          <option key={el.uid} value={el.uid}>
            {el.code} {el.title}
          </option>
        ))}
      </select>
      <div style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>終点要素（経路検索で使用）</div>
      <select
        style={selectStyle}
        value={endUid}
        onChange={(e) => setEndUid(e.target.value)}
        data-testid="analysis-end-select"
        title="経路検索（PATH）の終点要素。影響分析だけのクエリでは未指定でかまいません"
      >
        <option value="">（未指定）</option>
        {elements.map((el) => (
          <option key={el.uid} value={el.uid}>
            {el.code} {el.title}
          </option>
        ))}
      </select>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '2px 0' }}>
        <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>レポート形式</span>
        <select
          value={format}
          onChange={(e) => setFormat(e.target.value as 'markdown' | 'html')}
          data-testid="analysis-format-select"
          title="分析レポートの出力形式（ANA-009。HTMLは自己完結ファイル）"
        >
          <option value="markdown">Markdown</option>
          <option value="html">HTML</option>
        </select>
      </div>
      {definedSlots.length === 0 ? (
        <div className="d2d-empty" style={{ padding: 6 }}>
          クエリ規則が未定義です（設計モデル設定で定義できます）
        </div>
      ) : (
        definedSlots.map(({ slot, index }) => (
          <button
            key={index}
            type="button"
            className="d2d-btn"
            style={{ width: '100%', marginTop: 4 }}
            disabled={running !== null}
            onClick={() => void run(index)}
            data-testid={`analysis-run-${index}`}
            title={`クエリ規則を実行してレポートを出力します:\n${slot.dsl}`}
          >
            {running === index ? '実行中…' : slot.name || `スロット${index + 1}`}
          </button>
        ))
      )}
      {lastData && (
        <button
          type="button"
          className="d2d-btn"
          style={{ width: '100%', marginTop: 6 }}
          onClick={() =>
            openResource(`analysis://${lastData.dataFileName}`, `分析グラフ: ${lastData.name}`, { preview: false })
          }
          data-testid="analysis-open-graph"
          title="直前の分析結果を要素・関係のグラフで表示します（ANA-008）"
        >
          最新結果をグラフ表示
        </button>
      )}
    </div>
  )
}

// ---- 設計モデル設定画面のクエリ規則編集（ANA-004、MCP-011/012） ----

export function AnalysisSlotSettingsSection(): React.JSX.Element {
  const [slots, setSlots] = useState<AnalysisQuerySlot[]>([])
  const [validation, setValidation] = useState<Record<number, string>>({})
  const [llmRequest, setLlmRequest] = useState<{ request: PreparedLlmRequest; index: number } | null>(null)
  const [generating, setGenerating] = useState<number | null>(null)
  const notify = useJobsStore((s) => s.notify)

  useEffect(() => {
    void invoke<{ slots: AnalysisQuerySlot[] }>('analysis.getSlots').then((result) => {
      if (result.ok) setSlots(result.result.slots)
    })
  }, [])

  const updateSlot = (index: number, patch: Partial<AnalysisQuerySlot>): void => {
    setSlots((current) => current.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)))
  }

  const validate = async (index: number): Promise<void> => {
    const result = await invoke<DslValidationResult>('analysis.validateDsl', { dsl: slots[index]?.dsl ?? '' })
    if (!result.ok) {
      setValidation((current) => ({ ...current, [index]: result.error.message }))
      return
    }
    const v = result.result
    const message = v.ok
      ? `OK（起点${v.requiresStart ? '必須' : '不要'} / 終点${v.requiresEnd ? '必須' : '不要'}）`
      : v.errors.map((error) => `${error.line}行目: ${error.message}`).join(' / ')
    setValidation((current) => ({ ...current, [index]: message }))
  }

  const save = async (): Promise<void> => {
    const result = await invoke('analysis.saveSlots', { slots })
    if (result.ok) notify('info', '分析クエリ規則を保存しました')
    else notify('error', '分析クエリ規則の保存に失敗しました', result.error.message)
  }

  /** MCP向け説明のLLM自動生成（MCP-012）。送信前確認ダイアログを経由する */
  const openGenerateDescription = async (index: number): Promise<void> => {
    const slot = slots[index]
    if (!slot?.dsl.trim()) {
      notify('error', 'クエリ定義DSLを先に入力してください')
      return
    }
    const result = await invoke<PreparedLlmRequest>('llm.prepareRequest', {
      operation: 'analysis-mcp-description',
      context: { name: slot.name, dsl: slot.dsl }
    })
    if (result.ok) setLlmRequest({ request: result.result, index })
    else notify('error', 'MCP説明生成の確認画面を開けません', result.error.message)
  }

  const generateDescription = async (
    index: number,
    messages: LlmRequestMessage[],
    promptTemplateUid?: string
  ): Promise<void> => {
    setGenerating(index)
    const slot = slots[index]!
    const enq = await invoke<{ jobId: string }>('llm.runConfirmed', {
      operation: 'analysis-mcp-description',
      context: { name: slot.name, dsl: slot.dsl },
      messages,
      promptTemplateUid
    })
    if (!enq.ok) {
      setGenerating(null)
      return notify('error', 'MCP説明の生成を開始できません', enq.error.message)
    }
    for (let i = 0; i < 240; i++) {
      const got = await invoke<{ status: string; output?: { content?: string }; error?: { message: string } }>(
        'job.get',
        { jobId: enq.result.jobId }
      )
      if (got.ok && got.result.status === 'success') {
        const content = (got.result.output?.content ?? '').trim()
        updateSlot(index, { mcpDescription: content.slice(0, 500) })
        notify('info', 'MCP向け説明を生成しました（保存ボタンで確定してください）')
        setGenerating(null)
        return
      }
      if (got.ok && ['failed', 'aborted', 'partial'].includes(got.result.status)) {
        setGenerating(null)
        return notify('error', 'MCP説明の生成に失敗しました', got.result.error?.message)
      }
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
    setGenerating(null)
    notify('error', 'MCP説明の生成がタイムアウトしました')
  }

  return (
    <section data-testid="analysis-slot-settings">
      <h2 style={{ fontSize: 14, marginTop: 24 }}>分析クエリ規則（ANA-001〜004、MCP-011）</h2>
      <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11.5 }}>
        Trace（分析）サイドバーのボタン10種の中身を定義します。DSL は1行1命令:
        <code style={{ display: 'block', margin: '4px 0' }}>
          FROM TYPE model_req,… ／ TRAVERSE 関係,…|* UP|DOWN|BOTH [DEPTH n] [WHERE 属性=値,…] ／ FILTER [NOT]
          TYPE|STATUS|ATTR 値,… ／ SET SAVE|LOAD|UNION|INTERSECT|EXCEPT 名前 ／ PATH 関係,…|* [MAXDEPTH n] [LIMIT m] ／
          # コメント
        </code>
        起点・終点を使わないクエリ（FROM TYPE 始まり等）ではサイドバーの要素指定は不要です。
        MCP向け説明を入力したスロットは、MCPサーバから analysis_slot_番号 ツールとして公開されます。
      </p>
      {slots.map((slot, index) => (
        <div
          key={index}
          style={{ border: '1px solid var(--d2d-border)', borderRadius: 4, padding: 8, margin: '6px 0' }}
          data-testid={`analysis-slot-${index}`}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ color: 'var(--d2d-fg-muted)', width: 70 }}>スロット{index + 1}</span>
            <input
              style={{ flex: 1 }}
              value={slot.name}
              onChange={(e) => updateSlot(index, { name: e.target.value })}
              placeholder="ボタン名（例: 影響範囲（下流3段））"
              data-testid={`analysis-slot-name-${index}`}
              title="Trace（分析）サイドバーに表示するボタン名"
            />
            <button
              type="button"
              className="d2d-btn small"
              onClick={() => void validate(index)}
              data-testid={`analysis-slot-validate-${index}`}
              title="DSLの構文とオントロジー整合を検証します"
            >
              検証
            </button>
          </div>
          <textarea
            style={{ width: '100%', minHeight: 56, marginTop: 4, fontFamily: 'Consolas, monospace', fontSize: 12 }}
            value={slot.dsl}
            onChange={(e) => updateSlot(index, { dsl: e.target.value })}
            placeholder={'例:\nTRAVERSE * DOWN DEPTH 3\nFILTER TYPE model_req'}
            data-testid={`analysis-slot-dsl-${index}`}
            title="クエリ定義DSL。空にするとボタンは非表示になります"
          />
          {validation[index] && (
            <div
              style={{
                fontSize: 11.5,
                color: validation[index]!.startsWith('OK') ? 'var(--d2d-success, #16a34a)' : 'var(--d2d-error)'
              }}
              data-testid={`analysis-slot-validation-${index}`}
            >
              {validation[index]}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 4 }}>
            <textarea
              style={{ flex: 1, minHeight: 36, fontSize: 12 }}
              value={slot.mcpDescription}
              onChange={(e) => updateSlot(index, { mcpDescription: e.target.value })}
              placeholder="MCP向け説明（AIエージェントへ公開するツール説明。空ならこのスロットの用途説明はDSLから自動要約）"
              data-testid={`analysis-slot-mcp-${index}`}
              title="MCPツール（analysis_slot_番号）として公開する際の説明文。LLMで自動生成できます"
            />
            <button
              type="button"
              className="d2d-btn small"
              disabled={generating !== null}
              onClick={() => void openGenerateDescription(index)}
              data-testid={`analysis-slot-mcp-generate-${index}`}
              title="ボタン名とDSLからMCP向け説明をLLMで自動生成します（送信前確認あり）"
            >
              {generating === index ? '生成中…' : 'LLM生成'}
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        className="d2d-btn primary"
        onClick={() => void save()}
        data-testid="analysis-slots-save"
        title="10スロットすべてを保存します（定義済みスロットはDSLを検証してから保存）"
      >
        分析クエリ規則を保存
      </button>
      {llmRequest && (
        <LlmRequestDialog
          request={llmRequest.request}
          screenId="analysis.mcp-description"
          title="MCP向け説明の自動生成"
          onClose={() => setLlmRequest(null)}
          onConfirmed={(messages, promptTemplateUid) =>
            generateDescription(llmRequest.index, messages, promptTemplateUid)
          }
        />
      )}
    </section>
  )
}

// ---- 分析結果グラフ（ANA-008、analysis://<dataFileName>） ----

interface AnalysisResultData {
  name: string
  startUid: string | null
  endUid: string | null
  dsl: string
  elements: { uid: string; code: string; title: string | null; entity_type: string; status: string }[]
  relations: { from_uid: string; to_uid: string; relation_type: string; from_code: string; to_code: string }[]
  paths: {
    nodes: { uid: string; code: string; title: string | null }[]
    segments: { relation_type: string; along: 'forward' | 'backward' }[]
  }[]
  truncated: boolean
  reportFileName?: string
}

interface OntologyInfo {
  models: { model_type: string; sort_order: number }[]
  relations: { relation_type: string; icon_color: string }[]
}

const NODE_WIDTH = 168
const NODE_HEIGHT = 36
const COLUMN_GAP = 90
const ROW_GAP = 14

export function AnalysisGraphEditor({ dataFileName }: { dataFileName: string }): React.JSX.Element {
  const [data, setData] = useState<AnalysisResultData | null>(null)
  const [ontology, setOntology] = useState<OntologyInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const openResource = useEditorStore((s) => s.openResource)

  useEffect(() => {
    void invoke<AnalysisResultData>('analysis.getResult', { dataFileName }).then((result) => {
      if (result.ok) setData(result.result)
      else setError(result.error.message)
    })
    void invoke<OntologyInfo>('ontology.get').then((result) => {
      if (result.ok) setOntology(result.result)
    })
  }, [dataFileName])

  if (error) return <div className="d2d-empty">分析結果を表示できません: {error}</div>
  if (!data) return <div className="d2d-empty">読込中…</div>

  // 列 = entity_type（オントロジーの sort_order 順、非モデル種別は末尾）。行 = code 順
  const sortOrder = new Map((ontology?.models ?? []).map((model) => [model.model_type, model.sort_order]))
  const relationColor = new Map((ontology?.relations ?? []).map((rel) => [rel.relation_type, rel.icon_color]))
  const types = [...new Set(data.elements.map((element) => element.entity_type))].sort(
    (a, b) => (sortOrder.get(a) ?? 9999) - (sortOrder.get(b) ?? 9999) || a.localeCompare(b)
  )
  const positions = new Map<string, { x: number; y: number }>()
  let maxRows = 0
  types.forEach((type, columnIndex) => {
    const columnElements = data.elements
      .filter((element) => element.entity_type === type)
      .sort((a, b) => a.code.localeCompare(b.code))
    maxRows = Math.max(maxRows, columnElements.length)
    columnElements.forEach((element, rowIndex) => {
      positions.set(element.uid, {
        x: 20 + columnIndex * (NODE_WIDTH + COLUMN_GAP),
        y: 34 + rowIndex * (NODE_HEIGHT + ROW_GAP)
      })
    })
  })
  const width = Math.max(680, 40 + types.length * (NODE_WIDTH + COLUMN_GAP))
  const height = Math.max(220, 60 + maxRows * (NODE_HEIGHT + ROW_GAP))

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 12 }} data-testid="analysis-graph-editor">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h2 style={{ fontSize: 15, margin: 0 }}>分析グラフ: {data.name}</h2>
        {data.reportFileName && (
          <button
            type="button"
            className="d2d-btn small"
            onClick={() => openResource(`report://${data.reportFileName}`, `分析: ${data.name}`, { preview: false })}
            data-testid="analysis-graph-open-report"
          >
            レポートを開く
          </button>
        )}
        {data.truncated && <span style={{ color: 'var(--d2d-warning, #d97706)' }}>上限により打ち切りあり</span>}
      </div>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`分析結果グラフ ${data.name}`}
        data-testid="analysis-graph-svg"
        style={{ background: 'var(--d2d-bg-secondary, transparent)', borderRadius: 4 }}
      >
        {types.map((type, columnIndex) => (
          <text
            key={type}
            x={20 + columnIndex * (NODE_WIDTH + COLUMN_GAP)}
            y={20}
            fontSize={12}
            fill="var(--d2d-fg-muted, #888)"
          >
            {type}
          </text>
        ))}
        {data.relations.map((relation, index) => {
          const from = positions.get(relation.from_uid)
          const to = positions.get(relation.to_uid)
          if (!from || !to) return null
          const x1 = from.x + NODE_WIDTH
          const y1 = from.y + NODE_HEIGHT / 2
          const x2 = to.x
          const y2 = to.y + NODE_HEIGHT / 2
          const color = relationColor.get(relation.relation_type) ?? '#9099a8'
          const midX = (x1 + x2) / 2
          return (
            <g key={index}>
              <path
                d={`M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`}
                fill="none"
                stroke={color}
                strokeWidth={1.4}
              />
              <text x={midX} y={(y1 + y2) / 2 - 4} fontSize={10} fill={color} textAnchor="middle">
                {relation.relation_type}
              </text>
            </g>
          )
        })}
        {data.elements.map((element) => {
          const position = positions.get(element.uid)
          if (!position) return null
          const emphasized = element.uid === data.startUid || element.uid === data.endUid
          return (
            <g key={element.uid} data-testid={`analysis-node-${element.code}`}>
              <rect
                x={position.x}
                y={position.y}
                width={NODE_WIDTH}
                height={NODE_HEIGHT}
                rx={5}
                fill="var(--d2d-bg-primary, #fff)"
                stroke={emphasized ? 'var(--d2d-accent, #4aa3df)' : 'var(--d2d-border, #bbb)'}
                strokeWidth={emphasized ? 2.5 : 1}
              />
              <text x={position.x + 8} y={position.y + 15} fontSize={11} fontWeight={600} fill="var(--d2d-fg, #222)">
                {element.code}
              </text>
              <text x={position.x + 8} y={position.y + 29} fontSize={10.5} fill="var(--d2d-fg-muted, #666)">
                {(element.title ?? '').slice(0, 14)}
              </text>
              <title>
                {element.code} {element.title ?? ''}（{element.entity_type} / {element.status}）
              </title>
            </g>
          )
        })}
      </svg>
      {data.paths.length > 0 && (
        <section style={{ marginTop: 10 }}>
          <h3 style={{ fontSize: 13, margin: '4px 0' }}>意味的経路（{data.paths.length}件）</h3>
          <ol style={{ margin: 0, paddingLeft: 22, fontFamily: 'Consolas, monospace', fontSize: 12 }}>
            {data.paths.map((path, index) => (
              <li key={index}>
                {path.nodes
                  .map((node, nodeIndex) => {
                    if (nodeIndex === 0) return node.code
                    const segment = path.segments[nodeIndex - 1]!
                    const arrow =
                      segment.along === 'forward' ? `-[${segment.relation_type}]->` : `<-[${segment.relation_type}]-`
                    return ` ${arrow} ${node.code}`
                  })
                  .join('')}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
