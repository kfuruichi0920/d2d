/**
 * Intermediate Document Editor（P7-7、V-03、UI-012、EDIT-002〜008）。
 * ③中間データの文書風表示 + 要素編集（編集/マージ/分割/LLM候補）+ 正本確定。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { VirtualDataGrid } from '../common/VirtualDataGrid'
import { MarkdownPreview } from '../common/MarkdownPreview'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'

interface IntermediateElement {
  id: string
  type: string
  text?: string
  level?: number
  section_path?: string
  image?: string
  resource_uid?: string
  review?: { status: string }
}

interface IntermediateDoc {
  uid: string
  code: string
  title: string | null
  status: string
  artifact_type_id: string
  dev_phase_id: string
  intermediate_status: string
  sources: { extracted_document_uid: string; order: number }[]
  elements: IntermediateElement[]
}

interface TextCandidate {
  llmRunUid: string
  elementId: string
  purpose: string
  originalText: string
  candidateText: string
}

export function IntermediateDocumentEditor({ uid }: { uid: string }): React.JSX.Element {
  const [doc, setDoc] = useState<IntermediateDoc | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editText, setEditText] = useState<string | null>(null)
  const [candidate, setCandidate] = useState<TextCandidate | null>(null)
  const [generating, setGenerating] = useState(false)
  const notify = useJobsStore((s) => s.notify)

  const load = useCallback(async () => {
    const [docRes, mdRes] = await Promise.all([
      invoke<IntermediateDoc>('intermediate.get', { uid }),
      invoke<{ markdown: string }>('intermediate.getMarkdown', { uid, variant: 'review' })
    ])
    if (docRes.ok) setDoc(docRes.result)
    if (mdRes.ok) setMarkdown(mdRes.result.markdown)
  }, [uid])

  useEffect(() => {
    void load()
  }, [load])

  const selected = doc?.elements.find((e) => e.id === selectedId) ?? null
  const selectedIndex = doc?.elements.findIndex((e) => e.id === selectedId) ?? -1

  const call = async (method: string, params: Record<string, unknown>, successMessage?: string): Promise<boolean> => {
    const res = await invoke(method, { uid, ...params })
    if (res.ok) {
      if (successMessage) notify('info', successMessage)
      await load()
      return true
    }
    notify('error', '操作に失敗しました', res.error.message)
    return false
  }

  const saveEdit = async (): Promise<void> => {
    if (!selected || editText === null) return
    if (
      await call(
        'intermediate.editElementText',
        { elementId: selected.id, newText: editText },
        '要素を編集しました（新IDを割当て）'
      )
    ) {
      setEditText(null)
    }
  }

  const merge = async (): Promise<void> => {
    if (!doc || !selected || selectedIndex < 0) return
    const next = doc.elements[selectedIndex + 1]
    if (!next) return
    await call('intermediate.mergeElements', { elementIds: [selected.id, next.id] }, '次の要素とマージしました')
  }

  const split = async (): Promise<void> => {
    if (!selected?.text) return
    const half = Math.floor(selected.text.length / 2)
    const breakpoint = selected.text.indexOf('。', half)
    const at = breakpoint > 0 && breakpoint < selected.text.length - 1 ? breakpoint + 1 : half
    await call(
      'intermediate.splitElement',
      { elementId: selected.id, texts: [selected.text.slice(0, at), selected.text.slice(at)] },
      '要素を分割しました'
    )
  }

  const generateCandidate = async (purpose: 'normalize' | 'describe'): Promise<void> => {
    if (!selected) return
    setGenerating(true)
    setCandidate(null)
    try {
      const enq = await invoke<{ jobId: string }>('intermediate.generateTextCandidate', {
        uid,
        elementId: selected.id,
        purpose
      })
      if (!enq.ok) {
        notify('error', '候補生成を開始できませんでした', enq.error.message)
        return
      }
      for (let i = 0; i < 240; i++) {
        const got = await invoke<{ status: string; output: TextCandidate; error?: { message: string } | null }>(
          'job.get',
          {
            jobId: enq.result.jobId
          }
        )
        if (got.ok && got.result.status === 'success') {
          setCandidate(got.result.output)
          return
        }
        if (got.ok && ['failed', 'aborted', 'partial'].includes(got.result.status)) {
          notify('error', 'LLM 候補生成に失敗しました', got.result.error?.message)
          return
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      notify('error', 'LLM 候補生成がタイムアウトしました')
    } finally {
      setGenerating(false)
    }
  }

  const adoptCandidate = async (): Promise<void> => {
    if (!candidate) return
    if (
      await call(
        'intermediate.adoptTextCandidate',
        { elementId: candidate.elementId, newText: candidate.candidateText, llmRunUid: candidate.llmRunUid },
        'LLM 候補を採用しました（根拠に llm_run を記録）'
      )
    ) {
      setCandidate(null)
    }
  }

  const approve = async (): Promise<void> => {
    if (await call('intermediate.approve', {}, '③中間データを正本確定しました')) {
      void useProjectStore.getState().refreshStats()
    }
  }

  const columns = useMemo<ColumnDef<IntermediateElement, unknown>[]>(
    () => [
      {
        header: '状態',
        accessorKey: 'review',
        cell: ({ row }) => (
          <ReviewStatusBadge status={reviewStateFromEntityStatus(row.original.review?.status ?? 'draft')} />
        )
      },
      { header: 'ID', accessorKey: 'id', size: 50 },
      { header: '種別', accessorKey: 'type', size: 80 },
      { header: '内容', accessorFn: (e) => e.text ?? e.image ?? '' },
      { header: '章節', accessorKey: 'section_path', size: 130 }
    ],
    []
  )

  if (!doc) return <div className="d2d-empty">読込中…</div>

  const canText = selected && ['paragraph', 'heading', 'list_item', 'caption'].includes(selected.type)
  const nextElement = selectedIndex >= 0 ? doc.elements[selectedIndex + 1] : undefined
  const canMerge =
    selected &&
    nextElement &&
    ['paragraph', 'list_item'].includes(selected.type) &&
    ['paragraph', 'list_item'].includes(nextElement.type)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="intermediate-editor">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px',
          borderBottom: '1px solid var(--d2d-border)'
        }}
      >
        <h1 style={{ fontSize: 14, margin: 0 }}>{doc.title ?? doc.code}</h1>
        <ReviewStatusBadge status={reviewStateFromEntityStatus(doc.status)} />
        <span style={{ color: 'var(--d2d-fg-muted)' }}>
          {doc.artifact_type_id} / {doc.dev_phase_id} / {doc.elements.length} 要素 / 統合元 {doc.sources.length} 文書
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="d2d-btn primary"
          onClick={() => void approve()}
          disabled={doc.status === 'approved'}
          data-testid="intermediate-approve"
        >
          {doc.status === 'approved' ? '正本確定済み' : '③正本として確定'}
        </button>
      </div>

      {selected && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'center',
            padding: '4px 12px',
            borderBottom: '1px solid var(--d2d-border)'
          }}
          data-testid="element-toolbar"
        >
          <span style={{ color: 'var(--d2d-fg-muted)' }}>選択: {selected.id}</span>
          {canText && (
            <button type="button" className="d2d-btn small" onClick={() => setEditText(selected.text ?? '')}>
              編集
            </button>
          )}
          {canMerge && (
            <button type="button" className="d2d-btn small" onClick={() => void merge()} data-testid="merge-button">
              次とマージ
            </button>
          )}
          {selected.type === 'paragraph' && (
            <button type="button" className="d2d-btn small" onClick={() => void split()}>
              分割
            </button>
          )}
          {canText && (
            <button
              type="button"
              className="d2d-btn small"
              disabled={generating}
              onClick={() => void generateCandidate('normalize')}
              data-testid="normalize-button"
            >
              {generating ? '生成中…' : 'LLM正規化候補'}
            </button>
          )}
          {(selected.type === 'table' || selected.type === 'figure') && (
            <button
              type="button"
              className="d2d-btn small"
              disabled={generating}
              onClick={() => void generateCandidate('describe')}
            >
              {generating ? '生成中…' : 'LLM説明候補'}
            </button>
          )}
        </div>
      )}

      {editText !== null && selected && (
        <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--d2d-border)' }}>
          <textarea
            style={{ width: '100%', minHeight: 60 }}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            data-testid="edit-textarea"
          />
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="d2d-btn primary small"
              onClick={() => void saveEdit()}
              data-testid="edit-save"
            >
              保存（新IDで反映）
            </button>
            <button type="button" className="d2d-btn small" onClick={() => setEditText(null)}>
              キャンセル
            </button>
          </div>
        </div>
      )}

      {candidate && (
        <div
          data-testid="candidate-panel"
          style={{
            padding: '6px 12px',
            borderBottom: '1px solid var(--d2d-border)',
            borderLeft: '3px solid var(--d2d-review-candidate)'
          }}
        >
          <div style={{ fontWeight: 700 }}>
            LLM {candidate.purpose === 'normalize' ? '正規化' : '説明'}候補（採用まで正本を変更しません）
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '4px 0' }}>
            <div>
              <div style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>元</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{candidate.originalText || '（なし）'}</div>
            </div>
            <div>
              <div style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>候補</div>
              <div style={{ whiteSpace: 'pre-wrap' }} data-testid="candidate-text">
                {candidate.candidateText}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className="d2d-btn primary small"
              onClick={() => void adoptCandidate()}
              data-testid="candidate-adopt"
            >
              採用
            </button>
            <button type="button" className="d2d-btn small" onClick={() => setCandidate(null)}>
              棄却
            </button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, padding: 8 }}>
          <VirtualDataGrid<IntermediateElement>
            columns={columns}
            data={doc.elements}
            getRowId={(e) => e.id}
            onRowClick={(e) => {
              setSelectedId(e.id)
              setEditText(null)
            }}
            testId="intermediate-grid"
          />
        </div>
        <div
          style={{ flex: 1, minWidth: 0, overflow: 'auto', borderLeft: '1px solid var(--d2d-border)' }}
          data-testid="intermediate-markdown"
        >
          <MarkdownPreview markdown={markdown} />
        </div>
      </div>
    </div>
  )
}
