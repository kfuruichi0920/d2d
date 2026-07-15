/**
 * Pipeline Stage Overview（P3-7、UI-046/047）。
 * ①〜④をソート可能な一覧として開き、①②のアーカイブ／論理削除と②③の読取プレビューを提供する。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { resourceTypeLabel } from '../../types/resource'
import type { SourceDocumentItem, ExtractedDocumentItem, IntermediateDocumentItem } from '../views/DocumentsTree'
import type { DesignElementRow } from '../views/DesignModelViews'

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
  intermediate
}: {
  element: PreviewElement
  intermediate: boolean
}): React.JSX.Element {
  const type = intermediate ? (element.item_type ?? element.type) : element.type
  return (
    <article className="stage-preview-element">
      <span className="d2d-badge status-running">{intermediate ? resourceTypeLabel(type) : type}</span>
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
      {doc.elements.map((element) => (
        <ElementPreview key={element.id} element={element} intermediate={kind === 'intermediate'} />
      ))}
    </div>
  )
}

export function PipelineStageEditor({ stage }: { stage: PipelineStage }): React.JSX.Element {
  const [sources, setSources] = useState<SourceDocumentItem[]>([])
  const [extracted, setExtracted] = useState<ExtractedDocumentItem[]>([])
  const [intermediates, setIntermediates] = useState<IntermediateDocumentItem[]>([])
  const [models, setModels] = useState<DesignElementRow[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactSetting[]>([])
  const [phases, setPhases] = useState<DevPhaseSetting[]>([])
  const [selectedUid, setSelectedUid] = useState<string | null>(null)
  const [sort, setSort] = useState<SortState>({ key: 'code', direction: 'asc' })
  const notify = useJobsStore((state) => state.notify)
  const refreshStats = useProjectStore((state) => state.refreshStats)
  const openResource = useEditorStore((state) => state.openResource)

  const refresh = useCallback(async () => {
    const [sourceResult, extractedResult, intermediateResult, modelResult, artifactResult, phaseResult] =
      await Promise.all([
        invoke<SourceDocumentItem[]>('document.list', { includeArchived: true }),
        invoke<ExtractedDocumentItem[]>('extracted.list', { includeArchived: true }),
        invoke<IntermediateDocumentItem[]>('intermediate.list'),
        invoke<DesignElementRow[]>('design.listElements'),
        invoke<ArtifactSetting[]>('project.listArtifactSettings'),
        invoke<DevPhaseSetting[]>('project.listDevPhases')
      ])
    if (sourceResult.ok) setSources(sourceResult.result)
    if (extractedResult.ok) setExtracted(extractedResult.result)
    if (intermediateResult.ok) setIntermediates(intermediateResult.result)
    if (modelResult.ok) setModels(modelResult.result)
    if (artifactResult.ok) setArtifacts(artifactResult.result)
    if (phaseResult.ok) setPhases(phaseResult.result)
  }, [])

  useEffect(() => {
    void refresh()
    return onBackendEvent((event) => {
      if (
        [
          'source.imported',
          'source.updated',
          'extraction.completed',
          'extracted.updated',
          'intermediate.updated',
          'design_model.updated'
        ].includes(event)
      )
        void refresh()
    })
  }, [refresh])

  const changeSort = (key: string): void =>
    setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' }))
  const mutate = async (method: string, params: Record<string, unknown>, message: string): Promise<void> => {
    const result = await invoke(method, params)
    if (!result.ok) {
      notify('error', message, result.error.message)
      return
    }
    notify('info', message)
    setSelectedUid(null)
    await refresh()
    await refreshStats()
  }
  const confirmDelete = (kind: 'document' | 'extracted', uid: string, name: string): void => {
    if (
      !window.confirm(
        `${name}を削除しますか？\n通常削除のためデータは論理削除され、一覧とExplorerから非表示になります。`
      )
    )
      return
    void mutate(`${kind}.delete`, { uid }, `${name}を削除しました`)
  }

  const sourceRows = useMemo(() => sortedRows(sources, sort), [sort, sources])
  const extractedRows = useMemo(() => sortedRows(extracted, sort), [extracted, sort])
  const modelRows = useMemo(() => sortedRows(models, sort), [models, sort])
  const selectedSource = sources.find((row) => row.uid === selectedUid)

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
                ? intermediates.length
                : models.length}
          件
        </span>
      </header>
      <div className={`stage-overview-body ${stage === 'design' ? 'single' : ''}`}>
        <div className="stage-list-pane">
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
                    onClick={() => setSelectedUid(row.uid)}
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
                            row.is_archived ? 'アーカイブを解除しました' : 'アーカイブしました'
                          )
                        }}
                      >
                        {row.is_archived ? '解除' : 'アーカイブ'}
                      </button>
                      <button
                        className="d2d-btn small danger"
                        onClick={(event) => {
                          event.stopPropagation()
                          confirmDelete('document', row.uid, row.file_name)
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
                    onClick={() => setSelectedUid(row.uid)}
                    onDoubleClick={() =>
                      openResource(`extracted://${row.uid}`, `抽出: ${row.title ?? row.code}`, { preview: true })
                    }
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
                            row.is_archived ? 'アーカイブを解除しました' : 'アーカイブしました'
                          )
                        }}
                      >
                        {row.is_archived ? '解除' : 'アーカイブ'}
                      </button>
                      <button
                        className="d2d-btn small danger"
                        onClick={(event) => {
                          event.stopPropagation()
                          confirmDelete('extracted', row.uid, row.title ?? row.code)
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
              sort={sort}
              onSort={changeSort}
              selectedUid={selectedUid}
              onSelect={setSelectedUid}
            />
          )}
          {stage === 'design' && (
            <table className="d2d-table stage-table">
              <thead>
                <tr>
                  <SortHeader label="分類" column="design_category" sort={sort} onSort={changeSort} />
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
                    onDoubleClick={() => openResource(`design://${row.uid}`, row.code, { preview: true })}
                    data-testid={`stage-design-row-${row.code}`}
                  >
                    <td>{row.design_category}</td>
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
                <button
                  className="d2d-btn primary"
                  data-testid="source-open-external"
                  onClick={() =>
                    void invoke('document.openExternal', { uid: selectedSource.uid }).then((result) => {
                      if (!result.ok) notify('error', '原本を開けませんでした', result.error.message)
                    })
                  }
                >
                  OSアプリで開く
                </button>
              </div>
            )}
            {stage === 'extracted' && selectedUid && <DocumentPreview uid={selectedUid} kind="extracted" />}
            {stage === 'intermediate' && selectedUid && <DocumentPreview uid={selectedUid} kind="intermediate" />}
          </aside>
        )}
      </div>
    </div>
  )
}

function IntermediateHierarchy({
  rows,
  phases,
  artifacts,
  sort,
  onSort,
  selectedUid,
  onSelect
}: {
  rows: IntermediateDocumentItem[]
  phases: DevPhaseSetting[]
  artifacts: ArtifactSetting[]
  sort: SortState
  onSort: (key: string) => void
  selectedUid: string | null
  onSelect: (uid: string) => void
}): React.JSX.Element {
  return (
    <div data-testid="stage-intermediate-hierarchy">
      {[...phases]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((phase) => {
          const phaseRows = sortedRows(
            rows.filter((row) => row.dev_phase_id === phase.dev_phase_id),
            sort
          )
          if (phaseRows.length === 0) return null
          return (
            <section key={phase.uid} className="stage-phase-group">
              <h2>{phase.dev_phase_name}</h2>
              <table className="d2d-table stage-table">
                <thead>
                  <tr>
                    <SortHeader label="状態" column="status" sort={sort} onSort={onSort} />
                    <SortHeader label="成果物" column="artifact_type_id" sort={sort} onSort={onSort} />
                    <SortHeader label="ID" column="code" sort={sort} onSort={onSort} />
                    <SortHeader label="要素数" column="item_count" sort={sort} onSort={onSort} />
                    <SortHeader label="未確定" column="unconfirmed_count" sort={sort} onSort={onSort} />
                  </tr>
                </thead>
                <tbody>
                  {phaseRows.map((row) => {
                    const artifact = artifacts.find(
                      (item) => item.dev_phase_id === row.dev_phase_id && item.artifact_type_id === row.artifact_type_id
                    )
                    return (
                      <tr
                        key={row.uid}
                        className={selectedUid === row.uid ? 'selected' : ''}
                        onClick={() => onSelect(row.uid)}
                        data-testid={`stage-intermediate-row-${row.code}`}
                      >
                        <td>
                          <ReviewStatusBadge status={reviewStateFromEntityStatus(row.status)} />
                        </td>
                        <td>{artifact?.artifact_name ?? row.artifact_type_id}</td>
                        <td>{row.code}</td>
                        <td>{row.item_count}</td>
                        <td>{row.unconfirmed_count}</td>
                      </tr>
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
