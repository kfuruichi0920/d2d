/**
 * 設計分析 UI（ANA-001〜006）。
 * - AnalysisSideBarSection: Trace（分析）サイドバーの実行ボタン10種＋起点・終点要素設定
 * - AnalysisSlotSettingsSection: 設計モデル設定画面のクエリ規則（ボタン名＋DSL）編集
 * 実行結果は分析過程を含むレポート（exports/reports/）へ出力し、report:// で開く。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import type { DesignElementRow } from './DesignModelViews'

export interface AnalysisQuerySlot {
  name: string
  dsl: string
}

interface AnalysisRunResult {
  name: string
  fileName: string
  path: string
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
  const [running, setRunning] = useState<number | null>(null)
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
      endUid: endUid || undefined
    })
    setRunning(null)
    if (result.ok) {
      const r = result.result
      notify(
        'info',
        `設計分析を実行しました: ${r.name}（要素${r.elementCount}件 / 関係${r.relationCount}件 / 経路${r.pathCount}件）`
      )
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
    </div>
  )
}

// ---- 設計モデル設定画面のクエリ規則編集（ANA-004） ----

export function AnalysisSlotSettingsSection(): React.JSX.Element {
  const [slots, setSlots] = useState<AnalysisQuerySlot[]>([])
  const [validation, setValidation] = useState<Record<number, string>>({})
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

  return (
    <section data-testid="analysis-slot-settings">
      <h2 style={{ fontSize: 14, marginTop: 24 }}>分析クエリ規則（ANA-001〜004）</h2>
      <p style={{ color: 'var(--d2d-fg-muted)', fontSize: 11.5 }}>
        Trace（分析）サイドバーのボタン10種の中身を定義します。DSL は1行1命令:
        <code style={{ display: 'block', margin: '4px 0' }}>
          FROM TYPE model_req,… ／ TRAVERSE 関係,…|* UP|DOWN|BOTH [DEPTH n] ／ FILTER TYPE|STATUS 値,… ／ PATH 関係,…|*
          [MAXDEPTH n] [LIMIT m] ／ # コメント
        </code>
        起点・終点を使わないクエリ（FROM TYPE 始まり等）ではサイドバーの要素指定は不要です。
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
    </section>
  )
}
