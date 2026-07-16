/**
 * Intermediate Document Editor（P7-7、V-03、UI-012、EDIT-002〜008）。
 * ③中間データの文書風表示 + 要素編集（編集/マージ/分割/LLM候補）+ 正本確定。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { invoke, onBackendEvent } from '../../services/backend'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { useSelectionStore } from '../../stores/selection-store'
import { VirtualDataGrid } from '../common/VirtualDataGrid'
import { StructuredJsonView } from '../common/StructuredJsonView'
import { DocumentPreviewMetaControls, useDocumentPreviewMeta } from '../common/DocumentPreviewMeta'
import { ResourceEditor } from './ResourceEditor'
import { resourceTypeLabel } from '../../types/resource'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { ResizablePaneGroup } from '../workbench/ResizablePaneGroup'
import { ChunkEditor } from './ChunkEditor'

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
  source_resource_uids?: string[]
  source_extracted_item_uids?: string[]
  extracted_item_uid?: string
  item_type?: string
  intermediate_item_uid?: string
}

interface IntermediateDoc {
  uid: string
  code: string
  title: string | null
  artifact_name?: string | null
  status: string
  artifact_type_id: string
  dev_phase_id: string
  intermediate_status: string
  sources: { extracted_document_uid: string; order: number }[]
  structure: unknown
  elements: IntermediateElement[]
}

type IntermediateEditorMode = 'import' | 'standalone' | 'chunk'
type ElementEditorAction = 'add' | 'edit'

interface ElementEditorState {
  action: ElementEditorAction
  elementId?: string
  position?: 'above' | 'below'
  type: string
  text: string
}

const BASIC_EDITABLE_TYPES = new Set(['paragraph', 'heading', 'list_item', 'caption'])
const ELEMENT_TYPE_OPTIONS = ['paragraph', 'heading', 'list_item', 'caption', 'table', 'figure']
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

export function IntermediateDocumentEditor({
  uid,
  initialMode = 'import'
}: {
  uid: string
  initialMode?: IntermediateEditorMode
}): React.JSX.Element {
  const [doc, setDoc] = useState<IntermediateDoc | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [activeId, setActiveId] = useState<string | null>(null)
  const [sourceItems, setSourceItems] = useState<(IntermediateElement & { source_title?: string })[]>([])
  const [sourceSelectedIds, setSourceSelectedIds] = useState<Set<string>>(new Set())
  const [sourceActiveId, setSourceActiveId] = useState<string | null>(null)
  const [sourceAnchorId, setSourceAnchorId] = useState<string | null>(null)
  const [lastSelectedPane, setLastSelectedPane] = useState<'source' | 'intermediate'>('intermediate')
  const [editorMode, setEditorMode] = useState<IntermediateEditorMode>(initialMode)
  const [previewMode, setPreviewMode] = useState<'visual' | 'structure'>('visual')
  const [previewMeta, setPreviewMeta] = useDocumentPreviewMeta()
  const previewRefs = useRef(new Map<string, HTMLElement>())
  const [elementEditor, setElementEditor] = useState<ElementEditorState | null>(null)
  const [resourceEditing, setResourceEditing] = useState<IntermediateElement | null>(null)
  const [terms, setTerms] = useState<string[]>([])
  const notify = useJobsStore((s) => s.notify)
  const setWorkbenchItems = useSelectionStore((s) => s.setWorkbenchItems)
  const setSelectedItem = useSelectionStore((s) => s.setSelectedItem)
  const clearSelectedItem = useSelectionStore((s) => s.clearSelectedItem)

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
              contextUri: `intermediate://${uid}`,
              pane: 'extracted' as const,
              entityUid: e.extracted_item_uid ?? null,
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
              contextUri: `intermediate://${uid}`,
              pane: 'intermediate' as const,
              entityUid: e.intermediate_item_uid ?? null,
              id: e.id,
              type: e.type,
              resourceUid: e.resource_uid ?? null,
              text: e.text ?? e.image ?? null,
              status: e.review?.status ?? 'draft'
            }))
    setWorkbenchItems(items)
    const active =
      lastSelectedPane === 'source'
        ? sourceItems.find((element) => element.id === sourceActiveId)
        : doc?.elements.find((element) => element.id === activeId)
    const entityUid = lastSelectedPane === 'source' ? active?.extracted_item_uid : active?.intermediate_item_uid
    if (active && entityUid) {
      setSelectedItem({
        contextUri: `intermediate://${uid}`,
        uid: entityUid,
        displayId: entityUid,
        entityType: lastSelectedPane === 'source' ? 'extracted_item' : 'intermediate_item',
        itemType: active.type,
        status: active.review?.status,
        properties: {
          pane: lastSelectedPane === 'source' ? '統合元' : '成果物',
          elementId: active.id,
          resourceUid: active.resource_uid,
          type: active.type,
          status: active.review?.status,
          sectionPath: active.section_path,
          text: active.text ?? active.image,
          sourceTitle:
            'source_title' in active && typeof active.source_title === 'string' ? active.source_title : undefined
        }
      })
    }
  }, [
    activeId,
    doc,
    lastSelectedPane,
    selectedIds,
    setSelectedItem,
    setWorkbenchItems,
    sourceActiveId,
    sourceItems,
    sourceSelectedIds,
    uid
  ])

  useEffect(() => () => clearSelectedItem(`intermediate://${uid}`), [clearSelectedItem, uid])

  const selected = doc?.elements.find((e) => e.id === activeId) ?? null

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
    const extractedItemUids = sourceItems
      .filter((item) => sourceSelectedIds.has(item.id))
      .map((item) => item.extracted_item_uid)
      .filter((itemUid): itemUid is string => Boolean(itemUid))
    await call(
      'intermediate.insertExtractedItems',
      { extractedItemUids, targetElementId: selectedIds.size === 1 ? activeId : undefined, position },
      `${extractedItemUids.length}要素を成果物へ追加しました`
    )
  }
  const deleteSourceLinks = async (): Promise<void> => {
    const extractedItemUids = sourceItems
      .filter((item) => sourceSelectedIds.has(item.id))
      .map((item) => item.extracted_item_uid)
      .filter((itemUid): itemUid is string => Boolean(itemUid))
    await call(
      'intermediate.unlinkExtractedItems',
      { extractedItemUids },
      `${extractedItemUids.length}統合元の成果物対応を削除しました`
    )
    setSourceSelectedIds(new Set())
    setSourceActiveId(null)
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

  const openElementEditor = (element: IntermediateElement): void => {
    if (!element.resource_uid || !element.intermediate_item_uid || !element.item_type) {
      notify('error', 'Resource編集を開けません', '中間要素のResource情報がありません。再読込してください。')
      return
    }
    setResourceEditing(element)
  }

  const openAddEditor = (position: 'above' | 'below'): void => {
    setElementEditor({
      action: 'add',
      elementId: activeId ?? undefined,
      position,
      type: 'paragraph',
      text: ''
    })
  }

  const saveElementEditor = async (): Promise<void> => {
    if (!elementEditor || !BASIC_EDITABLE_TYPES.has(elementEditor.type) || !elementEditor.text.trim()) return
    const method = elementEditor.action === 'add' ? 'intermediate.addElement' : 'intermediate.editElement'
    const params =
      elementEditor.action === 'add'
        ? {
            targetElementId: elementEditor.elementId,
            position: elementEditor.position,
            type: elementEditor.type,
            text: elementEditor.text
          }
        : { elementId: elementEditor.elementId, type: elementEditor.type, text: elementEditor.text }
    const result = await invoke<{ elementId?: string }>(method, { uid, ...params })
    if (!result.ok) {
      notify('error', '要素を保存できませんでした', result.error.message)
      return
    }
    const nextId = result.result.elementId ?? elementEditor.elementId ?? null
    setElementEditor(null)
    await load()
    if (nextId) {
      setSelectedIds(new Set([nextId]))
      setActiveId(nextId)
      setLastSelectedPane('intermediate')
    }
    notify('info', elementEditor.action === 'add' ? '中間要素を追加しました' : '中間要素を編集しました')
  }

  const duplicateSelected = async (): Promise<void> => {
    if (!selected || selectedIds.size !== 1) return
    const result = await invoke<{ elementId: string }>('intermediate.duplicateElement', {
      uid,
      elementId: selected.id
    })
    if (!result.ok) {
      notify('error', '要素を複製できませんでした', result.error.message)
      return
    }
    await load()
    setSelectedIds(new Set([result.result.elementId]))
    setActiveId(result.result.elementId)
    setLastSelectedPane('intermediate')
    notify('info', '中間要素を複製しました')
  }

  const mergeAdjacent = async (direction: 'up' | 'down'): Promise<void> => {
    if (!doc || !activeId || selectedIds.size !== 1) return
    const index = doc.elements.findIndex((element) => element.id === activeId)
    const adjacent = doc.elements[index + (direction === 'up' ? -1 : 1)]
    if (!adjacent) return
    const result = await invoke<{ newElementId: string; warnings: string[] }>('intermediate.mergeElements', {
      uid,
      elementIds: direction === 'up' ? [adjacent.id, activeId] : [activeId, adjacent.id]
    })
    if (!result.ok) {
      notify('error', '要素を統合できませんでした', result.error.message)
      return
    }
    await load()
    setSelectedIds(new Set([result.result.newElementId]))
    setActiveId(result.result.newElementId)
    setLastSelectedPane('intermediate')
    notify('info', direction === 'up' ? '上の成果物要素へ統合しました' : '下の成果物要素と統合しました')
  }
  const approve = async (): Promise<void> => {
    if (await call('intermediate.approve', {}, '③中間データを正本確定しました')) {
      void useProjectStore.getState().refreshStats()
    }
  }

  const integratedSourceItemIds = new Set(
    doc?.elements.flatMap((element) => element.source_extracted_item_uids ?? []) ?? []
  )
  const selectedSourceItemUids = new Set(
    sourceItems
      .filter((item) => sourceSelectedIds.has(item.id) && item.extracted_item_uid)
      .map((item) => item.extracted_item_uid!)
  )
  const relatedCenterIds = new Set(
    doc?.elements
      .filter((element) => element.source_extracted_item_uids?.some((itemUid) => selectedSourceItemUids.has(itemUid)))
      .map((element) => element.id) ?? []
  )
  const selectedCenterSourceUids = new Set(
    doc?.elements
      .filter((element) => selectedIds.has(element.id))
      .flatMap((element) => element.source_extracted_item_uids ?? []) ?? []
  )
  const relatedSourceIds = new Set(
    sourceItems
      .filter((item) => item.extracted_item_uid && selectedCenterSourceUids.has(item.extracted_item_uid))
      .map((item) => item.id)
  )
  const linkedSourceItemCount = sourceItems.filter(
    (item) => item.extracted_item_uid && integratedSourceItemIds.has(item.extracted_item_uid)
  ).length
  const integratedSourceRowIds = new Set(
    sourceItems
      .filter((item) => item.extracted_item_uid && integratedSourceItemIds.has(item.extracted_item_uid))
      .map((item) => item.id)
  )

  useEffect(() => {
    if (lastSelectedPane !== 'source') return
    const selectedItemUids = new Set(
      sourceItems
        .filter((item) => sourceSelectedIds.has(item.id) && item.extracted_item_uid)
        .map((item) => item.extracted_item_uid!)
    )
    const related = doc?.elements.find((element) =>
      element.source_extracted_item_uids?.some((itemUid) => selectedItemUids.has(itemUid))
    )
    if (related) previewRefs.current.get(related.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [lastSelectedPane, sourceActiveId, sourceSelectedIds, sourceItems, doc])
  const cycleStatus = async (element: IntermediateElement): Promise<void> => {
    const statuses = ['draft', 'approved', 'review', 'rejected']
    const current = element.review?.status ?? 'draft'
    const next = statuses[(statuses.indexOf(current) + 1) % statuses.length]!
    await call(
      'intermediate.updateItemStatuses',
      { elementIds: [element.id], status: next === 'review' ? 'needs_fix' : next },
      'レビュー状態を更新しました'
    )
  }
  const removeSelected = async (): Promise<void> => {
    if (selectedIds.size === 0) return
    await call('intermediate.deleteItems', { elementIds: [...selectedIds] }, '成果物から要素を削除しました')
    setSelectedIds(new Set())
    setActiveId(null)
  }

  const typeColors: Record<string, string> = {
    heading: '#7c3aed',
    paragraph: '#2563eb',
    list_item: '#0891b2',
    table: '#d97706',
    figure: '#db2777',
    caption: '#65a30d'
  }
  const columns: ColumnDef<IntermediateElement, unknown>[] = [
    {
      header: '状態',
      accessorKey: 'review',
      cell: ({ row }) => (
        <button
          type="button"
          className="d2d-btn small"
          onClick={(event) => {
            event.stopPropagation()
            void cycleStatus(row.original)
          }}
          title="クリックで状態を切替"
        >
          <ReviewStatusBadge status={reviewStateFromEntityStatus(row.original.review?.status ?? 'draft')} />
        </button>
      )
    },
    { header: 'ID', accessorKey: 'id', size: 50 },
    {
      header: 'Resource種別',
      accessorKey: 'item_type',
      size: 132,
      cell: ({ row }) => (
        <button
          type="button"
          className="resource-type-button"
          title="クリックしてResource種別・固有情報を編集"
          data-testid={`resource-type-${row.original.id}`}
          onClick={(event) => {
            event.stopPropagation()
            openElementEditor(row.original)
          }}
        >
          {resourceTypeLabel(row.original.item_type)}
        </button>
      )
    },
    {
      header: '内容',
      cell: ({ row }) => (
        <span
          style={{
            borderLeft: `${Math.max(1, row.original.level ?? 0)}px solid ${typeColors[row.original.type] ?? 'var(--d2d-border)'}`,
            paddingLeft: 6,
            background: `color-mix(in srgb, ${typeColors[row.original.type] ?? 'var(--d2d-border)'} ${Math.min(22, 6 + (row.original.level ?? 0) * 4)}%, transparent)`
          }}
        >
          {'┆ '.repeat(row.original.level ?? 0)}
          {row.original.text ?? row.original.image ?? ''}
        </span>
      )
    },
    { header: '章節', accessorKey: 'section_path', size: 130 }
  ]

  const sourceColumns: ColumnDef<IntermediateElement & { source_title?: string }, unknown>[] = [
    {
      header: '状態',
      accessorKey: 'review',
      cell: ({ row }) => (
        <ReviewStatusBadge status={reviewStateFromEntityStatus(row.original.review?.status ?? 'draft')} />
      )
    },
    { header: '統合元', accessorKey: 'source_title' },
    { header: '種別', accessorKey: 'type' },
    { header: '内容', accessorFn: (e) => e.text ?? e.image ?? '' }
  ]

  if (!doc) return <div className="d2d-empty">読込中…</div>

  const modeButtons = (
    <div style={{ display: 'flex', gap: 4 }} aria-label="中間データ編集画面切替">
      <button
        type="button"
        className={`d2d-btn small${editorMode === 'import' ? ' primary' : ''}`}
        data-testid="intermediate-mode-import"
        onClick={() => setEditorMode('import')}
      >
        中間データ取込編集
      </button>
      <button
        type="button"
        className={`d2d-btn small${editorMode === 'standalone' ? ' primary' : ''}`}
        data-testid="intermediate-mode-standalone"
        onClick={() => {
          setEditorMode('standalone')
          setLastSelectedPane('intermediate')
        }}
      >
        中間データ単独編集
      </button>
      <button
        type="button"
        className={`d2d-btn small${editorMode === 'chunk' ? ' primary' : ''}`}
        data-testid="intermediate-mode-chunk"
        onClick={() => setEditorMode('chunk')}
      >
        チャンク編集
      </button>
    </div>
  )

  if (editorMode === 'chunk') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }} data-testid="intermediate-editor">
        <div className="intermediate-editor-header">
          <h1 style={{ fontSize: 14, margin: 0 }}>{doc.artifact_name ?? doc.title ?? doc.code}</h1>
          <ReviewStatusBadge status={reviewStateFromEntityStatus(doc.status)} />
          {modeButtons}
        </div>
        <ChunkEditor uid={uid} />
      </div>
    )
  }
  const selectedIndex = activeId ? doc.elements.findIndex((element) => element.id === activeId) : -1
  const allItemsApproved =
    doc.status === 'approved' && doc.elements.every((element) => element.review?.status === 'approved')

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
        <h1 style={{ fontSize: 14, margin: 0 }}>{doc.artifact_name ?? doc.title ?? doc.code}</h1>
        <ReviewStatusBadge status={reviewStateFromEntityStatus(doc.status)} />
        <span style={{ color: 'var(--d2d-fg-muted)' }}>
          {doc.artifact_type_id} / {doc.dev_phase_id} / {doc.elements.length} 要素 / 統合元 {doc.sources.length} 文書
        </span>
        {modeButtons}
        <span style={{ flex: 1 }} />

        <button
          type="button"
          className="d2d-btn primary"
          onClick={() => void approve()}
          disabled={allItemsApproved}
          data-testid="intermediate-approve"
        >
          {allItemsApproved ? '正本確定済み' : '③正本として確定'}
        </button>
      </div>

      {resourceEditing?.resource_uid && resourceEditing.intermediate_item_uid && (
        <div role="dialog" aria-modal="true" className="resource-editor-dialog" data-testid="resource-edit-dialog">
          <div className="resource-editor-dialog-title">
            <b>Resource編集: {resourceEditing.id}</b>
            <button type="button" className="d2d-btn small" onClick={() => setResourceEditing(null)}>
              閉じる
            </button>
          </div>
          <ResourceEditor
            embedded
            resourceUid={resourceEditing.resource_uid}
            context={{
              intermediateDocumentUid: uid,
              intermediateItemUid: resourceEditing.intermediate_item_uid,
              elementId: resourceEditing.id
            }}
            onSaved={async () => {
              setResourceEditing(null)
              await load()
            }}
          />
        </div>
      )}

      {elementEditor?.action === 'add' && (
        <div
          role="dialog"
          data-testid="element-edit-dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: '22% 28%',
            zIndex: 30,
            padding: 16,
            overflow: 'auto',
            background: 'var(--d2d-surface-raised)',
            color: 'var(--d2d-fg)',
            border: '1px solid var(--d2d-border)',
            borderRadius: 'var(--d2d-radius)',
            boxShadow: '0 8px 30px #0008'
          }}
        >
          <h3 style={{ marginTop: 0 }}>
            {elementEditor.action === 'add' ? '中間要素を追加' : `中間要素を編集: ${elementEditor.elementId}`}
          </h3>
          <label style={{ display: 'grid', gap: 4, marginBottom: 10 }}>
            種別
            <select
              value={elementEditor.type}
              data-testid="element-edit-type"
              onChange={(event) => setElementEditor((current) => current && { ...current, type: event.target.value })}
            >
              {ELEMENT_TYPE_OPTIONS.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 4 }}>
            テキスト
            <textarea
              style={{ width: '100%', minHeight: 90 }}
              value={elementEditor.text}
              onChange={(event) => setElementEditor((current) => current && { ...current, text: event.target.value })}
              data-testid="edit-textarea"
            />
          </label>
          {!BASIC_EDITABLE_TYPES.has(elementEditor.type) && (
            <p style={{ color: 'var(--d2d-warning)', fontSize: 11 }}>
              {elementEditor.type}{' '}
              の種別固有編集項目は次段階で追加します。現在は基本4種への変更、または既存の表編集を利用してください。
            </p>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
            <button type="button" className="d2d-btn small" onClick={() => setElementEditor(null)}>
              キャンセル
            </button>
            <button
              type="button"
              className="d2d-btn primary small"
              onClick={() => void saveElementEditor()}
              disabled={!BASIC_EDITABLE_TYPES.has(elementEditor.type) || !elementEditor.text.trim()}
              data-testid="edit-save"
            >
              保存（新Resourceで反映）
            </button>
          </div>
        </div>
      )}

      <div className="intermediate-operation-toolbar" data-testid="intermediate-operation-toolbar">
        <div className="intermediate-operation-group" data-testid="source-link-actions">
          <b>①統合元→成果物 操作</b>
          {editorMode === 'import' ? (
            <>
              <button
                type="button"
                className="d2d-btn small"
                data-testid="source-add-above"
                disabled={sourceSelectedIds.size === 0 || (doc.elements.length > 0 && selectedIds.size !== 1)}
                onClick={() => void integrate('above')}
                title="選択中の統合元要素を、選択中の成果物要素の上に追加し、based_onで関連付けます"
              >
                上に追加
              </button>
              <button
                type="button"
                className="d2d-btn small"
                data-testid="source-add-below"
                disabled={sourceSelectedIds.size === 0 || (doc.elements.length > 0 && selectedIds.size !== 1)}
                onClick={() => void integrate('below')}
                title="選択中の統合元要素を、選択中の成果物要素の下に追加し、based_onで関連付けます"
              >
                下に追加
              </button>
              <button
                type="button"
                className="d2d-btn small"
                data-testid="source-delete"
                disabled={sourceSelectedIds.size === 0}
                onClick={() => void deleteSourceLinks()}
                title="選択中の統合元要素と成果物要素のbased_on対応を削除します。抽出データ自体は削除しません"
              >
                削除
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="d2d-btn small"
                data-testid="element-add-above"
                disabled={doc.elements.length > 0 && selectedIds.size !== 1}
                onClick={() => openAddEditor('above')}
              >
                上に追加
              </button>
              <button
                type="button"
                className="d2d-btn small"
                data-testid="element-add-below"
                disabled={doc.elements.length > 0 && selectedIds.size !== 1}
                onClick={() => openAddEditor('below')}
              >
                下に追加
              </button>
            </>
          )}
        </div>
        <div className="intermediate-operation-group" data-testid="artifact-compose-actions">
          <b>②成果物 操作</b>
          <button
            type="button"
            className="d2d-btn small"
            data-testid="merge-up"
            disabled={selectedIds.size !== 1 || selectedIndex <= 0}
            onClick={() => void mergeAdjacent('up')}
          >
            ↑統合
          </button>
          <button
            type="button"
            className="d2d-btn small"
            data-testid="merge-down"
            disabled={selectedIds.size !== 1 || selectedIndex < 0 || selectedIndex >= doc.elements.length - 1}
            onClick={() => void mergeAdjacent('down')}
          >
            ↓統合
          </button>
          <button
            type="button"
            className="d2d-btn small"
            data-testid="element-duplicate"
            disabled={selectedIds.size !== 1}
            onClick={() => void duplicateSelected()}
          >
            複製
          </button>
          <button
            type="button"
            className="d2d-btn small danger"
            data-testid="element-delete"
            disabled={selectedIds.size === 0}
            onClick={() => void removeSelected()}
          >
            削除
          </button>
        </div>
        <div className="intermediate-operation-group" data-testid="artifact-layout-actions">
          <b>③成果物 操作</b>
          <button
            type="button"
            className="d2d-btn small"
            disabled={selectedIds.size === 0}
            onClick={() => void move('up')}
          >
            ↑移動
          </button>
          <button
            type="button"
            className="d2d-btn small"
            disabled={selectedIds.size === 0}
            onClick={() => void move('down')}
          >
            ↓移動
          </button>
          <button
            type="button"
            className="d2d-btn small"
            disabled={selectedIds.size === 0}
            onClick={() => void hierarchy(-1)}
          >
            階層を上げる
          </button>
          <button
            type="button"
            className="d2d-btn small"
            disabled={selectedIds.size === 0}
            onClick={() => void hierarchy(1)}
          >
            階層を下げる
          </button>
        </div>
        <span className="intermediate-edit-hint">Resource種別ラベル / ダブルクリック / Space / Enter で編集</span>
      </div>
      <ResizablePaneGroup
        key={editorMode}
        initialSizes={editorMode === 'import' ? [1, 1, 1.2] : [1, 1.25]}
        testId={editorMode === 'import' ? 'intermediate-import-layout' : 'intermediate-standalone-layout'}
      >
        {editorMode === 'import' && (
          <div style={{ minWidth: 0, minHeight: 0, overflow: 'hidden', padding: 8 }}>
            <div className="intermediate-source-heading">
              <b>統合元 extracted_item</b>
              <span className="intermediate-source-linked-legend">青字: 取込済み（成果物とbased_onで紐付済み）</span>
              <span data-testid="source-link-summary">
                紐付済 {linkedSourceItemCount} / 全 {sourceItems.length}
              </span>
            </div>
            <VirtualDataGrid
              columns={sourceColumns}
              data={sourceItems}
              getRowId={(e) => e.id}
              selectedRowIds={sourceSelectedIds}
              activeRowId={sourceActiveId}
              relatedRowIds={relatedSourceIds}
              accentRowIds={integratedSourceRowIds}
              height="calc(100% - 44px)"
              onRowClick={(e, event) => {
                setSourceSelectedIds(selectRows(sourceItems, e, event, sourceSelectedIds, sourceAnchorId))
                setSourceActiveId(e.id)
                if (!event.shiftKey) setSourceAnchorId(e.id)
                setLastSelectedPane('source')
              }}
              onRowKeyDown={(e, event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  const currentIndex = sourceItems.findIndex((item) => item.id === (sourceActiveId ?? e.id))
                  const nextIndex = Math.max(
                    0,
                    Math.min(sourceItems.length - 1, currentIndex + (event.key === 'ArrowUp' ? -1 : 1))
                  )
                  const next = sourceItems[nextIndex]
                  if (!next) return
                  if (event.shiftKey) {
                    const anchor = sourceAnchorId ?? e.id
                    setSourceSelectedIds(
                      selectRows(
                        sourceItems,
                        next,
                        { ctrlKey: false, metaKey: false, shiftKey: true },
                        sourceSelectedIds,
                        anchor
                      )
                    )
                  } else {
                    setSourceSelectedIds(new Set([next.id]))
                    setSourceAnchorId(next.id)
                  }
                  setSourceActiveId(next.id)
                  setLastSelectedPane('source')
                  requestAnimationFrame(() => {
                    const row = document.querySelector<HTMLTableRowElement>(
                      `[data-testid="intermediate-source-grid"] tr[data-row-id="${next.id}"]`
                    )
                    row?.focus()
                    row?.scrollIntoView({ block: 'nearest' })
                  })
                } else if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault()
                  setSourceSelectedIds(selectRows(sourceItems, e, event, sourceSelectedIds, sourceAnchorId))
                  setSourceActiveId(e.id)
                  if (!event.shiftKey) setSourceAnchorId(e.id)
                  setLastSelectedPane('source')
                }
              }}
              testId="intermediate-source-grid"
            />
          </div>
        )}
        <div
          style={{
            minWidth: 0,
            minHeight: 0,
            overflow: 'hidden',
            padding: 8,
            borderLeft: editorMode === 'import' ? '1px solid var(--d2d-border)' : undefined
          }}
        >
          <b>成果物 intermediate_item</b>
          <VirtualDataGrid
            columns={columns}
            data={doc.elements}
            getRowId={(e) => e.id}
            selectedRowIds={selectedIds}
            activeRowId={activeId}
            relatedRowIds={relatedCenterIds}
            height="calc(100% - 22px)"
            onRowClick={(e, event) => {
              setSelectedIds(selectRows(doc.elements, e, event, selectedIds, activeId))
              setActiveId(e.id)
              setLastSelectedPane('intermediate')
              if (event.detail >= 2) openElementEditor(e)
            }}
            onRowKeyDown={(e, event) => {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault()
                const currentIndex = doc.elements.findIndex((item) => item.id === (activeId ?? e.id))
                const nextIndex = Math.max(
                  0,
                  Math.min(doc.elements.length - 1, currentIndex + (event.key === 'ArrowUp' ? -1 : 1))
                )
                const next = doc.elements[nextIndex]
                if (next) {
                  setSelectedIds(new Set([next.id]))
                  setActiveId(next.id)
                  setLastSelectedPane('intermediate')
                  requestAnimationFrame(() => {
                    const row = document.querySelector<HTMLTableRowElement>(
                      `[data-testid="intermediate-grid"] tr[data-row-id="${next.id}"]`
                    )
                    row?.focus()
                    row?.scrollIntoView({ block: 'nearest' })
                  })
                }
              } else if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                setSelectedIds(new Set([e.id]))
                setActiveId(e.id)
                setLastSelectedPane('intermediate')
                openElementEditor(e)
              }
            }}
            testId="intermediate-grid"
          />
        </div>
        <div
          style={{ minWidth: 0, overflow: 'auto', padding: 8, borderLeft: '1px solid var(--d2d-border)' }}
          data-testid="intermediate-markdown"
        >
          <div className="document-preview-switch">
            <b>中間文書プレビュー</b>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              className={`d2d-btn small${previewMode === 'visual' ? ' active' : ''}`}
              onClick={() => setPreviewMode('visual')}
              data-testid="intermediate-preview-visual"
            >
              文書プレビュー
            </button>
            <button
              type="button"
              className={`d2d-btn small${previewMode === 'structure' ? ' active' : ''}`}
              onClick={() => setPreviewMode('structure')}
              data-testid="intermediate-preview-structure"
            >
              structure_json
            </button>
          </div>
          {previewMode === 'visual' && <DocumentPreviewMetaControls options={previewMeta} onChange={setPreviewMeta} />}
          {previewMode === 'structure' ? (
            <StructuredJsonView value={doc.structure} testId="intermediate-structure-json" />
          ) : (
            doc.elements.map((e) => (
              <article
                key={e.id}
                ref={(node) => {
                  if (node) previewRefs.current.set(e.id, node)
                  else previewRefs.current.delete(e.id)
                }}
                className={`extraction-preview-item${selectedIds.has(e.id) ? ' selected' : ''}${activeId === e.id ? ' active' : ''}${relatedCenterIds.has(e.id) ? ' related' : ''}`}
                onClick={() => {
                  setSelectedIds(new Set([e.id]))
                  setActiveId(e.id)
                  setLastSelectedPane('intermediate')
                }}
                onDoubleClick={() => openElementEditor(e)}
                style={{ marginLeft: (e.level ?? 0) * 14 }}
              >
                <header>
                  {previewMeta.parts && <span className="d2d-badge">{resourceTypeLabel(e.item_type)}</span>}
                  {previewMeta.elementIds && <code>{e.id}</code>}
                  {previewMeta.sections && e.section_path && <span>{e.section_path}</span>}
                </header>
                <button
                  type="button"
                  className="resource-type-button"
                  title="クリックしてResource種別・固有情報を編集"
                  onClick={(event) => {
                    event.stopPropagation()
                    openElementEditor(e)
                  }}
                >
                  {resourceTypeLabel(e.item_type)}
                </button>
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
            ))
          )}
        </div>
      </ResizablePaneGroup>
      <span data-testid="properties-selection-source" hidden>
        {lastSelectedPane}
      </span>
    </div>
  )
}
