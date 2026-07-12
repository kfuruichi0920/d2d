/**
 * Intermediate Document Editor（P7-7、V-03、UI-012、EDIT-002〜008）。
 * ③中間データの文書風表示 + 要素編集（編集/マージ/分割/LLM候補）+ 正本確定。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { useSelectionStore } from '../../stores/selection-store'
import { VirtualDataGrid } from '../common/VirtualDataGrid'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'

interface IntermediateElement {
  id: string
  type: string
  text?: string
  level?: number
  section_path?: string
  image?: string
  rows?: { text: string }[][]
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

function HighlightTerms({ text, terms }: { text: string; terms: string[] }): React.JSX.Element {
  const active = terms.filter(Boolean).sort((a, b) => b.length - a.length)
  if (active.length === 0) return <>{text}</>
  const pattern = new RegExp(`(${active.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'g')
  return (
    <>
      {text.split(pattern).map((part, index) =>
        active.includes(part) ? (
          <mark className="d2d-term" key={index}>
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  )
}

function FigureElement({ element }: { element: IntermediateElement }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (element.resource_uid)
      void invoke<{ dataUrl: string }>('extracted.getFigurePreview', { resourceUid: element.resource_uid }).then(
        (r) => {
          if (r.ok) setSrc(r.result.dataUrl)
        }
      )
  }, [element.resource_uid])
  return src ? (
    <img src={src} alt={element.image ?? '図'} style={{ maxWidth: '100%', maxHeight: 420 }} />
  ) : (
    <div className="d2d-empty">図を読込中…</div>
  )
}

export function IntermediateDocumentEditor({ uid }: { uid: string }): React.JSX.Element {
  const [doc, setDoc] = useState<IntermediateDoc | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sourceItems, setSourceItems] = useState<(IntermediateElement & { source_title?: string })[]>([])
  const [sourceSelectedIds, setSourceSelectedIds] = useState<Set<string>>(new Set())
  const [sourceActiveId, setSourceActiveId] = useState<string | null>(null)
  const [lastSelectedPane, setLastSelectedPane] = useState<'source' | 'intermediate'>('intermediate')
  const previewRefs = useRef(new Map<string, HTMLElement>())
  const [editText, setEditText] = useState<string | null>(null)
  const [editCells, setEditCells] = useState<string[][] | null>(null)
  const [candidate, setCandidate] = useState<TextCandidate | null>(null)
  const [generating, setGenerating] = useState(false)
  const [terms, setTerms] = useState<string[]>([])
  const notify = useJobsStore((s) => s.notify)
  const setWorkbenchItems = useSelectionStore((s) => s.setWorkbenchItems)

  const load = useCallback(async () => {
    const [docRes, mdRes, termsRes] = await Promise.all([
      invoke<IntermediateDoc>('intermediate.get', { uid }),
      invoke<(IntermediateElement & { source_title?: string })[]>('intermediate.getSourceItems', { uid }),
      invoke<{ term_text: string }[]>('glossary.list', { approvedOnly: true })
    ])
    if (docRes.ok) setDoc(docRes.result)
    if (mdRes.ok) setSourceItems(mdRes.result)
    if (termsRes.ok) setTerms(termsRes.result.map((term) => term.term_text))
  }, [uid])

  useEffect(() => {
    void load()
    // 用語承認等で開いたままのタブにもハイライトを反映する（EDIT-056）
    return onBackendEvent((event) => {
      if (event === 'glossary.updated') void load()
    })
  }, [load])

  useEffect(() => {
    const items =
      lastSelectedPane === 'source'
        ? sourceItems
            .filter((e) => sourceSelectedIds.has(e.id))
            .map((e) => ({
              pane: 'extracted' as const,
              id: e.id,
              type: e.type,
              resourceUid: e.resource_uid ?? null,
              text: e.text ?? e.image ?? null,
              status: e.review?.status ?? 'approved',
              sourceTitle: e.source_title
            }))
        : (doc?.elements ?? [])
            .filter((e) => selectedIds.has(e.id))
            .map((e) => ({
              pane: 'intermediate' as const,
              id: e.id,
              type: e.type,
              resourceUid: e.resource_uid ?? null,
              text: e.text ?? e.image ?? null,
              status: e.review?.status ?? 'draft'
            }))
    setWorkbenchItems(items)
  }, [lastSelectedPane, sourceItems, sourceSelectedIds, doc, selectedIds, setWorkbenchItems])

  const selected = doc?.elements.find((e) => e.id === activeId) ?? null
  const selectedIndex = doc?.elements.findIndex((e) => e.id === activeId) ?? -1

  const selectRows = <T extends { id: string }>(
    items: T[],
    item: T,
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
    current: Set<string>,
    anchor: string | null
  ): Set<string> => {
    if (event.shiftKey && anchor) {
      const a = items.findIndex((x) => x.id === anchor),
        b = items.findIndex((x) => x.id === item.id)
      if (a >= 0 && b >= 0) return new Set(items.slice(Math.min(a, b), Math.max(a, b) + 1).map((x) => x.id))
    }
    if (event.ctrlKey || event.metaKey) {
      const next = new Set(current)
      if (next.has(item.id)) next.delete(item.id)
      else next.add(item.id)
      return next
    }
    return new Set([item.id])
  }

  useEffect(() => {
    if (activeId) previewRefs.current.get(activeId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeId])

  const integrate = async (position: 'above' | 'below'): Promise<void> => {
    if ((doc?.elements.length ?? 0) > 0 && (!activeId || selectedIds.size !== 1)) return
    const resourceUids = sourceItems
      .filter((x) => sourceSelectedIds.has(x.id))
      .map((x) => x.resource_uid)
      .filter((x): x is string => Boolean(x))
    await call(
      'intermediate.insertExtractedItems',
      { resourceUids, targetElementId: activeId, position },
      `${resourceUids.length}要素を統合しました`
    )
  }
  const applyStatus = async (status: string): Promise<void> => {
    await call(
      'intermediate.updateItemStatuses',
      { elementIds: [...selectedIds], status },
      'レビュー状態を更新しました'
    )
  }
  const move = async (direction: 'up' | 'down'): Promise<void> => {
    await call('intermediate.reorderItems', { elementIds: [...selectedIds], direction }, '表示順を更新しました')
  }
  const hierarchy = async (delta: number): Promise<void> => {
    await call('intermediate.changeHierarchy', { elementIds: [...selectedIds], delta }, '階層を更新しました')
  }

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

  /** ③→④: 全要素からチャンクを作成し LLM 候補を生成、候補セットレビューを開く（P8-3） */
  const generateDesignCandidates = async (): Promise<void> => {
    if (!doc) return
    setGenerating(true)
    try {
      const chunkRes = await invoke<{ chunkUid: string }>('chunk.create', {
        intermediateDocumentUid: uid,
        elementIds: doc.elements.map((e) => e.id)
      })
      if (!chunkRes.ok) {
        notify('error', 'チャンクを作成できませんでした', chunkRes.error.message)
        return
      }
      const enq = await invoke<{ jobId: string }>('design.generateCandidates', { chunkUid: chunkRes.result.chunkUid })
      if (!enq.ok) {
        notify('error', '候補生成を開始できませんでした', enq.error.message)
        return
      }
      for (let i = 0; i < 240; i++) {
        const got = await invoke<{
          status: string
          output: { llmRunUid: string; elementCount: number }
          error?: { message: string } | null
        }>('job.get', { jobId: enq.result.jobId })
        if (got.ok && got.result.status === 'success') {
          notify('info', `④モデル候補を生成しました（要素 ${got.result.output.elementCount} 件）`)
          useEditorStore
            .getState()
            .openResource(`candidate://${got.result.output.llmRunUid}`, '④候補セット', { preview: false })
          return
        }
        if (got.ok && ['failed', 'aborted', 'partial'].includes(got.result.status)) {
          notify('error', '④候補生成に失敗しました', got.result.error?.message)
          return
        }
        await new Promise((r) => setTimeout(r, 500))
      }
      notify('error', '④候補生成がタイムアウトしました')
    } finally {
      setGenerating(false)
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
      { header: '内容', accessorFn: (e) => `${'　'.repeat(e.level ?? 0)}${e.text ?? e.image ?? ''}` },
      { header: '章節', accessorKey: 'section_path', size: 130 }
    ],
    []
  )

  const sourceColumns: ColumnDef<IntermediateElement & { source_title?: string }, unknown>[] = [
    {
      header: '選択',
      cell: ({ row }) => <input type="checkbox" readOnly checked={sourceSelectedIds.has(row.original.id)} />
    },
    { header: '統合元', accessorKey: 'source_title' },
    { header: '種別', accessorKey: 'type' },
    { header: '内容', accessorFn: (e) => e.text ?? e.image ?? '' }
  ]

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
          className="d2d-btn"
          disabled={generating}
          onClick={() => void generateDesignCandidates()}
          data-testid="generate-design-candidates"
          title="全要素からチャンクを作成し、LLM で④設計モデル候補を生成します"
        >
          {generating ? '生成中…' : '④モデル候補を生成（LLM）'}
        </button>
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
          {selected.type === 'table' && (
            <button
              type="button"
              className="d2d-btn small"
              onClick={() => setEditCells((selected.rows ?? []).map((row) => row.map((cell) => cell.text)))}
              data-testid="edit-table-button"
            >
              表を編集
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

      {editCells && selected && (
        <div
          style={{ padding: '6px 12px', borderBottom: '1px solid var(--d2d-border)' }}
          data-testid="table-cell-editor"
        >
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>
            表グリッド編集（EDIT-022。保存でセルIDを付与した新リソースへ反映）
          </div>
          <table style={{ borderCollapse: 'collapse' }}>
            <tbody>
              {editCells.map((row, rowNo) => (
                <tr key={rowNo}>
                  {row.map((cell, colNo) => (
                    <td key={colNo} style={{ border: '1px solid var(--d2d-border)', padding: 2 }}>
                      <input
                        value={cell}
                        style={{ width: 130 }}
                        data-testid={`cell-${rowNo}-${colNo}`}
                        onChange={(e) =>
                          setEditCells((prev) =>
                            prev!.map((r, i) => (i === rowNo ? r.map((c, j) => (j === colNo ? e.target.value : c)) : r))
                          )
                        }
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      type="button"
                      className="d2d-btn small"
                      title="この行の右に列を追加"
                      onClick={() => setEditCells((prev) => prev!.map((r, i) => (i === rowNo ? [...r, ''] : r)))}
                    >
                      +列
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <button
              type="button"
              className="d2d-btn small"
              onClick={() => setEditCells((prev) => [...prev!, prev![0]!.map(() => '')])}
            >
              +行
            </button>
            <button
              type="button"
              className="d2d-btn primary small"
              data-testid="table-save"
              onClick={() =>
                void call(
                  'table.editIntermediateTable',
                  { elementId: selected.id, cells: editCells },
                  '表を編集しました（セルIDを付与）'
                ).then((ok) => ok && setEditCells(null))
              }
            >
              保存
            </button>
            <button type="button" className="d2d-btn small" onClick={() => setEditCells(null)}>
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

      <div style={{ display: 'flex', gap: 6, padding: '4px 12px', borderBottom: '1px solid var(--d2d-border)' }}>
        <button
          className="d2d-btn small"
          disabled={sourceSelectedIds.size === 0 || (doc.elements.length > 0 && selectedIds.size !== 1)}
          onClick={() => void integrate('above')}
        >
          {doc.elements.length === 0 ? '選択②を最初に統合' : '選択②を上へ統合'}
        </button>
        <button
          className="d2d-btn small"
          disabled={sourceSelectedIds.size === 0 || selectedIds.size !== 1}
          onClick={() => void integrate('below')}
        >
          選択②を下へ統合
        </button>
        <span style={{ borderLeft: '1px solid var(--d2d-border)' }} />
        <button className="d2d-btn small" onClick={() => void move('up')}>
          ↑移動
        </button>
        <button className="d2d-btn small" onClick={() => void move('down')}>
          ↓移動
        </button>
        <button className="d2d-btn small" onClick={() => void hierarchy(-1)}>
          階層を上げる
        </button>
        <button className="d2d-btn small" onClick={() => void hierarchy(1)}>
          階層を下げる
        </button>
        <span style={{ flex: 1 }} />
        <button className="d2d-btn small" onClick={() => void applyStatus('approved')}>
          確認済みにする
        </button>
        <button className="d2d-btn small" onClick={() => void applyStatus('needs_fix')}>
          要修正
        </button>
        <button className="d2d-btn small" onClick={() => void applyStatus('rejected')}>
          棄却
        </button>
      </div>
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'minmax(240px,1fr) minmax(260px,1fr) minmax(300px,1.2fr)',
          minHeight: 0
        }}
      >
        <div style={{ minWidth: 0, padding: 8 }}>
          <b>統合元 extracted_item</b>
          <VirtualDataGrid
            columns={sourceColumns}
            data={sourceItems}
            getRowId={(e) => e.id}
            selectedRowIds={sourceSelectedIds}
            activeRowId={sourceActiveId}
            onRowClick={(e, event) => {
              setSourceSelectedIds(selectRows(sourceItems, e, event, sourceSelectedIds, sourceActiveId))
              setSourceActiveId(e.id)
              setLastSelectedPane('source')
            }}
            onRowKeyDown={(e, event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                setSourceSelectedIds(selectRows(sourceItems, e, event, sourceSelectedIds, sourceActiveId))
                setSourceActiveId(e.id)
                setLastSelectedPane('source')
              }
            }}
            testId="intermediate-source-grid"
          />
        </div>
        <div style={{ minWidth: 0, padding: 8, borderLeft: '1px solid var(--d2d-border)' }}>
          <b>成果物 intermediate_item</b>
          <VirtualDataGrid
            columns={columns}
            data={doc.elements}
            getRowId={(e) => e.id}
            selectedRowIds={selectedIds}
            activeRowId={activeId}
            onRowClick={(e, event) => {
              setSelectedIds(selectRows(doc.elements, e, event, selectedIds, activeId))
              setActiveId(e.id)
              setLastSelectedPane('intermediate')
              setEditText(null)
            }}
            onRowKeyDown={(e, event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                setSelectedIds(selectRows(doc.elements, e, event, selectedIds, activeId))
                setActiveId(e.id)
                setLastSelectedPane('intermediate')
              }
            }}
            testId="intermediate-grid"
          />
        </div>
        <div
          style={{ minWidth: 0, overflow: 'auto', padding: 8, borderLeft: '1px solid var(--d2d-border)' }}
          data-testid="intermediate-markdown"
        >
          <b>中間文書プレビュー</b>
          {doc.elements.map((e) => (
            <article
              key={e.id}
              ref={(node) => {
                if (node) previewRefs.current.set(e.id, node)
                else previewRefs.current.delete(e.id)
              }}
              className={`extraction-preview-item${selectedIds.has(e.id) ? ' selected' : ''}${activeId === e.id ? ' active' : ''}`}
              style={{ marginLeft: (e.level ?? 0) * 14 }}
            >
              <span className="d2d-badge">{e.type}</span>
              {e.type === 'table' ? (
                <table>
                  <tbody>
                    {(e.rows ?? []).map((r, i) => (
                      <tr key={i}>
                        {r.map((c, j) => (
                          <td key={j} style={{ border: '1px solid var(--d2d-border)', padding: 3 }}>
                            {c.text}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : e.type === 'figure' ? (
                <FigureElement element={e} />
              ) : (
                <div>
                  <HighlightTerms text={e.text ?? ''} terms={terms} />
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
      <span data-testid="properties-selection-source" hidden>
        {lastSelectedPane}
      </span>
    </div>
  )
}
