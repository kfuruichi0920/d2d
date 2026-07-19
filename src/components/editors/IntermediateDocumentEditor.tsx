/**
 * Intermediate Document Editor（P7-7、V-03、UI-012、EDIT-002〜008）。
 * ③中間データの文書風表示 + 要素編集（編集/マージ/分割/LLM候補）+ 正本確定。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ColumnDef } from '@tanstack/react-table'
import { invoke, onBackendEvent } from '../../services/backend'
import type { ApiMethod } from '../../types/api-methods'
import { moveKeyboardRangeSelection } from '../../utils/keyboard-range-selection'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { useSelectionStore } from '../../stores/selection-store'
import { useResourceNavigationStore } from '../../stores/resource-navigation-store'
import { VirtualDataGrid } from '../common/VirtualDataGrid'
import { StructuredJsonView } from '../common/StructuredJsonView'
import { DocumentPreviewMetaControls, useDocumentPreviewMeta } from '../common/DocumentPreviewMeta'
import { ResourceEditor } from './ResourceEditor'
import { resourceTypeLabel } from '../../types/resource'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { ResizablePaneGroup } from '../workbench/ResizablePaneGroup'
import { ChunkEditor } from './ChunkEditor'
import { pushUndo } from '../../services/undo-service'
import { useEscapeToClose } from '../common/useEscapeToClose'
import { showContextMenu } from '../common/ContextMenu'
import { visibleHierarchyRows } from '../../utils/intermediate-hierarchy'
import { IntermediateArtifactTree } from './IntermediateArtifactTree'

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
  const [itemAnchorId, setItemAnchorId] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [artifactScrollVersion, setArtifactScrollVersion] = useState(0)
  const [sourceItems, setSourceItems] = useState<(IntermediateElement & { source_title?: string })[]>([])
  const [sourceSelectedIds, setSourceSelectedIds] = useState<Set<string>>(new Set())
  const [sourceActiveId, setSourceActiveId] = useState<string | null>(null)
  const [sourceAnchorId, setSourceAnchorId] = useState<string | null>(null)
  const [lastSelectedPane, setLastSelectedPane] = useState<'source' | 'intermediate'>('intermediate')
  const [editorMode, setEditorMode] = useState<IntermediateEditorMode>(initialMode)
  const [previewMode, setPreviewMode] = useState<'visual' | 'structure'>('visual')
  const [artifactListMode, setArtifactListMode] = useState<'table' | 'outline'>('table')
  const [collapsedElementIds, setCollapsedElementIds] = useState<Set<string>>(new Set())
  const [previewMeta, setPreviewMeta] = useDocumentPreviewMeta()
  const previewRefs = useRef(new Map<string, HTMLElement>())
  const [elementEditor, setElementEditor] = useState<ElementEditorState | null>(null)
  const [resourceEditing, setResourceEditing] = useState<IntermediateElement | null>(null)
  const [terms, setTerms] = useState<string[]>([])
  const notify = useJobsStore((s) => s.notify)
  // モーダルは Escape で閉じる（W10）。Resource編集→種別変更確認のような入れ子は最前面から閉じる。
  useEscapeToClose(elementEditor !== null, () => setElementEditor(null))
  useEscapeToClose(resourceEditing !== null, () => setResourceEditing(null))
  const setWorkbenchItems = useSelectionStore((s) => s.setWorkbenchItems)
  const setSelectedItem = useSelectionStore((s) => s.setSelectedItem)
  const clearSelectedItem = useSelectionStore((s) => s.clearSelectedItem)
  const navigationTarget = useResourceNavigationStore((state) => state.target)

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
    if (!doc || navigationTarget?.uri !== `intermediate://${uid}`) return
    const target = doc.elements.find(
      (element) =>
        (navigationTarget.itemUid && element.intermediate_item_uid === navigationTarget.itemUid) ||
        (navigationTarget.resourceUid && element.resource_uid === navigationTarget.resourceUid)
    )
    if (!target) return
    setSelectedIds(new Set([target.id]))
    setActiveId(target.id)
    setItemAnchorId(target.id)
    setLastSelectedPane('intermediate')
    previewRefs.current.get(target.id)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [doc, navigationTarget, uid])

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

  const hierarchyRows = useMemo(
    () => visibleHierarchyRows(doc?.elements ?? [], collapsedElementIds),
    [collapsedElementIds, doc?.elements]
  )
  const visibleArtifactElements = useMemo(() => hierarchyRows.map((row) => row.item), [hierarchyRows])
  const previewElements = artifactListMode === 'outline' ? visibleArtifactElements : (doc?.elements ?? [])

  const onPreviewKeyDown = (element: IntermediateElement, event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const next = moveKeyboardRangeSelection(
      previewElements,
      activeId ?? element.id,
      itemAnchorId,
      event.key === 'ArrowUp' ? -1 : 1,
      event.shiftKey,
      (item) => item.id
    )
    if (!next) return
    setSelectedIds(next.selectedIds)
    setActiveId(next.activeId)
    setItemAnchorId(next.anchorId)
    setLastSelectedPane('intermediate')
    setArtifactScrollVersion((version) => version + 1)
    requestAnimationFrame(() => previewRefs.current.get(next.activeId)?.focus())
  }

  // 操作対象はコンテキストメニュー表示時点の有効選択を明示的に受け取る（複数選択対応、MID-004）
  const integrate = async (position: 'above' | 'below', sourceRowIds: ReadonlySet<string>): Promise<void> => {
    const extractedItemUids = sourceItems
      .filter((item) => sourceRowIds.has(item.id))
      .map((item) => item.extracted_item_uid)
      .filter((itemUid): itemUid is string => Boolean(itemUid))
    await call(
      'intermediate.insertExtractedItems',
      { extractedItemUids, targetElementId: selectedIds.size === 1 ? activeId : undefined, position },
      `${extractedItemUids.length}要素を成果物へ追加しました`
    )
  }
  const deleteSourceLinks = async (sourceRowIds: ReadonlySet<string>): Promise<void> => {
    const extractedItemUids = sourceItems
      .filter((item) => sourceRowIds.has(item.id))
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
  const move = async (direction: 'up' | 'down', elementIds: ReadonlySet<string>): Promise<void> => {
    await call('intermediate.reorderItems', { elementIds: [...elementIds], direction }, '表示順を更新しました')
  }
  const hierarchy = async (delta: number, elementIds: ReadonlySet<string>): Promise<void> => {
    await call('intermediate.changeHierarchy', { elementIds: [...elementIds], delta }, '階層を更新しました')
  }

  const call = async (
    method: ApiMethod,
    params: Record<string, unknown>,
    successMessage?: string
  ): Promise<boolean> => {
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

  const openAddEditor = (position: 'above' | 'below', targetElementId?: string): void => {
    setElementEditor({
      action: 'add',
      elementId: targetElementId ?? activeId ?? undefined,
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

  const duplicateElement = async (elementId: string): Promise<void> => {
    const result = await invoke<{ elementId: string }>('intermediate.duplicateElement', {
      uid,
      elementId
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

  const mergeAdjacent = async (direction: 'up' | 'down', elementId: string): Promise<void> => {
    if (!doc) return
    const index = doc.elements.findIndex((element) => element.id === elementId)
    const adjacent = doc.elements[index + (direction === 'up' ? -1 : 1)]
    if (!adjacent) return
    const result = await invoke<{ newElementId: string; warnings: string[] }>('intermediate.mergeElements', {
      uid,
      elementIds: direction === 'up' ? [adjacent.id, elementId] : [elementId, adjacent.id]
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
  /**
   * 統合元行の右クリックメニュー（MID-004 UI改善）。
   * 未選択行の右クリックはその行の単独選択に切り替え、複数選択中は選択全体へ適用する。
   */
  const openSourceRowMenu = (row: IntermediateElement, event: React.MouseEvent<HTMLElement>): void => {
    const effective = sourceSelectedIds.has(row.id) ? sourceSelectedIds : new Set([row.id])
    if (!sourceSelectedIds.has(row.id)) {
      setSourceSelectedIds(effective)
      setSourceActiveId(row.id)
      setSourceAnchorId(row.id)
      setLastSelectedPane('source')
    }
    const count = sourceItems.filter((item) => effective.has(item.id) && item.extracted_item_uid).length
    const targetInvalid = (doc?.elements.length ?? 0) > 0 && selectedIds.size !== 1
    const targetHint = targetInvalid ? '成果物側で挿入位置の行を1件選択してください' : undefined
    showContextMenu(event, [
      {
        label: `成果物の上に追加（${count}件）`,
        detail: targetHint,
        testId: 'ctx-source-add-above',
        disabled: count === 0 || targetInvalid,
        run: () => void integrate('above', effective)
      },
      {
        label: `成果物の下に追加（${count}件）`,
        detail: targetHint,
        testId: 'ctx-source-add-below',
        disabled: count === 0 || targetInvalid,
        run: () => void integrate('below', effective)
      },
      { separator: true },
      {
        label: `成果物対応を削除（${count}件）`,
        detail: '抽出データ自体は削除しません',
        testId: 'ctx-source-delete',
        disabled: count === 0,
        run: () => void deleteSourceLinks(effective)
      }
    ])
  }

  /** 成果物行の右クリックメニュー（MID-004 UI改善）。単一選択限定の操作は複数選択時に無効化する */
  const openArtifactRowMenu = (row: IntermediateElement, event: React.MouseEvent<HTMLElement>): void => {
    if (!doc) return
    const effective = selectedIds.has(row.id) ? selectedIds : new Set([row.id])
    if (!selectedIds.has(row.id)) {
      setSelectedIds(effective)
      setActiveId(row.id)
      setItemAnchorId(row.id)
      setLastSelectedPane('intermediate')
    }
    const single = effective.size === 1
    const index = doc.elements.findIndex((element) => element.id === row.id)
    const count = effective.size
    showContextMenu(event, [
      { label: '編集…', testId: 'ctx-element-edit', disabled: !single, run: () => openElementEditor(row) },
      { label: '複製', testId: 'ctx-element-duplicate', disabled: !single, run: () => void duplicateElement(row.id) },
      ...(editorMode === 'standalone'
        ? [
            { separator: true as const },
            {
              label: '上に要素を追加…',
              testId: 'ctx-element-add-above',
              disabled: !single,
              run: () => openAddEditor('above', row.id)
            },
            {
              label: '下に要素を追加…',
              testId: 'ctx-element-add-below',
              disabled: !single,
              run: () => openAddEditor('below', row.id)
            }
          ]
        : []),
      { separator: true },
      {
        label: '上の要素へ統合',
        testId: 'ctx-merge-up',
        disabled: !single || index <= 0,
        run: () => void mergeAdjacent('up', row.id)
      },
      {
        label: '下の要素と統合',
        testId: 'ctx-merge-down',
        disabled: !single || index < 0 || index >= doc.elements.length - 1,
        run: () => void mergeAdjacent('down', row.id)
      },
      { separator: true },
      { label: `上へ移動（${count}件）`, testId: 'ctx-move-up', run: () => void move('up', effective) },
      { label: `下へ移動（${count}件）`, testId: 'ctx-move-down', run: () => void move('down', effective) },
      { label: `階層を上げる（${count}件）`, testId: 'ctx-hierarchy-up', run: () => void hierarchy(-1, effective) },
      { label: `階層を下げる（${count}件）`, testId: 'ctx-hierarchy-down', run: () => void hierarchy(1, effective) },
      { separator: true },
      {
        label: `成果物から削除（${count}件）`,
        testId: 'ctx-element-delete',
        run: () => void removeElements(effective)
      }
    ])
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
    // DB 上の表現へ写像する（表示 'review' = 保存 'needs_fix'）
    const toStored = (status: string): string => (status === 'review' ? 'needs_fix' : status)
    const ok = await call(
      'intermediate.updateItemStatuses',
      { elementIds: [element.id], status: toStored(next) },
      'レビュー状態を更新しました'
    )
    if (ok) {
      // W7（NFR-012）: レビュー状態変更を Ctrl+Z で戻せるようにする。
      const elementIds = [element.id]
      const apply = async (status: string): Promise<void> => {
        const result = await invoke('intermediate.updateItemStatuses', { uid, elementIds, status })
        if (!result.ok) throw new Error(result.error.message)
        await load()
      }
      pushUndo({
        label: `③レビュー状態の変更（${current} → ${next}）`,
        undo: () => apply(toStored(current)),
        redo: () => apply(toStored(next))
      })
    }
  }
  const removeElements = async (elementIds: ReadonlySet<string>): Promise<void> => {
    if (elementIds.size === 0) return
    await call('intermediate.deleteItems', { elementIds: [...elementIds] }, '成果物から要素を削除しました')
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
        data-editor-icon="⇲"
        data-testid="intermediate-mode-import"
        onClick={() => setEditorMode('import')}
      >
        中間データ取込編集
      </button>
      <button
        type="button"
        className={`d2d-btn small${editorMode === 'standalone' ? ' primary' : ''}`}
        data-editor-icon="✎"
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
        data-editor-icon="◫"
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
          data-editor-icon="★"
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
            onIntegrated={() => setResourceEditing(null)}
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
              <span className="intermediate-context-hint">右クリックで追加・対応削除</span>
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
              onRowContextMenu={(e, event) => openSourceRowMenu(e, event)}
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
          <div className="intermediate-artifact-heading">
            <b>成果物 intermediate_item</b>
            <span className="intermediate-context-hint">右クリックで要素操作</span>
            <span className="intermediate-artifact-view-actions">
              {editorMode === 'standalone' && (
                <button
                  type="button"
                  className="d2d-btn small"
                  data-editor-icon="＋"
                  data-testid="element-add-below"
                  onClick={() => openAddEditor('below')}
                  title="選択行の下（未選択時は末尾）へ中間要素を追加します"
                >
                  ＋追加
                </button>
              )}
              <button
                type="button"
                className={`d2d-btn small${artifactListMode === 'table' ? ' active' : ''}`}
                onClick={() => setArtifactListMode('table')}
                data-editor-icon="▦"
                data-testid="intermediate-list-table"
                title="成果物を表形式で表示します"
              >
                ▦ 一覧
              </button>
              <button
                type="button"
                className={`d2d-btn small${artifactListMode === 'outline' ? ' active' : ''}`}
                onClick={() => setArtifactListMode('outline')}
                data-editor-icon="☷"
                data-testid="intermediate-list-outline"
                title="levelに基づく親子Treeとして表示し、折畳／展開します"
              >
                ☷ アウトライン
              </button>
            </span>
          </div>
          {artifactListMode === 'table' ? (
            <VirtualDataGrid
              columns={columns}
              data={doc.elements}
              getRowId={(e) => e.id}
              selectedRowIds={selectedIds}
              activeRowId={activeId}
              scrollToRowId={activeId}
              scrollToRowVersion={artifactScrollVersion}
              scrollToRowAlign="center"
              relatedRowIds={relatedCenterIds}
              height="calc(100% - 28px)"
              onRowClick={(e, event) => {
                setSelectedIds(selectRows(doc.elements, e, event, selectedIds, itemAnchorId))
                setActiveId(e.id)
                if (!event.shiftKey) setItemAnchorId(e.id)
                setLastSelectedPane('intermediate')
                if (event.detail >= 2) openElementEditor(e)
              }}
              onRowKeyDown={(e, event) => {
                if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                  event.preventDefault()
                  const next = moveKeyboardRangeSelection(
                    doc.elements,
                    activeId ?? e.id,
                    itemAnchorId,
                    event.key === 'ArrowUp' ? -1 : 1,
                    event.shiftKey,
                    (item) => item.id
                  )
                  if (next) {
                    setSelectedIds(next.selectedIds)
                    setActiveId(next.activeId)
                    setItemAnchorId(next.anchorId)
                    setLastSelectedPane('intermediate')
                  }
                } else if (event.key === ' ' || event.key === 'Enter') {
                  event.preventDefault()
                  setSelectedIds(new Set([e.id]))
                  setActiveId(e.id)
                  setItemAnchorId(e.id)
                  setLastSelectedPane('intermediate')
                  openElementEditor(e)
                }
              }}
              onRowContextMenu={(e, event) => openArtifactRowMenu(e, event)}
              testId="intermediate-grid"
            />
          ) : (
            <IntermediateArtifactTree
              rows={hierarchyRows}
              selectedIds={selectedIds}
              activeId={activeId}
              onRowContextMenu={(item, event) => openArtifactRowMenu(item, event)}
              collapsedIds={collapsedElementIds}
              onToggle={(id) =>
                setCollapsedElementIds((current) => {
                  const next = new Set(current)
                  if (next.has(id)) next.delete(id)
                  else next.add(id)
                  return next
                })
              }
              onSelect={(item, event) => {
                setSelectedIds(selectRows(visibleArtifactElements, item, event, selectedIds, itemAnchorId))
                setActiveId(item.id)
                if (!event.shiftKey) setItemAnchorId(item.id)
                setLastSelectedPane('intermediate')
                setArtifactScrollVersion((version) => version + 1)
              }}
              onOpen={openElementEditor}
              onMove={(item, direction, extend) => {
                const next = moveKeyboardRangeSelection(
                  visibleArtifactElements,
                  activeId ?? item.id,
                  itemAnchorId,
                  direction,
                  extend,
                  (candidate) => candidate.id
                )
                if (next) {
                  setSelectedIds(next.selectedIds)
                  setActiveId(next.activeId)
                  setItemAnchorId(next.anchorId)
                  setLastSelectedPane('intermediate')
                }
              }}
            />
          )}
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
              data-editor-icon="◉"
              data-testid="intermediate-preview-visual"
            >
              文書プレビュー
            </button>
            <button
              type="button"
              className={`d2d-btn small${previewMode === 'structure' ? ' active' : ''}`}
              onClick={() => setPreviewMode('structure')}
              data-editor-icon="{}"
              data-testid="intermediate-preview-structure"
            >
              structure_json
            </button>
          </div>
          {previewMode === 'visual' && <DocumentPreviewMetaControls options={previewMeta} onChange={setPreviewMeta} />}
          {previewMode === 'structure' ? (
            <StructuredJsonView value={doc.structure} testId="intermediate-structure-json" />
          ) : (
            previewElements.map((e) => (
              <article
                key={e.id}
                data-testid={`intermediate-preview-item-${e.id}`}
                ref={(node) => {
                  if (node) previewRefs.current.set(e.id, node)
                  else previewRefs.current.delete(e.id)
                }}
                className={`extraction-preview-item${selectedIds.has(e.id) ? ' selected' : ''}${activeId === e.id ? ' active' : ''}${relatedCenterIds.has(e.id) ? ' related' : ''}`}
                tabIndex={0}
                onKeyDown={(event) => onPreviewKeyDown(e, event)}
                onClick={() => {
                  setSelectedIds(new Set([e.id]))
                  setActiveId(e.id)
                  setItemAnchorId(e.id)
                  setLastSelectedPane('intermediate')
                  setArtifactScrollVersion((version) => version + 1)
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
