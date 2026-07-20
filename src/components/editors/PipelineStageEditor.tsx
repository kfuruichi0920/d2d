/**
 * Pipeline Stage Overview（P3-7、UI-046/047/056）。
 * ①〜④をソート可能な一覧として開き、①②のアーカイブ／論理削除と②③の読取プレビューを提供する。
 */
import { Fragment, useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import type { ApiMethod } from '../../types/api-methods'
import { importSourceDocuments } from '../../services/source-import'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { useSelectionStore } from '../../stores/selection-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { resourceTypeLabel } from '../../types/resource'
import {
  OriginalActions,
  type SourceDocumentItem,
  type ExtractedDocumentItem,
  type IntermediateDocumentItem
} from '../views/DocumentsTree'
import type { DesignElementRow } from '../views/DesignModelViews'
import { ResizablePaneGroup } from '../workbench/ResizablePaneGroup'
import { IntermediateImportDialog } from './IntermediateImportDialog'
import { pushUndo } from '../../services/undo-service'
import { confirmDialog } from '../common/ConfirmDialog'
import {
  DocumentPreviewMetaControls,
  useDocumentPreviewMeta,
  type PreviewMetaOptions
} from '../common/DocumentPreviewMeta'
import { showContextMenu } from '../common/ContextMenu'

export type PipelineStage = 'source' | 'extracted' | 'intermediate' | 'design'
type SortDirection = 'asc' | 'desc'
type SortState = { key: string; direction: SortDirection }

type PreviewElement = {
  id: string
  type: string
  item_type?: string
  text?: string
  caption?: string | null
  level?: number
  section_path?: string
  rows?: { text: string; colspan?: number }[][]
  resource_uid?: string
  review?: { status: string }
}

type PreviewDocument = {
  uid: string
  code: string
  title: string | null
  status: string
  elements: PreviewElement[]
}

interface ArtifactSetting {
  uid: string
  artifact_name: string
  artifact_type_id: string
  dev_phase_id: string | null
  is_active: number
}
interface DevPhaseSetting {
  uid: string
  dev_phase_id: string
  dev_phase_name: string
  sort_order: number
  is_active: number
}
interface OntologyModelDefinition {
  model_type: string
  label: string
  layer: string
  is_enabled: number
}

const STAGE_TITLES: Record<PipelineStage, string> = {
  source: '①原本一覧',
  extracted: '②抽出データ一覧',
  intermediate: '③中間データ一覧',
  design: '④モデル一覧'
}

function valueOf(row: Record<string, unknown>, key: string): string | number {
  const value = row[key]
  return typeof value === 'number' ? value : String(value ?? '')
}

function sortedRows<T extends object>(rows: T[], sort: SortState): T[] {
  return [...rows].sort((left, right) => {
    const a = valueOf(left as Record<string, unknown>, sort.key)
    const b = valueOf(right as Record<string, unknown>, sort.key)
    const compared = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'ja')
    return sort.direction === 'asc' ? compared : -compared
  })
}

