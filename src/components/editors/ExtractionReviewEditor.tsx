/**
 * Extraction Review Editor（P5-6、V-02、EXT-020〜024、sdd_ui_design §7.1/§8.1）。
 * 要素一覧（左）と Markdown プレビュー（右）の対照表示 + レビュー判断操作。
 * 採用確定で②正本化（approved）し extraction.completed を発行する。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { invoke } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { VirtualDataGrid } from '../common/VirtualDataGrid'
import { MarkdownPreview } from '../common/MarkdownPreview'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'

interface ReviewElement {
  id: string
  type: string
  text?: string
  level?: number
  section_path?: string
  image?: string
  resource_uid?: string
  review?: { status: string; code: string }
}

interface ExtractedDoc {
  uid: string
  code: string
  title: string | null
  status: string
  metadata: Record<string, unknown>
  elements: ReviewElement[]
}

export function ExtractionReviewEditor({ uid }: { uid: string }): React.JSX.Element {
  const [doc, setDoc] = useState<ExtractedDoc | null>(null)
  const [markdown, setMarkdown] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const notify = useJobsStore((s) => s.notify)

  const load = useCallback(async () => {
    const [docRes, mdRes] = await Promise.all([
      invoke<ExtractedDoc>('extracted.get', { uid }),
      invoke<{ markdown: string }>('extracted.getMarkdown', { uid, variant: 'review' })
    ])
    if (docRes.ok) setDoc(docRes.result)
    if (mdRes.ok) setMarkdown(mdRes.result.markdown)
  }, [uid])

  useEffect(() => {
    void load()
  }, [load])

  const selected = doc?.elements.find((e) => e.id === selectedId) ?? null

  const setStatus = async (element: ReviewElement, status: string): Promise<void> => {
    if (!element.resource_uid) return
    const res = await invoke('extracted.updateItemStatus', { resourceUid: element.resource_uid, status })
    if (res.ok) {
      await load()
    } else {
      notify('error', 'レビュー状態を更新できませんでした', res.error.message)
    }
  }

  const approveAll = async (): Promise<void> => {
    const res = await invoke<{ approvedCount: number }>('extracted.approve', { uid })
    if (res.ok) {
      notify('info', `②抽出データを正本確定しました（${res.result.approvedCount} 要素）`)
      await load()
      void useProjectStore.getState().refreshStats()
    } else {
      notify('error', '確定できませんでした', res.error.message)
    }
  }

  const columns = useMemo<ColumnDef<ReviewElement, unknown>[]>(
    () => [
      {
        header: '状態',
        accessorKey: 'review',
        size: 70,
        cell: ({ row }) => (
          <ReviewStatusBadge status={reviewStateFromEntityStatus(row.original.review?.status ?? 'draft')} />
        )
      },
      { header: '種別', accessorKey: 'type', size: 80 },
      {
        header: '内容',
        accessorFn: (e) => e.text ?? e.image ?? '',
        cell: ({ getValue }) => <span>{String(getValue())}</span>
      },
      { header: '章節', accessorKey: 'section_path', size: 140 }
    ],
    []
  )

  if (!doc) return <div className="d2d-empty">読込中…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="extraction-review-editor">
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
        <span style={{ color: 'var(--d2d-fg-muted)' }}>{doc.elements.length} 要素</span>
        <span style={{ flex: 1 }} />
        {selected && (
          <>
            <button type="button" className="d2d-btn small" onClick={() => void setStatus(selected, 'approved')}>
              確認済にする
            </button>
            <button type="button" className="d2d-btn small" onClick={() => void setStatus(selected, 'review')}>
              要修正
            </button>
            <button type="button" className="d2d-btn small" onClick={() => void setStatus(selected, 'rejected')}>
              棄却
            </button>
          </>
        )}
        <button
          type="button"
          className="d2d-btn primary"
          onClick={() => void approveAll()}
          disabled={doc.status === 'approved'}
          data-testid="approve-all-button"
        >
          {doc.status === 'approved' ? '正本確定済み' : '採用確定（②正本へ反映）'}
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, padding: 8 }}>
          <VirtualDataGrid<ReviewElement>
            columns={columns}
            data={doc.elements}
            getRowId={(e) => e.id}
            onRowClick={(e) => setSelectedId(e.id)}
            testId="element-grid"
          />
        </div>
        <div
          style={{ flex: 1, minWidth: 0, overflow: 'auto', borderLeft: '1px solid var(--d2d-border)' }}
          data-testid="review-markdown"
        >
          <MarkdownPreview markdown={markdown} />
        </div>
      </div>
    </div>
  )
}
