/**
 * レポートビュー群（P13、EXP-001〜006、V-13）。
 * - ReportSideBar: 出力対象・フィルタ・形式の設定と生成、出力履歴
 * - ReportPreviewEditor: report://<fileName> の Markdown / HTML プレビュー
 */
import { useCallback, useEffect, useState } from 'react'
import DOMPurify from 'dompurify'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { MarkdownPreview } from '../common/MarkdownPreview'
import { EvalSection } from './EvalViews'

const CATEGORIES = [
  'model_src',
  'model_std',
  'model_req',
  'model_cst',
  'model_func',
  'model_struct',
  'model_beh',
  'model_state',
  'model_data',
  'model_if',
  'model_verif',
  'model_impl',
  'model_mgmt'
]
const INFO_TYPES = [
  { id: 'heading', label: '見出し' },
  { id: 'paragraph', label: '段落' },
  { id: 'list_item', label: '箇条書き' },
  { id: 'table', label: '表' },
  { id: 'figure', label: '図' }
]

interface ReportItem {
  fileName: string
  format: 'markdown' | 'html'
  size: number
  modifiedAt: string
}

export function ReportSideBar(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const openResource = useEditorStore((s) => s.openResource)
  const notify = useJobsStore((s) => s.notify)

  const [format, setFormat] = useState<'markdown' | 'html'>('markdown')
  const [sections, setSections] = useState({ sources: true, intermediate: true, design: true, relations: true })
  const [categories, setCategories] = useState<string[]>([])
  const [infoTypes, setInfoTypes] = useState<string[]>([])
  const [sectionPath, setSectionPath] = useState('')
  const [status, setStatus] = useState('')
  const [elementCodes, setElementCodes] = useState('')
  const [reports, setReports] = useState<ReportItem[]>([])

  const refresh = useCallback(async () => {
    const res = await invoke<ReportItem[]>('report.list')
    if (res.ok) setReports(res.result)
  }, [])

  useEffect(() => {
    if (!project) return
    void refresh()
    return onBackendEvent((event, payload) => {
      if (event === 'report.generated') {
        void refresh()
        const p = payload as { fileName: string }
        notify('info', `レポートを出力しました: ${p.fileName}`)
      }
    })
  }, [project, refresh, notify])

  if (!project) return <div className="d2d-empty">プロジェクトが開かれていません。</div>

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value]

  const generate = async (): Promise<void> => {
    const res = await invoke('report.generate', {
      format,
      sections,
      filters: {
        categories,
        infoTypes,
        sectionPath: sectionPath.trim() || undefined,
        status: status || undefined,
        elementCodes: elementCodes
          .split(/[,\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
      }
    })
    if (res.ok) notify('info', 'レポート生成ジョブを開始しました')
    else notify('error', 'レポートを生成できませんでした', res.error.message)
  }

  const checkboxRow = (checked: boolean, label: string, onChange: () => void, testId?: string): React.JSX.Element => (
    <label key={label} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
      <input type="checkbox" checked={checked} onChange={onChange} data-testid={testId} />
      {label}
    </label>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }} data-testid="report-sidebar">
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--d2d-fg-muted)' }}>出力形式（EXP-005/006）</div>
      <div style={{ display: 'flex', gap: 10 }}>
        {(['markdown', 'html'] as const).map((f) => (
          <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
            <input
              type="radio"
              name="report-format"
              checked={format === f}
              onChange={() => setFormat(f)}
              data-testid={`report-format-${f}`}
            />
            {f === 'markdown' ? 'Markdown' : 'HTML'}
          </label>
        ))}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--d2d-fg-muted)' }}>出力範囲（EXP-004）</div>
      {checkboxRow(sections.sources, '①② 原本・抽出（由来情報）', () =>
        setSections((s) => ({ ...s, sources: !s.sources }))
      )}
      {checkboxRow(sections.intermediate, '③ 中間データ（文書風）', () =>
        setSections((s) => ({ ...s, intermediate: !s.intermediate }))
      )}
      {checkboxRow(sections.design, '④ 設計要素', () => setSections((s) => ({ ...s, design: !s.design })))}
      {checkboxRow(sections.relations, '関係一覧', () => setSections((s) => ({ ...s, relations: !s.relations })))}

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--d2d-fg-muted)' }}>フィルタ（EXP-003）</div>
      <details>
        <summary style={{ fontSize: 12, cursor: 'pointer' }}>設計観点（{categories.length || '全て'}）</summary>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', paddingLeft: 8 }}>
          {CATEGORIES.map((c) =>
            checkboxRow(categories.includes(c), c, () => setCategories((prev) => toggle(prev, c)), `report-cat-${c}`)
          )}
        </div>
      </details>
      <details>
        <summary style={{ fontSize: 12, cursor: 'pointer' }}>③ 情報種別（{infoTypes.length || '全て'}）</summary>
        <div style={{ paddingLeft: 8 }}>
          {INFO_TYPES.map((t) =>
            checkboxRow(infoTypes.includes(t.id), t.label, () => setInfoTypes((prev) => toggle(prev, t.id)))
          )}
        </div>
      </details>
      <input
        placeholder="章・節（例: 1 で第1章のみ）"
        value={sectionPath}
        onChange={(e) => setSectionPath(e.target.value)}
        style={{ fontSize: 12 }}
      />
      <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ fontSize: 12 }}>
        <option value="">レビュー状態: 全て</option>
        <option value="approved">approved（正本のみ）</option>
        <option value="draft">draft（候補のみ）</option>
      </select>
      <input
        placeholder="設計要素コード（REQ-000001, …）"
        value={elementCodes}
        onChange={(e) => setElementCodes(e.target.value)}
        style={{ fontSize: 12 }}
      />

      <button type="button" className="d2d-btn primary" onClick={() => void generate()} data-testid="report-generate">
        レポート生成
      </button>

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--d2d-fg-muted)', marginTop: 6 }}>
        出力履歴（{reports.length}）
      </div>
      <div data-testid="reports-list">
        {reports.length === 0 && <div className="d2d-empty">レポートはまだありません</div>}
        {reports.map((r) => (
          <div
            key={r.fileName}
            className="d2d-list-row"
            onClick={() => openResource(`report://${r.fileName}`, r.fileName, { preview: true })}
            data-testid={`report-item-${r.fileName}`}
            title={r.modifiedAt}
          >
            {r.format === 'html' ? '🌐' : '📄'} {r.fileName}
          </div>
        ))}
      </div>
      <EvalSection />
    </div>
  )
}

/** レポートプレビュー（report://<fileName>） */
export function ReportPreviewEditor({ fileName }: { fileName: string }): React.JSX.Element {
  const [content, setContent] = useState<{ format: 'markdown' | 'html'; content: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void invoke<{ format: 'markdown' | 'html'; content: string }>('report.getContent', { fileName }).then((res) => {
      if (res.ok) setContent(res.result)
      else setError(res.error.message)
    })
  }, [fileName])

  if (error) return <div className="d2d-empty">レポートを表示できません: {error}</div>
  if (!content) return <div className="d2d-empty">読込中…</div>

  if (content.format === 'html') {
    // 自己完結 HTML をサニタイズして枠内表示（スクリプトなし・オフライン前提）
    return (
      <iframe
        title={fileName}
        sandbox=""
        srcDoc={DOMPurify.sanitize(content.content, { WHOLE_DOCUMENT: true })}
        style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
        data-testid="report-html-preview"
      />
    )
  }
  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 16 }} data-testid="report-md-preview">
      <MarkdownPreview markdown={content.content} />
    </div>
  )
}