function handleStageRowKey(
  event: KeyboardEvent<HTMLTableRowElement>,
  uid: string,
  orderedUids: string[],
  onSelect: (uid: string) => void,
  onActivate: (uid: string) => void = onSelect
): void {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault()
    const currentIndex = orderedUids.indexOf(uid)
    const nextIndex = Math.max(0, Math.min(orderedUids.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)))
    const nextUid = orderedUids[nextIndex]
    if (!nextUid) return
    onSelect(nextUid)
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-stage-row-uid="${nextUid}"]`)?.focus()
    })
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    onActivate(uid)
  }
}

function SortHeader({
  label,
  column,
  sort,
  onSort
}: {
  label: string
  column: string
  sort: SortState
  onSort: (key: string) => void
}): React.JSX.Element {
  return (
    <th>
      <button className="stage-sort-button" type="button" onClick={() => onSort(column)} data-testid={`sort-${column}`}>
        {label} {sort.key === column ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}
      </button>
    </th>
  )
}

function FigurePreview({ resourceUid }: { resourceUid?: string }): React.JSX.Element {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!resourceUid) return
    void invoke<{ dataUrl: string }>('extracted.getFigurePreview', { resourceUid }).then((result) => {
      if (result.ok) setDataUrl(result.result.dataUrl)
    })
  }, [resourceUid])
  return dataUrl ? (
    <img src={dataUrl} alt="図" style={{ maxWidth: '100%', maxHeight: 360 }} />
  ) : (
    <span>図を読込中…</span>
  )
}

function ElementPreview({
  element,
  intermediate,
  previewMeta
}: {
  element: PreviewElement
  intermediate: boolean
  previewMeta: PreviewMetaOptions
}): React.JSX.Element {
  const type = intermediate ? (element.item_type ?? element.type) : element.type
  return (
    <article className="stage-preview-element">
      {previewMeta.parts && (
        <span className="d2d-badge status-running">{intermediate ? resourceTypeLabel(type) : type}</span>
      )}
      {previewMeta.elementIds && <code>{element.id}</code>}
      {previewMeta.sections && element.section_path && <span>{element.section_path}</span>}
      {element.review && <ReviewStatusBadge status={reviewStateFromEntityStatus(element.review.status)} />}
      {element.type === 'figure' || type === 'resource_figure' ? (
        <FigurePreview resourceUid={element.resource_uid} />
      ) : element.type === 'table' || type === 'resource_table' ? (
        <table className="d2d-table" style={{ marginTop: 6 }}>
          <tbody>
            {(element.rows ?? []).map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} colSpan={cell.colspan}>
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : element.type === 'heading' ? (
        <h3 style={{ margin: '6px 0 2px', paddingLeft: Math.max(0, (element.level ?? 1) - 1) * 12 }}>{element.text}</h3>
      ) : (
        <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0' }}>{element.text ?? element.caption ?? ''}</p>
      )}
    </article>
  )
}

function DocumentPreview({ uid, kind }: { uid: string; kind: 'extracted' | 'intermediate' }): React.JSX.Element {
  const [doc, setDoc] = useState<PreviewDocument | null>(null)
  const [previewMeta, setPreviewMeta] = useDocumentPreviewMeta()
  useEffect(() => {
    setDoc(null)
    void invoke<PreviewDocument>(`${kind}.get`, { uid }).then((result) => {
      if (result.ok) setDoc(result.result)
    })
  }, [kind, uid])
  if (!doc) return <div className="d2d-empty">プレビューを読込中…</div>
  return (
    <div className="stage-document-preview" data-testid={`${kind}-stage-preview`}>
      <h2>{doc.title ?? doc.code}</h2>
      <DocumentPreviewMetaControls options={previewMeta} onChange={setPreviewMeta} />
      {doc.elements.map((element) => (
        <ElementPreview
          key={element.id}
          element={element}
          intermediate={kind === 'intermediate'}
          previewMeta={previewMeta}
        />
      ))}
    </div>
  )
}

export function PipelineStageEditor({ stage }: { stage: PipelineStage }): React.JSX.Element {
  const [sources, setSources] = useState<SourceDocumentItem[]>([])
  const [extracted, setExtracted] = useState<ExtractedDocumentItem[]>([])
  const [intermediates, setIntermediates] = useState<IntermediateDocumentItem[]>([])
  const [models, setModels] = useState<DesignElementRow[]>([])
  const [modelDefinitions, setModelDefinitions] = useState<OntologyModelDefinition[]>([])
  const [newModelType, setNewModelType] = useState('model_req')
  const [newModelTitle, setNewModelTitle] = useState('')
  const [artifacts, setArtifacts] = useState<ArtifactSetting[]>([])
  const [phases, setPhases] = useState<DevPhaseSetting[]>([])
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [sort, setSort] = useState<SortState>({ key: 'code', direction: 'asc' })
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const notify = useJobsStore((state) => state.notify)
  const refreshStats = useProjectStore((state) => state.refreshStats)
  const openResource = useEditorStore((state) => state.openResource)
  const setSelectedItem = useSelectionStore((state) => state.setSelectedItem)
  const clearSelectedItem = useSelectionStore((state) => state.clearSelectedItem)

  const refresh = useCallback(async () => {
    const [
      sourceResult,
      extractedResult,
      intermediateResult,
      modelResult,
      artifactResult,
      phaseResult,
      ontologyResult
    ] = await Promise.all([
      invoke<SourceDocumentItem[]>('document.list', { includeArchived: true }),
      invoke<ExtractedDocumentItem[]>('extracted.list', { includeArchived: true }),
      invoke<IntermediateDocumentItem[]>('intermediate.list', { includeArchived: true }),
      invoke<DesignElementRow[]>('design.listElements'),
      invoke<ArtifactSetting[]>('project.listArtifactSettings'),
      invoke<DevPhaseSetting[]>('project.listDevPhases'),
      invoke<{ models: OntologyModelDefinition[] }>('ontology.get')
    ])
    if (sourceResult.ok) setSources(sourceResult.result)
    if (extractedResult.ok) setExtracted(extractedResult.result)
    if (intermediateResult.ok) setIntermediates(intermediateResult.result)
    if (modelResult.ok) setModels(modelResult.result)
    if (artifactResult.ok) setArtifacts(artifactResult.result)
    if (phaseResult.ok) setPhases(phaseResult.result)
    if (ontologyResult.ok) {
      const enabled = ontologyResult.result.models.filter((model) => model.is_enabled === 1)
      setModelDefinitions(enabled)
      setNewModelType((current) =>
        enabled.some((model) => model.model_type === current) ? current : (enabled[0]?.model_type ?? 'model_req')
      )
    }
  }, [])

  useEffect(() => {
    void refresh()
    return onBackendEvent((event) => {
      if (
        [
          'source.imported',
          'source.updated',
          'artifact.updated',
          'extraction.completed',
          'job.updated',
          'extracted.updated',
          'intermediate.updated',
          'design_model.updated',
          'ontology.updated'
        ].includes(event)
      )
        void refresh()
    })
  }, [refresh])

  const changeSort = (key: string): void =>
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))
  const mutate = async (
    method: ApiMethod,
    params: Record<string, unknown>,
    message: string,
    // W4（NFR-012）: 逆操作を指定した変更は Ctrl+Z で取り消せる。
    undoSpec?: { label: string; undoMethod: ApiMethod; undoParams: Record<string, unknown> }
  ): Promise<void> => {
    const result = await invoke(method, params)
    if (!result.ok) {
      notify('error', message, result.error.message)
      return
    }
    notify('info', message)
    setSelectedUid(null)
    await refresh()
    await refreshStats()
    if (undoSpec) {
      pushUndo({
        label: undoSpec.label,
        undo: async () => {
          const undone = await invoke(undoSpec.undoMethod, undoSpec.undoParams)
          if (!undone.ok) throw new Error(undone.error.message)
          await refreshStats()
        },
        redo: async () => {
          const redone = await invoke(method, params)
          if (!redone.ok) throw new Error(redone.error.message)
          await refreshStats()
        }
      })
    }
  }
  const confirmDelete = async (
    kind: 'document' | 'extracted' | 'intermediate',
    uid: string,
    name: string,
    previousStatus?: string
  ): Promise<void> => {
    const accepted = await confirmDialog({
      message: `${name}を削除しますか？\n通常削除のためデータは論理削除され、一覧とExplorerから非表示になります。`,
      okLabel: '削除',
      danger: true
    })
    if (!accepted) return
    void mutate(`${kind}.delete`, { uid }, `${name}を削除しました`, {
      label: `${name} の削除`,
      undoMethod: `${kind}.restore`,
      undoParams: { uid, status: previousStatus ?? 'draft' }
    })
  }

  const importDocuments = async (): Promise<void> => {
    await importSourceDocuments(notify)
  }

  const ensureArtifact = async (artifact: ArtifactSetting): Promise<void> => {
    const result = await invoke<{ intermediateDocumentUid: string }>('intermediate.ensureArtifact', {
      artifactUid: artifact.uid
    })
    if (!result.ok) {
      notify('error', '中間データを開けませんでした', result.error.message)
      return
    }
    await refresh()
    setSelectedUid(result.result.intermediateDocumentUid)
  }

  const removeIntermediateSource = async (row: IntermediateDocumentItem, sourceDocumentUid: string): Promise<void> => {
    const result = await invoke('intermediate.updateSources', {
      uid: row.uid,
      extractedDocumentUids: (row.sources ?? [])
        .map((source) => source.extracted_document_uid)
        .filter((uid) => uid !== sourceDocumentUid)
    })
    if (!result.ok) {
      notify('error', '取込元から削除できませんでした', result.error.message)
      return
    }
    notify('info', '取込元から抽出データを削除しました')
    await refresh()
  }

  const createModelElement = async (): Promise<void> => {
    if (!newModelTitle.trim()) {
      notify('warning', '設計モデルの名称を入力してください')
      return
    }
    const result = await invoke<{ uid: string; code: string }>('design.createElement', {
      modelType: newModelType,
      title: newModelTitle.trim()
    })
    if (!result.ok) {
      notify('error', '設計モデルを作成できませんでした', result.error.message)
      return
    }
    setNewModelTitle('')
    await refresh()
    await refreshStats()
    openResource(`design://${result.result.uid}`, result.result.code, { preview: false })
  }
  const createStateMachine = async (): Promise<void> => {
    const result = await invoke<{ uid: string; code: string }>('state.create', { name: '新しい状態機械' })
    if (!result.ok) {
      notify('error', '状態遷移を作成できませんでした', result.error.message)
      return
    }
    openResource(`design://${result.result.uid}`, result.result.code, { preview: false })
  }
  const sourceRows = useMemo(() => sortedRows(sources, sort), [sort, sources])
  const extractedRows = useMemo(() => sortedRows(extracted, sort), [extracted, sort])
  const modelRows = useMemo(() => sortedRows(models, sort), [models, sort])
  const intermediateOrderedUids = useMemo(
    () =>
      [...phases]
        .sort((a, b) => a.sort_order - b.sort_order)
        .flatMap((phase) =>
          sortedRows(
            intermediates.filter((row) => row.dev_phase_id === phase.dev_phase_id),
            sort
          ).map((row) => row.uid)
        ),
    [intermediates, phases, sort]
  )
  const sourceUids = sourceRows.map((row) => row.uid)
  const extractedUids = extractedRows.map((row) => row.uid)
  const modelUids = modelRows.map((row) => row.uid)
  const openDesign = (uid: string): void => {
    const row = models.find((candidate) => candidate.uid === uid)
    if (!row) return
    setSelectedUid(uid)
    openResource(`design://${uid}`, row.code, { preview: true })
  }
  const selectedSource = sources.find((row) => row.uid === selectedUid)
  const selectedStageItem =
    stage === 'source'
      ? sources.find((row) => row.uid === selectedUid)
      : stage === 'extracted'
        ? extracted.find((row) => row.uid === selectedUid)
        : stage === 'intermediate'
          ? intermediates.find((row) => row.uid === selectedUid)
          : models.find((row) => row.uid === selectedUid)

  useEffect(() => {
    const contextUri = `stage://${stage}`
    if (selectedStageItem) {
      const properties = Object.fromEntries(
        Object.entries(selectedStageItem).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))
      ) as Record<string, string | number | boolean>
      setSelectedItem({
        contextUri,
        uid: selectedStageItem.uid,
        displayId: selectedStageItem.code,
        entityType:
          stage === 'source'
            ? 'source_document'
            : stage === 'extracted'
              ? 'extracted_document'
              : stage === 'intermediate'
                ? 'intermediate_document'
                : (selectedStageItem as DesignElementRow).entity_type,
        title: selectedStageItem.title ?? undefined,
        status: selectedStageItem.status,
        properties
      })
    } else {
      clearSelectedItem(contextUri)
    }
    return () => clearSelectedItem(contextUri)
  }, [clearSelectedItem, selectedStageItem, setSelectedItem, stage])
  return (
    <div className="stage-overview" data-testid={`stage-overview-${stage}`}>
      <header>
        <h1>{STAGE_TITLES[stage]}</h1>
        <span>
          {stage === 'source'
            ? sources.length
            : stage === 'extracted'
              ? extracted.length
              : stage === 'intermediate'
                ? artifacts.filter((artifact) => artifact.is_active === 1 && artifact.dev_phase_id).length
                : models.length}
          件
        </span>
      </header>
      <ResizablePaneGroup
        initialSizes={stage === 'design' ? [1] : [1, 1]}
        testId={`stage-${stage}-layout`}
        className={`stage-overview-body ${stage === 'design' ? 'single' : ''}`}
      >
        <div className="stage-list-pane">
          <div className="stage-list-toolbar">
            {stage === 'source' && (
              <button
                type="button"
                className="d2d-btn primary"
                data-testid="stage-source-import"
                onClick={() => void importDocuments()}
              >
                取込…
              </button>
            )}
            {stage === 'extracted' && <span>文書を右クリックすると抽出データを編集できます。</span>}
            {stage === 'intermediate' && (
              <button
                type="button"
                className="d2d-btn primary"
                data-testid="intermediate-import-button"
                onClick={() => setImportDialogOpen(true)}
              >
                取込
              </button>
            )}
            {stage === 'design' && (
              <>
                <select
                  value={newModelType}
                  onChange={(event) => setNewModelType(event.target.value)}
                  aria-label="追加する設計モデル種別"
                >
                  {modelDefinitions.map((model) => (
                    <option key={model.model_type} value={model.model_type}>
                      {model.label}（{model.model_type}）
                    </option>
                  ))}
                </select>
                <input
                  value={newModelTitle}
                  onChange={(event) => setNewModelTitle(event.target.value)}
                  placeholder="新しい設計モデルの名称"
                  aria-label="新しい設計モデルの名称"
                />
                <button
                  type="button"
                  className="d2d-btn primary"
                  data-testid="add-design-model"
                  disabled={!newModelTitle.trim() || modelDefinitions.length === 0}
                  onClick={() => void createModelElement()}
                >
                  +設計モデル
                </button>
                <button
                  type="button"
                  className="d2d-btn"
                  data-testid="add-state-machine"
                  onClick={() => void createStateMachine()}
                >
                  +状態遷移
                </button>
                <button
                  type="button"
                  className="d2d-btn"
                  data-testid="open-model-editor"
                  onClick={() => openResource('model://playground', 'モデルエディタ', { preview: false })}
                >
                  +モデル
                </button>
                <button
                  type="button"
                  className="d2d-btn"
                  data-testid="open-glossary"
                  onClick={() => openResource('glossary://', '用語集', { preview: false })}
                >
                  用語集
                </button>
              </>
            )}
          </div>
          {stage === 'source' && (
            <table className="d2d-table stage-table">
              <thead>
                <tr>
                  <SortHeader label="ID" column="code" sort={sort} onSort={changeSort} />
                  <SortHeader label="ファイル名" column="file_name" sort={sort} onSort={changeSort} />
                  <SortHeader label="形式" column="file_type" sort={sort} onSort={changeSort} />
                  <SortHeader label="取込日時" column="imported_at" sort={sort} onSort={changeSort} />
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {sourceRows.map((row) => (
                  <tr
                    key={row.uid}
                    className={selectedUid === row.uid ? 'selected' : ''}
                    aria-selected={selectedUid === row.uid}
                    tabIndex={0}
                    data-stage-row-uid={row.uid}
                    onClick={() => setSelectedUid(row.uid)}
                    onKeyDown={(event) => handleStageRowKey(event, row.uid, sourceUids, setSelectedUid)}
                    data-testid={`stage-source-row-${row.code}`}
                  >
                    <td>{row.code}</td>
                    <td>{row.file_name}</td>
                    <td>{row.file_type}</td>
                    <td>{row.imported_at}</td>
                    <td>{row.is_archived ? 'アーカイブ' : '表示中'}</td>
                    <td className="stage-actions">
                      <button
                        className="d2d-btn small"
                        onClick={(event) => {
                          event.stopPropagation()
                          void mutate(
                            'document.setArchived',
                            { uid: row.uid, archived: !row.is_archived },
                            row.is_archived ? 'アーカイブを解除しました' : 'アーカイブしました',
                            {
                              label: `${row.file_name} の${row.is_archived ? 'アーカイブ解除' : 'アーカイブ'}`,
                              undoMethod: 'document.setArchived',
                              undoParams: { uid: row.uid, archived: Boolean(row.is_archived) }
                            }
                          )
                        }}
                      >
                        {row.is_archived ? '解除' : 'アーカイブ'}
                      </button>
                      <button
                        className="d2d-btn small danger"
                        onClick={(event) => {
                          event.stopPropagation()
                          void confirmDelete('document', row.uid, row.file_name, row.status)
                        }}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {stage === 'extracted' && (
            <table className="d2d-table stage-table">
              <thead>
                <tr>
                  <SortHeader label="状態" column="status" sort={sort} onSort={changeSort} />
                  <SortHeader label="ID" column="code" sort={sort} onSort={changeSort} />
                  <SortHeader label="名称" column="title" sort={sort} onSort={changeSort} />
                  <SortHeader label="要素数" column="item_count" sort={sort} onSort={changeSort} />
                  <SortHeader label="未確定" column="unconfirmed_count" sort={sort} onSort={changeSort} />
                  <SortHeader label="抽出日時" column="extracted_at" sort={sort} onSort={changeSort} />
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {extractedRows.map((row) => (
                  <tr
                    key={row.uid}
                    className={selectedUid === row.uid ? 'selected' : ''}
                    aria-selected={selectedUid === row.uid}
                    tabIndex={0}
                    data-stage-row-uid={row.uid}
                    onClick={() => setSelectedUid(row.uid)}
                    onKeyDown={(event) => handleStageRowKey(event, row.uid, extractedUids, setSelectedUid)}
                    onDoubleClick={() =>
                      openResource(`extracted://${row.uid}`, `抽出: ${row.title ?? row.code}`, { preview: true })
                    }
                    onContextMenu={(event) => {
                      setSelectedUid(row.uid)
                      showContextMenu(event, [
                        {
                          label: '抽出データを編集',
                          testId: 'ctx-stage-edit-extracted',
                          run: () =>
                            openResource(`extracted://${row.uid}`, `抽出: ${row.title ?? row.code}`, {
                              preview: false
                            })
                        }
                      ])
                    }}
                    data-testid={`stage-extracted-row-${row.code}`}
                  >
                    <td>
                      <ReviewStatusBadge status={reviewStateFromEntityStatus(row.status)} />
                      {row.is_archived ? ' アーカイブ' : ''}
                    </td>
                    <td>{row.code}</td>
                    <td>{row.title ?? row.code}</td>
                    <td>{row.item_count}</td>
                    <td>{row.unconfirmed_count}</td>
                    <td>{row.extracted_at}</td>
                    <td className="stage-actions">
                      <button
                        className="d2d-btn small"
                        onClick={(event) => {
                          event.stopPropagation()
                          void mutate(
                            'extracted.setArchived',
                            { uid: row.uid, archived: !row.is_archived },
                            row.is_archived ? 'アーカイブを解除しました' : 'アーカイブしました',
                            {
                              label: `${row.title ?? row.code} の${row.is_archived ? 'アーカイブ解除' : 'アーカイブ'}`,
                              undoMethod: 'extracted.setArchived',
                              undoParams: { uid: row.uid, archived: Boolean(row.is_archived) }
                            }
                          )
                        }}
                      >
                        {row.is_archived ? '解除' : 'アーカイブ'}
                      </button>
                      <button
                        className="d2d-btn small danger"
                        onClick={(event) => {
                          event.stopPropagation()
                          void confirmDelete('extracted', row.uid, row.title ?? row.code)
                        }}
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {stage === 'intermediate' && (
            <IntermediateHierarchy
              rows={intermediates}
              phases={phases}
              artifacts={artifacts}
              extracted={extracted}
              sort={sort}
              onSort={changeSort}
              selectedUid={selectedUid}
              orderedUids={intermediateOrderedUids}
              onSelect={setSelectedUid}
              onEdit={(row) =>
                openResource(`intermediate://${row.uid}`, `中間: ${row.title ?? row.code}`, { preview: false })
              }
              onOpenArtifact={(artifact) => void ensureArtifact(artifact)}
              onRemoveSource={(row, sourceUid) => void removeIntermediateSource(row, sourceUid)}
              onArchive={(row) =>
                void mutate(
                  'intermediate.setArchived',
                  { uid: row.uid, archived: !row.is_archived },
                  row.is_archived ? 'アーカイブを解除しました' : 'アーカイブしました',
                  {
                    label: `${row.code} の${row.is_archived ? 'アーカイブ解除' : 'アーカイブ'}`,
                    undoMethod: 'intermediate.setArchived',
                    undoParams: { uid: row.uid, archived: Boolean(row.is_archived) }
                  }
                )
              }
              onDelete={(row, artifactName) => void confirmDelete('intermediate', row.uid, artifactName)}
            />
          )}
          {stage === 'design' && (
            <table className="d2d-table stage-table">
              <thead>
                <tr>
                  <SortHeader label="モデル種別" column="model_type" sort={sort} onSort={changeSort} />
                  <SortHeader label="ID" column="code" sort={sort} onSort={changeSort} />
                  <SortHeader label="名称" column="title" sort={sort} onSort={changeSort} />
                  <SortHeader label="種別" column="entity_type" sort={sort} onSort={changeSort} />
                  <SortHeader label="状態" column="status" sort={sort} onSort={changeSort} />
                </tr>
              </thead>
              <tbody>
                {modelRows.map((row) => (
                  <tr
                    key={row.uid}
                    className={selectedUid === row.uid ? 'selected' : ''}
                    aria-selected={selectedUid === row.uid}
                    tabIndex={0}
                    data-stage-row-uid={row.uid}
                    onClick={() => openDesign(row.uid)}
                    onKeyDown={(event) => handleStageRowKey(event, row.uid, modelUids, setSelectedUid, openDesign)}
                    data-testid={`stage-design-row-${row.code}`}
                  >
                    <td>{row.model_type}</td>
                    <td>{row.code}</td>
                    <td>{row.title}</td>
                    <td>{row.entity_type}</td>
                    <td>
                      <ReviewStatusBadge status={reviewStateFromEntityStatus(row.status)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        {stage !== 'design' && (
          <aside className="stage-preview-pane">
            {!selectedUid && <div className="d2d-empty">一覧から項目を選択してください。</div>}
            {stage === 'source' && selectedSource && (
              <div data-testid="source-stage-preview">
                <h2>{selectedSource.file_name}</h2>
                <dl className="d2d-kv">
                  <dt>ID</dt>
                  <dd>{selectedSource.code}</dd>
                  <dt>形式</dt>
                  <dd>{selectedSource.file_type}</dd>
                  <dt>SHA-256</dt>
                  <dd>{selectedSource.file_hash}</dd>
                  <dt>取込日時</dt>
                  <dd>{selectedSource.imported_at}</dd>
                </dl>
                <p>原本は読み取り専用です。内容表示と編集はOSにインストールされたアプリを使用します。</p>
                <OriginalActions doc={selectedSource} />
              </div>
            )}
            {stage === 'extracted' && selectedUid && <DocumentPreview uid={selectedUid} kind="extracted" />}
            {stage === 'intermediate' && selectedUid && <DocumentPreview uid={selectedUid} kind="intermediate" />}
          </aside>
        )}
      </ResizablePaneGroup>
      {importDialogOpen && (
        <IntermediateImportDialog
          onClose={() => setImportDialogOpen(false)}
          onSaved={async () => {
            await refresh()
            await refreshStats()
          }}
        />
      )}
    </div>
  )
}

function IntermediateHierarchy({
  rows,
  phases,
  artifacts,
  extracted,
  sort,
  onSort,
  selectedUid,
  orderedUids,
  onSelect,
  onEdit,
  onOpenArtifact,
  onRemoveSource,
  onArchive,
  onDelete
}: {
  rows: IntermediateDocumentItem[]
  phases: DevPhaseSetting[]
  artifacts: ArtifactSetting[]
  extracted: ExtractedDocumentItem[]
  sort: SortState
  onSort: (key: string) => void
  selectedUid: string | null
  orderedUids: string[]
  onSelect: (uid: string) => void
  onEdit: (row: IntermediateDocumentItem) => void
  onOpenArtifact: (artifact: ArtifactSetting) => void
  onRemoveSource: (row: IntermediateDocumentItem, sourceUid: string) => void
  onArchive: (row: IntermediateDocumentItem) => void
  onDelete: (row: IntermediateDocumentItem, artifactName: string) => void
}): React.JSX.Element {
  return (
    <div data-testid="stage-intermediate-hierarchy">
      {[...phases]
        .filter((phase) => phase.is_active === 1)
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((phase) => {
          const phaseArtifacts = artifacts.filter(
            (artifact) => artifact.is_active === 1 && artifact.dev_phase_id === phase.dev_phase_id
          )
          if (phaseArtifacts.length === 0) return null
          const phaseEntries = phaseArtifacts.reduce<
            Array<{ artifact: ArtifactSetting; row?: IntermediateDocumentItem }>
          >((entries, artifact) => {
            const matchingRows = rows.filter(
              (item) => item.dev_phase_id === phase.dev_phase_id && item.artifact_type_id === artifact.artifact_type_id
            )
            entries.push(
              ...(matchingRows.length > 0
                ? matchingRows.map((row) => ({ artifact, row }))
                : [{ artifact, row: undefined }])
            )
            return entries
          }, [])
          return (
            <section key={phase.uid} className="stage-phase-group">
              <h2>
                <span className="d2d-hierarchy-kind">フェーズ</span> {phase.dev_phase_name}
              </h2>
              <table className="d2d-table stage-table">
                <thead>
                  <tr>
                    <SortHeader label="状態" column="status" sort={sort} onSort={onSort} />
                    <SortHeader label="成果物" column="artifact_type_id" sort={sort} onSort={onSort} />
                    <SortHeader label="ID" column="code" sort={sort} onSort={onSort} />
                    <SortHeader label="要素数" column="item_count" sort={sort} onSort={onSort} />
                    <SortHeader label="未確定" column="unconfirmed_count" sort={sort} onSort={onSort} />
                    <th>表示</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {phaseEntries.map(({ artifact, row }) => {
                    const sourceIds = row?.sources?.map((source) => source.extracted_document_uid) ?? []
                    const activate = (): void => (row ? onSelect(row.uid) : onOpenArtifact(artifact))
                    return (
                      <Fragment key={`${artifact.uid}:${row?.uid ?? 'slot'}`}>
                        <tr
                          className={row && selectedUid === row.uid ? 'selected' : ''}
                          aria-selected={row ? selectedUid === row.uid : false}
                          tabIndex={0}
                          data-stage-row-uid={row?.uid ?? artifact.uid}
                          onClick={activate}
                          onContextMenu={(event) => {
                            if (!row) return
                            onSelect(row.uid)
                            showContextMenu(event, [
                              {
                                label: '中間データを編集',
                                testId: 'ctx-stage-edit-intermediate',
                                run: () => onEdit(row)
                              }
                            ])
                          }}
                          onKeyDown={(event) => {
                            if (row) handleStageRowKey(event, row.uid, orderedUids, onSelect)
                            else if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault()
                              activate()
                            }
                          }}
                          data-testid={
                            row
                              ? `stage-intermediate-row-${row.code}`
                              : `stage-artifact-slot-${phase.dev_phase_id}-${artifact.artifact_type_id}`
                          }
                        >
                          <td>
                            {row ? <ReviewStatusBadge status={reviewStateFromEntityStatus(row.status)} /> : '未作成'}
                          </td>
                          <td>
                            <span className="d2d-hierarchy-kind artifact">成果物</span> {artifact.artifact_name}
                          </td>
                          <td>{row?.code ?? '—'}</td>
                          <td>{row?.item_count ?? 0}</td>
                          <td>{row?.unconfirmed_count ?? 0}</td>
                          <td>{row ? (row.is_archived ? 'アーカイブ' : '表示中') : '設定済み'}</td>
                          <td className="stage-actions">
                            {row && (
                              <>
                                <button
                                  type="button"
                                  className="d2d-btn small"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onArchive(row)
                                  }}
                                >
                                  {row.is_archived ? '解除' : 'アーカイブ'}
                                </button>
                                <button
                                  type="button"
                                  className="d2d-btn small danger"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    onDelete(row, artifact.artifact_name)
                                  }}
                                >
                                  削除
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                        <tr className="stage-intermediate-sources">
                          <td colSpan={7}>
                            <b>取込元:</b>{' '}
                            {sourceIds.length === 0
                              ? '未選択'
                              : sourceIds.map((sourceUid) => (
                                  <span key={sourceUid} className="stage-intermediate-source">
                                    {extracted.find((item) => item.uid === sourceUid)?.title ?? sourceUid}
                                    {row && (
                                      <button
                                        type="button"
                                        className="d2d-btn small danger"
                                        onClick={() => onRemoveSource(row, sourceUid)}
                                        title="この抽出データを成果物の取込元から削除します"
                                      >
                                        削除
                                      </button>
                                    )}
                                  </span>
                                ))}
                          </td>
                        </tr>
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </section>
          )
        })}
    </div>
  )
}
