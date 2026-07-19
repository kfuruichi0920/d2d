/**
 * Extraction Review Editor（P5-6、V-02、EXT-020〜024、UI-026、sdd_ui_design §7.1/§8.1）。
 * 形式非依存の抽出要素一覧・複数選択・構造プレビュー・レビュー判断操作を提供する。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { invoke, onBackendEvent } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { useSelectionStore, type ExtractedItemSelection } from '../../stores/selection-store'
import { useResourceNavigationStore } from '../../stores/resource-navigation-store'
import { VirtualDataGrid } from '../common/VirtualDataGrid'
import { StructuredJsonView } from '../common/StructuredJsonView'
import { DocumentPreviewMetaControls, useDocumentPreviewMeta } from '../common/DocumentPreviewMeta'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { ResizablePaneGroup } from '../workbench/ResizablePaneGroup'
import { pushUndo } from '../../services/undo-service'
import { useEscapeToClose } from '../common/useEscapeToClose'

interface TableCell {
  text: string
  colspan?: number
  v_merge?: string
}

interface ReviewElement {
  id: string
  type: string
  text?: string
  caption?: string | null
  level?: number
  section_path?: string
  image?: string
  rows?: TableCell[][]
  row_count?: number
  column_count?: number
  resource_uid?: string
  review?: { status: string; code: string; item_uid: string }
}

interface ExtractedDoc {
  uid: string
  code: string
  title: string | null
  status: string
  metadata: Record<string, unknown>
  structure: unknown
  elements: ReviewElement[]
}

type ReviewStatus = 'draft' | 'approved' | 'review' | 'rejected'

const STATUS_CYCLE: ReviewStatus[] = ['draft', 'approved', 'review', 'rejected']
const TYPE_LABELS: Record<string, string> = {
  heading: '見出し',
  paragraph: '段落',
  list_item: 'リスト',
  table: '表',
  figure: '図',
  caption: 'キャプション',
  shape: '図形',
  group_shape: 'グループ図形',
  connector: 'コネクタ'
}

function FigurePreview({ element }: { element: ReviewElement }): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!element.resource_uid) return
    void invoke<{ dataUrl: string }>('extracted.getFigurePreview', { resourceUid: element.resource_uid }).then(
      (result) => {
        if (result.ok) setDataUrl(result.result.dataUrl)
        else setError(true)
      }
    )
  }, [element.resource_uid])

  if (error) return <div className="d2d-empty">図を読み込めません: {element.image}</div>
  if (!dataUrl) return <div className="d2d-empty">図を読込中…</div>
  return (
    <figure style={{ margin: '8px 0' }}>
      <img
        src={dataUrl}
        alt={element.caption ?? element.image ?? '抽出図'}
        style={{ maxWidth: '100%', maxHeight: 420 }}
      />
      {(element.caption || element.image) && (
        <figcaption style={{ color: 'var(--d2d-fg-muted)', fontSize: 11.5 }}>
          {element.caption ?? element.image}
        </figcaption>
      )}
    </figure>
  )
}

function ElementBody({ element }: { element: ReviewElement }): React.JSX.Element {
  if (element.type === 'figure') return <FigurePreview element={element} />
  if (element.type === 'table') {
    return (
      <table style={{ borderCollapse: 'collapse', marginTop: 6 }}>
        <tbody>
          {(element.rows ?? []).map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  colSpan={cell.colspan}
                  style={{ border: '1px solid var(--d2d-border)', padding: '3px 6px' }}
                >
                  {cell.text}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
  }
  if (element.type === 'heading') {
    const Heading = `h${Math.min(Math.max(element.level ?? 2, 1), 6)}` as keyof React.JSX.IntrinsicElements
    return <Heading style={{ margin: '5px 0' }}>{element.text}</Heading>
  }
  if (element.type === 'list_item') return <li style={{ marginLeft: 20 }}>{element.text}</li>
  return <p style={{ margin: '5px 0', whiteSpace: 'pre-wrap' }}>{element.text ?? element.caption ?? ''}</p>
}

export function ExtractionReviewEditor({ uid }: { uid: string }): React.JSX.Element {
  const [doc, setDoc] = useState<ExtractedDoc | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [anchorId, setAnchorId] = useState<string | null>(null)
  const [previewMode, setPreviewMode] = useState<'visual' | 'structure'>('visual')
  const [previewMeta, setPreviewMeta] = useDocumentPreviewMeta()
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameTitle, setRenameTitle] = useState('')
  const previewRefs = useRef(new Map<string, HTMLElement>())
  const notify = useJobsStore((state) => state.notify)
  // 名称変更モーダルは Escape で閉じる（W10）
  useEscapeToClose(renameOpen, () => setRenameOpen(false))
  const setExtractedItems = useSelectionStore((state) => state.setExtractedItems)
  const clearExtractedItems = useSelectionStore((state) => state.clearExtractedItems)
  const setSelectedItem = useSelectionStore((state) => state.setSelectedItem)
  const clearSelectedItem = useSelectionStore((state) => state.clearSelectedItem)
  const navigationTarget = useResourceNavigationStore((state) => state.target)

  const load = useCallback(async () => {
    const result = await invoke<ExtractedDoc>('extracted.get', { uid })
    if (!result.ok) return
    setDoc(result.result)
    const firstId = result.result.elements[0]?.id ?? null
    setSelectedIds((current) => (current.size > 0 || !firstId ? current : new Set([firstId])))
    setActiveId((current) => current ?? firstId)
    setAnchorId((current) => current ?? firstId)
  }, [uid])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () =>
      onBackendEvent((event, payload) => {
        if (event !== 'extracted.renamed') return
        const renamed = payload as { uid?: string; title?: string }
        if (renamed.uid !== uid || !renamed.title) return
        setDoc((current) => (current ? { ...current, title: renamed.title ?? current.title } : current))
      }),
    [uid]
  )

  useEffect(() => {
    if (!doc || navigationTarget?.uri !== `extracted://${uid}`) return
    const target = doc.elements.find(
      (element) =>
        (navigationTarget.itemUid && element.review?.item_uid === navigationTarget.itemUid) ||
        (navigationTarget.resourceUid && element.resource_uid === navigationTarget.resourceUid)
    )
    if (!target) return
    setSelectedIds(new Set([target.id]))
    setActiveId(target.id)
    setAnchorId(target.id)
  }, [doc, navigationTarget, uid])

  useEffect(() => {
    if (!doc) return
    const selected = doc.elements
      .map((element, index): ExtractedItemSelection | null =>
        selectedIds.has(element.id)
          ? {
              documentUid: uid,
              entityUid: element.review?.item_uid ?? null,
              id: element.id,
              index,
              type: element.type,
              resourceUid: element.resource_uid ?? null,
              text: element.text ?? element.caption ?? null,
              image: element.image ?? null,
              sectionPath: element.section_path ?? null,
              status: element.review?.status ?? 'draft',
              level: element.level ?? null,
              rowCount: element.row_count ?? null,
              columnCount: element.column_count ?? null
            }
          : null
      )
      .filter((item): item is ExtractedItemSelection => item !== null)
    setExtractedItems(selected)
    const active = doc.elements.find((element) => element.id === activeId)
    if (active?.review?.item_uid) {
      setSelectedItem({
        contextUri: `extracted://${uid}`,
        uid: active.review.item_uid,
        displayId: active.review.code,
        entityType: 'extracted_item',
        itemType: active.type,
        status: active.review.status,
        properties: {
          elementId: active.id,
          resourceUid: active.resource_uid,
          type: active.type,
          status: active.review.status,
          sectionPath: active.section_path,
          text: active.text ?? active.caption ?? active.image
        }
      })
    }
  }, [activeId, doc, selectedIds, setExtractedItems, setSelectedItem, uid])

  useEffect(
    () => () => {
      clearExtractedItems()
      clearSelectedItem(`extracted://${uid}`)
    },
    [clearExtractedItems, clearSelectedItem, uid]
  )

  useEffect(() => {
    if (!activeId) return
    previewRefs.current.get(activeId)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeId])

  const selectedElements = useMemo(
    () => doc?.elements.filter((element) => selectedIds.has(element.id)) ?? [],
    [doc, selectedIds]
  )

  const selectRange = (targetId: string, additive: boolean): void => {
    if (!doc) return
    const anchorIndex = Math.max(
      0,
      doc.elements.findIndex((element) => element.id === (anchorId ?? targetId))
    )
    const targetIndex = doc.elements.findIndex((element) => element.id === targetId)
    const [start, end] = anchorIndex <= targetIndex ? [anchorIndex, targetIndex] : [targetIndex, anchorIndex]
    const next = additive ? new Set(selectedIds) : new Set<string>()
    for (let index = start; index <= end; index++) next.add(doc.elements[index]!.id)
    setSelectedIds(next)
  }

  const selectElement = (element: ReviewElement, event: React.MouseEvent<HTMLTableRowElement>): void => {
    if (event.shiftKey) {
      selectRange(element.id, event.ctrlKey || event.metaKey)
    } else if (event.ctrlKey || event.metaKey) {
      const next = new Set(selectedIds)
      if (next.has(element.id)) next.delete(element.id)
      else next.add(element.id)
      setSelectedIds(next)
      setAnchorId(element.id)
    } else {
      setSelectedIds(new Set([element.id]))
      setAnchorId(element.id)
    }
    setActiveId(element.id)
  }

  const onRowKeyDown = (element: ReviewElement, event: React.KeyboardEvent<HTMLTableRowElement>): void => {
    if (!doc) return
    const index = doc.elements.findIndex((item) => item.id === element.id)
    if (event.key === ' ' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault()
      const next = new Set(selectedIds)
      if (next.has(element.id)) next.delete(element.id)
      else next.add(element.id)
      setSelectedIds(next)
      setActiveId(element.id)
      setAnchorId(element.id)
      return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const nextIndex = Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), doc.elements.length - 1)
    const nextElement = doc.elements[nextIndex]!
    if (event.shiftKey) selectRange(nextElement.id, event.ctrlKey || event.metaKey)
    else {
      setSelectedIds(new Set([nextElement.id]))
      setAnchorId(nextElement.id)
    }
    setActiveId(nextElement.id)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-row-id="${CSS.escape(nextElement.id)}"]`)?.focus()
    })
  }

  const onPreviewKeyDown = (element: ReviewElement, event: React.KeyboardEvent<HTMLElement>): void => {
    if (!doc || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return
    event.preventDefault()
    const index = doc.elements.findIndex((item) => item.id === element.id)
    const nextIndex = Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), doc.elements.length - 1)
    const nextElement = doc.elements[nextIndex]
    if (!nextElement) return
    if (event.shiftKey) selectRange(nextElement.id, event.ctrlKey || event.metaKey)
    else {
      setSelectedIds(new Set([nextElement.id]))
      setAnchorId(nextElement.id)
    }
    setActiveId(nextElement.id)
    requestAnimationFrame(() => previewRefs.current.get(nextElement.id)?.focus())
  }

  const applyStatuses = async (groups: { resourceUids: string[]; status: ReviewStatus }[]): Promise<void> => {
    for (const group of groups) {
      if (group.resourceUids.length === 0) continue
      const result = await invoke<{ updatedCount: number }>('extracted.updateItemStatuses', {
        extractedDocumentUid: uid,
        resourceUids: group.resourceUids,
        status: group.status
      })
      if (!result.ok) throw new Error(result.error.message)
    }
    await load()
  }

  const updateStatus = async (elements: ReviewElement[], status: ReviewStatus): Promise<void> => {
    const targets = elements.filter((element) => element.resource_uid)
    const resourceUids = targets.map((element) => element.resource_uid!)
    if (resourceUids.length === 0) return
    // Undo 用に変更前状態をグループ化して控える（W4、NFR-012）。
    const previousGroups = new Map<ReviewStatus, string[]>()
    for (const element of targets) {
      const previous = (element.review?.status ?? 'draft') as ReviewStatus
      previousGroups.set(previous, [...(previousGroups.get(previous) ?? []), element.resource_uid!])
    }
    const result = await invoke<{ updatedCount: number }>('extracted.updateItemStatuses', {
      extractedDocumentUid: uid,
      resourceUids,
      status
    })
    if (result.ok) {
      await load()
      pushUndo({
        label: `②レビュー状態の変更（${resourceUids.length}件 → ${status}）`,
        undo: () =>
          applyStatuses([...previousGroups.entries()].map(([prev, uids]) => ({ resourceUids: uids, status: prev }))),
        redo: () => applyStatuses([{ resourceUids, status }])
      })
    } else notify('error', 'レビュー状態を更新できませんでした', result.error.message)
  }

  const cycleStatus = (element: ReviewElement): void => {
    const current = (element.review?.status ?? 'draft') as ReviewStatus
    const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length] ?? 'draft'
    void updateStatus([element], next)
  }

  const approveAll = async (): Promise<void> => {
    const result = await invoke<{ approvedCount: number }>('extracted.approve', { uid })
    if (result.ok) {
      notify('info', `②抽出データを正本確定しました（${result.result.approvedCount} 要素）`)
      await load()
      void useProjectStore.getState().refreshStats()
    } else notify('error', '確定できませんでした', result.error.message)
  }

  const renameDocument = async (): Promise<void> => {
    const title = renameTitle.trim()
    if (!title) return
    const previousTitle = doc?.title ?? null
    const result = await invoke<{ title: string }>('extracted.rename', { uid, title })
    if (!result.ok) {
      notify('error', '抽出データの名称を変更できませんでした', result.error.message)
      return
    }
    setDoc((current) => (current ? { ...current, title } : current))
    setRenameOpen(false)
    notify('info', '抽出データの名称を変更しました')
    if (previousTitle && previousTitle !== title) {
      pushUndo({
        label: `②名称変更: ${previousTitle} → ${title}`,
        undo: async () => {
          const undone = await invoke('extracted.rename', { uid, title: previousTitle })
          if (!undone.ok) throw new Error(undone.error.message)
          setDoc((current) => (current ? { ...current, title: previousTitle } : current))
        },
        redo: async () => {
          const redone = await invoke('extracted.rename', { uid, title })
          if (!redone.ok) throw new Error(redone.error.message)
          setDoc((current) => (current ? { ...current, title } : current))
        }
      })
    }
  }
  const columns: ColumnDef<ReviewElement, unknown>[] = [
    {
      header: '状態',
      accessorKey: 'review',
      size: 86,
      cell: ({ row }) => (
        <button
          type="button"
          className="d2d-btn small"
          title="クリックで状態を切替"
          data-testid={`cycle-status-${row.original.id}`}
          onClick={(event) => {
            event.stopPropagation()
            cycleStatus(row.original)
          }}
        >
          <ReviewStatusBadge status={reviewStateFromEntityStatus(row.original.review?.status ?? 'draft')} />
        </button>
      )
    },
    {
      header: '種別',
      accessorKey: 'type',
      size: 90,
      cell: ({ row }) => <span className="d2d-badge">{TYPE_LABELS[row.original.type] ?? row.original.type}</span>
    },
    {
      header: '内容',
      accessorFn: (element) => element.text ?? element.caption ?? element.image ?? '',
      cell: ({ getValue }) => <span>{String(getValue())}</span>
    },
    { header: '章節', accessorKey: 'section_path', size: 140 }
  ]

  if (!doc) return <div className="d2d-empty">読込中…</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="extraction-review-editor">
      <div className="extraction-review-toolbar">
        <h1 style={{ fontSize: 14, margin: 0 }}>{doc.title ?? doc.code}</h1>
        <ReviewStatusBadge status={reviewStateFromEntityStatus(doc.status)} />
        <span style={{ color: 'var(--d2d-fg-muted)' }}>
          {doc.elements.length} 要素 / {selectedElements.length} 選択
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="d2d-btn small dense-editor-action"
          data-editor-icon="✎"
          data-testid="rename-extracted"
          onClick={() => {
            setRenameTitle(doc.title ?? doc.code)
            setRenameOpen(true)
          }}
        >
          名称変更
        </button>
        <button
          type="button"
          className="d2d-btn small dense-editor-action"
          data-editor-icon="✓"
          disabled={selectedElements.length === 0}
          onClick={() => void updateStatus(selectedElements, 'approved')}
          data-testid="selected-confirm"
        >
          確認済みにする
        </button>
        <button
          type="button"
          className="d2d-btn small dense-editor-action"
          data-editor-icon="!"
          disabled={selectedElements.length === 0}
          onClick={() => void updateStatus(selectedElements, 'review')}
          data-testid="selected-needsfix"
        >
          要修正
        </button>
        <button
          type="button"
          className="d2d-btn small dense-editor-action"
          data-editor-icon="×"
          disabled={selectedElements.length === 0}
          onClick={() => void updateStatus(selectedElements, 'rejected')}
          data-testid="selected-reject"
        >
          棄却
        </button>
        <button
          type="button"
          className="d2d-btn primary dense-editor-action"
          data-editor-icon="★"
          onClick={() => void approveAll()}
          disabled={doc.status === 'approved'}
          data-testid="approve-all-button"
        >
          {doc.status === 'approved' ? '正本確定済み' : '採用確定（②正本へ反映）'}
        </button>
      </div>
      <ResizablePaneGroup initialSizes={[1, 1]} testId="extraction-review-layout">
        <div style={{ flex: 1, minWidth: 0, padding: 8 }}>
          <VirtualDataGrid<ReviewElement>
            columns={columns}
            data={doc.elements}
            getRowId={(element) => element.id}
            onRowClick={selectElement}
            onRowKeyDown={onRowKeyDown}
            selectedRowIds={selectedIds}
            activeRowId={activeId}
            testId="element-grid"
          />
        </div>
        <div className="extraction-structure-preview" data-testid="review-markdown">
          <div className="document-preview-switch" aria-label="抽出データのプレビュー表示">
            <button
              type="button"
              className={`d2d-btn small dense-editor-action${previewMode === 'visual' ? ' active' : ''}`}
              data-editor-icon="▤"
              onClick={() => setPreviewMode('visual')}
              data-testid="extraction-preview-visual"
            >
              文書プレビュー
            </button>
            <button
              type="button"
              className={`d2d-btn small dense-editor-action${previewMode === 'structure' ? ' active' : ''}`}
              data-editor-icon="{}"
              onClick={() => setPreviewMode('structure')}
              data-testid="extraction-preview-structure"
            >
              structure_json
            </button>
          </div>
          {previewMode === 'visual' && <DocumentPreviewMetaControls options={previewMeta} onChange={setPreviewMeta} />}
          {previewMode === 'structure' ? (
            <StructuredJsonView value={doc.structure} testId="extraction-structure-json" />
          ) : (
            doc.elements.map((element) => {
              const selected = selectedIds.has(element.id)
              return (
                <article
                  key={element.id}
                  ref={(node) => {
                    if (node) previewRefs.current.set(element.id, node)
                    else previewRefs.current.delete(element.id)
                  }}
                  data-testid={`preview-item-${element.id}`}
                  className={`extraction-preview-item${selected ? ' selected' : ''}${activeId === element.id ? ' active' : ''}`}
                  tabIndex={0}
                  onKeyDown={(event) => onPreviewKeyDown(element, event)}
                  onClick={() => {
                    setSelectedIds(new Set([element.id]))
                    setActiveId(element.id)
                    setAnchorId(element.id)
                  }}
                >
                  <header>
                    {previewMeta.parts && (
                      <span className="d2d-badge">{TYPE_LABELS[element.type] ?? element.type}</span>
                    )}
                    {previewMeta.elementIds && <code>{element.id}</code>}
                    {previewMeta.sections && element.section_path && <span>{element.section_path}</span>}
                  </header>
                  <ElementBody element={element} />
                </article>
              )
            })
          )}
        </div>
      </ResizablePaneGroup>
      {renameOpen && (
        <div className="extraction-rename-dialog" role="dialog" aria-modal="true" data-testid="rename-extracted-dialog">
          <h2>抽出データの名称変更</h2>
          <label htmlFor="rename-extracted-input">名称</label>
          <input
            id="rename-extracted-input"
            data-testid="rename-extracted-input"
            value={renameTitle}
            autoFocus
            onChange={(event) => setRenameTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setRenameOpen(false)
              if (event.key === 'Enter') void renameDocument()
            }}
          />
          <div className="stage-import-dialog-actions">
            <button type="button" className="d2d-btn" onClick={() => setRenameOpen(false)}>
              キャンセル
            </button>
            <button
              type="button"
              className="d2d-btn primary"
              data-testid="rename-extracted-save"
              disabled={!renameTitle.trim()}
              onClick={() => void renameDocument()}
            >
              保存
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
