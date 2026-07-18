/**
 * Explorer の ①原本 / ②抽出データ ツリー（P4-2 / P5-15、UI-010/011）。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  SerendieSymbolArticle,
  SerendieSymbolData,
  SerendieSymbolFile,
  SerendieSymbolFileText,
  SerendieSymbolFolderFilled
} from '@serendie/symbols'
import { invoke, onBackendEvent } from '../../services/backend'
import { executeCommand } from '../../services/command-registry'
import { importSourceDocuments } from '../../services/source-import'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { showContextMenu } from '../common/ContextMenu'
import { IntermediateImportDialog } from '../editors/IntermediateImportDialog'
import { DesignModelTree } from './DesignModelViews'
import { useExplorerTreeKeyboard } from './useExplorerTreeKeyboard'

export interface SourceDocumentItem {
  uid: string
  code: string
  title: string | null
  file_name: string
  file_type: string
  file_hash: string
  status: string
  is_archived: number
  is_current: number
  imported_at: string
  has_extracted_data: number
}

export interface ExtractedDocumentItem {
  uid: string
  code: string
  title: string | null
  status: string
  is_archived: number
  extraction_status: string
  extractor_name: string
  extractor_version: string
  extracted_at: string
  item_count: number
  unconfirmed_count: number
  source_document_uid: string
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
  is_active: number
}

export interface IntermediateDocumentItem {
  uid: string
  code: string
  title: string | null
  status: string
  is_archived: number
  intermediate_status: string
  generated_at: string
  artifact_type_id: string
  dev_phase_id: string
  item_count: number
  unconfirmed_count: number
  sources?: { extracted_document_uid: string; order: number }[]
}

function ExplorerFolderIcon(): React.JSX.Element {
  return <SerendieSymbolFolderFilled width={16} height={16} className="d2d-explorer-folder-icon" />
}

function ExplorerResourceIcon({
  kind
}: {
  kind: 'original' | 'extracted' | 'intermediate' | 'source'
}): React.JSX.Element {
  const Icon =
    kind === 'original'
      ? SerendieSymbolFile
      : kind === 'extracted'
        ? SerendieSymbolData
        : kind === 'intermediate'
          ? SerendieSymbolArticle
          : SerendieSymbolFileText
  return <Icon width={15} height={15} className={`d2d-explorer-resource-icon is-${kind}`} />
}

export function DocumentsTree({ projectName }: { projectName: string }): React.JSX.Element {
  const [sources, setSources] = useState<SourceDocumentItem[]>([])
  const [extracted, setExtracted] = useState<ExtractedDocumentItem[]>([])
  const [intermediates, setIntermediates] = useState<IntermediateDocumentItem[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactSetting[]>([])
  const [phases, setPhases] = useState<DevPhaseSetting[]>([])
  const [importArtifactUid, setImportArtifactUid] = useState<string | null | undefined>(undefined)
  const { treeRef, expandAll, collapseAll } = useExplorerTreeKeyboard()
  const openResource = useEditorStore((state) => state.openResource)
  const notify = useJobsStore((state) => state.notify)
  const extractedUnconfirmed = extracted.reduce((total, document) => total + document.unconfirmed_count, 0)
  const intermediateUnconfirmed = intermediates.reduce((total, document) => total + document.unconfirmed_count, 0)

  const refresh = useCallback(async () => {
    const [docs, exts, mids, arts, devs] = await Promise.all([
      invoke<SourceDocumentItem[]>('document.list'),
      invoke<ExtractedDocumentItem[]>('extracted.list'),
      invoke<IntermediateDocumentItem[]>('intermediate.list'),
      invoke<ArtifactSetting[]>('project.listArtifactSettings'),
      invoke<DevPhaseSetting[]>('project.listDevPhases')
    ])
    if (docs.ok) setSources(docs.result)
    if (exts.ok) setExtracted(exts.result)
    if (mids.ok) setIntermediates(mids.result)
    if (arts.ok) setArtifacts(arts.result)
    if (devs.ok) setPhases(devs.result)
  }, [])

  const openArtifact = async (artifact: ArtifactSetting): Promise<void> => {
    const result = await invoke<{ intermediateDocumentUid: string }>('intermediate.ensureArtifact', {
      artifactUid: artifact.uid
    })
    if (!result.ok) {
      notify('error', '中間データを開けませんでした', result.error.message)
      return
    }
    await refresh()
    openResource(`intermediate://${result.result.intermediateDocumentUid}`, `③: ${artifact.artifact_name}`, {
      preview: true
    })
  }

  useEffect(() => {
    void refresh()
    return onBackendEvent((event) => {
      if (
        [
          'source.imported',
          'source.updated',
          'artifact.updated',
          'extraction.completed',
          'extracted.renamed',
          'extracted.updated',
          'intermediate.updated',
          'job.updated'
        ].includes(event)
      )
        void refresh()
    })
  }, [refresh])

  return (
    <div ref={treeRef} role="tree" tabIndex={0} aria-label="プロジェクトExplorer" data-testid="documents-tree">
      <details open className="d2d-explorer-root" data-testid="explorer-project-tree">
        <summary className="d2d-explorer-root-header" role="treeitem" tabIndex={-1} data-explorer-treeitem>
          <ExplorerFolderIcon />
          <button
            type="button"
            className="d2d-explorer-project-name"
            data-tree-action
            data-testid="explorer-project-row"
            title="プロジェクトのダッシュボードを開く"
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              void executeCommand('resource.open', { uri: 'project://current', title: 'ダッシュボード' })
            }}
          >
            {projectName}
          </button>
          <span className="d2d-explorer-tree-actions">
            <button
              type="button"
              data-testid="explorer-expand-all"
              aria-label="Treeをすべて展開"
              title="Explorer Treeをすべて展開します"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                expandAll()
              }}
            >
              ⊞
            </button>
            <button
              type="button"
              data-testid="explorer-collapse-all"
              aria-label="Treeをすべて折りたたむ"
              title="Explorer Treeをルート以外すべて折りたたみます"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                collapseAll()
              }}
            >
              ⊟
            </button>
          </span>
        </summary>
        <div className="d2d-explorer-root-children" role="group">
          <details open className="d2d-explorer-section" data-testid="explorer-section-original">
            <summary
              className="d2d-explorer-section-header"
              role="treeitem"
              tabIndex={-1}
              data-explorer-treeitem
              onContextMenu={(event) =>
                showContextMenu(event, [
                  {
                    label: '取込',
                    testId: 'ctx-original-import',
                    run: () => void importSourceDocuments(notify).then(() => refresh())
                  }
                ])
              }
            >
              <ExplorerFolderIcon />
              <span className="d2d-explorer-section-title">①原本</span>
              <span className="d2d-explorer-section-count">{sources.length}</span>
            </summary>
            {sources.map((doc) => (
              <div
                key={doc.uid}
                className="d2d-list-row"
                role="treeitem"
                tabIndex={-1}
                data-explorer-treeitem
                data-testid={`source-doc-${doc.code}`}
                title={`名称: ${doc.file_name}\nID: ${doc.code}\n形式: ${doc.file_type}\n状態: ${doc.status}\nSHA-256: ${doc.file_hash}\n取込日時: ${doc.imported_at}`}
                onClick={() => openResource(`original://${doc.uid}`, doc.file_name, { preview: true })}
                onContextMenu={(event) =>
                  showContextMenu(event, [
                    {
                      label: '開く',
                      testId: 'ctx-original-open',
                      run: () => openResource(`original://${doc.uid}`, doc.file_name)
                    },
                    {
                      label: 'OSアプリで開く',
                      run: async () => {
                        const result = await invoke('document.openExternal', { uid: doc.uid })
                        if (!result.ok) notify('error', 'OSアプリで開けませんでした', result.error.message)
                      }
                    }
                  ])
                }
              >
                <ExplorerResourceIcon kind="original" />
                <span className="d2d-explorer-resource-name">{doc.file_name}</span>
                <span className="d2d-explorer-tags">
                  <span className="d2d-explorer-tag">{doc.file_type}</span>
                  {doc.is_current === 0 && <span className="d2d-explorer-tag muted">旧版</span>}
                </span>
              </div>
            ))}
          </details>

          <details open className="d2d-explorer-section" data-testid="explorer-section-extracted">
            <summary className="d2d-explorer-section-header" role="treeitem" tabIndex={-1} data-explorer-treeitem>
              <ExplorerFolderIcon />
              <span className="d2d-explorer-section-title">②抽出データ</span>
              <span className="d2d-explorer-section-count">{extracted.length}</span>
              <span
                className={`d2d-unconfirmed-badge ${extractedUnconfirmed === 0 ? 'is-zero' : ''}`}
                data-testid="extracted-unconfirmed-badge"
                title="正本確定していない抽出要素数"
              >
                未確定 {extractedUnconfirmed}
              </span>
            </summary>
            <p className="d2d-explorer-hint">編集する場合は、対象の抽出データを選択してください。</p>
            {extracted.map((doc) => (
              <div
                key={doc.uid}
                className="d2d-list-row"
                role="treeitem"
                tabIndex={-1}
                data-explorer-treeitem
                data-testid={`extracted-doc-${doc.code}`}
                title={`名称: ${doc.title ?? doc.code}\nID: ${doc.code}\n状態: ${doc.status} / ${doc.extraction_status}\n抽出器: ${doc.extractor_name} ${doc.extractor_version}\n要素数: ${doc.item_count}\n未確定: ${doc.unconfirmed_count}\n抽出日時: ${doc.extracted_at}`}
                onClick={() =>
                  openResource(`extracted://${doc.uid}`, `抽出: ${doc.title ?? doc.code}`, { preview: true })
                }
                onContextMenu={(event) =>
                  showContextMenu(event, [
                    {
                      label: '開く',
                      testId: 'ctx-extracted-open',
                      run: () => openResource(`extracted://${doc.uid}`, `抽出: ${doc.title ?? doc.code}`)
                    }
                  ])
                }
              >
                <ExplorerResourceIcon kind="extracted" />
                <span className="d2d-explorer-resource-name">{doc.title ?? doc.code}</span>
                <span className="d2d-explorer-tags">
                  <ReviewStatusBadge status={reviewStateFromEntityStatus(doc.status)} />
                  <span
                    className={`d2d-unconfirmed-badge ${doc.unconfirmed_count === 0 ? 'is-zero' : ''}`}
                    data-testid={`extracted-unconfirmed-${doc.code}`}
                  >
                    未確定 {doc.unconfirmed_count}
                  </span>
                  <span className="d2d-explorer-tag muted">{doc.item_count}要素</span>
                </span>
              </div>
            ))}
          </details>

          <details open className="d2d-explorer-section" data-testid="explorer-section-intermediate">
            <summary
              className="d2d-explorer-section-header"
              role="treeitem"
              tabIndex={-1}
              data-explorer-treeitem
              onContextMenu={(event) =>
                showContextMenu(event, [
                  {
                    label: '中間データへ取込',
                    testId: 'ctx-intermediate-import',
                    run: () => setImportArtifactUid(null)
                  }
                ])
              }
            >
              <ExplorerFolderIcon />
              <span className="d2d-explorer-section-title">③中間データ</span>
              <span className="d2d-explorer-section-count">
                {artifacts.filter((artifact) => artifact.is_active === 1 && artifact.dev_phase_id).length}
              </span>
              <span
                className={`d2d-unconfirmed-badge ${intermediateUnconfirmed === 0 ? 'is-zero' : ''}`}
                data-testid="intermediate-unconfirmed-badge"
                title="正本確定していない中間要素数"
              >
                未確定 {intermediateUnconfirmed}
              </span>
            </summary>
            {phases
              .filter((phase) => phase.is_active === 1)
              .map((phase) => (
                <details
                  open
                  key={phase.uid}
                  className="d2d-explorer-phase"
                  data-testid={`phase-${phase.dev_phase_id}`}
                >
                  <summary className="d2d-explorer-phase-label" role="treeitem" tabIndex={-1} data-explorer-treeitem>
                    <ExplorerFolderIcon />
                    <span>{phase.dev_phase_name}</span>
                    <span className="d2d-explorer-tag muted">フェーズ</span>
                  </summary>
                  {artifacts
                    .filter((artifact) => artifact.is_active === 1 && artifact.dev_phase_id === phase.dev_phase_id)
                    .map((artifact) => {
                      const doc = intermediates.find(
                        (item) =>
                          item.dev_phase_id === phase.dev_phase_id &&
                          item.artifact_type_id === artifact.artifact_type_id
                      )
                      const sourceIds = doc?.sources?.map((source) => source.extracted_document_uid) ?? []
                      const tooltip = doc
                        ? `名称: ${artifact.artifact_name}\nID: ${doc.code}\n状態: ${doc.status} / ${doc.intermediate_status}\n開発フェーズ: ${phase.dev_phase_name}\n成果物: ${artifact.artifact_name}\n要素数: ${doc.item_count}\n未確定: ${doc.unconfirmed_count}\n統合元: ${sourceIds.length}件\n生成日時: ${doc.generated_at}`
                        : `名称: ${artifact.artifact_name}\n開発フェーズ: ${phase.dev_phase_name}\n成果物種別: ${artifact.artifact_type_id}\n状態: 未作成`
                      const artifactTestId = doc
                        ? `intermediate-doc-${doc.code}`
                        : `artifact-slot-${phase.dev_phase_id}-${artifact.artifact_type_id}`
                      return (
                        <details
                          open
                          key={artifact.uid}
                          className={`d2d-explorer-artifact-node ${sourceIds.length === 0 ? 'has-no-sources' : ''}`}
                        >
                          <summary
                            className="d2d-list-row d2d-explorer-artifact-row"
                            role="treeitem"
                            tabIndex={-1}
                            data-explorer-treeitem
                            title={tooltip}
                            onContextMenu={(event) =>
                              showContextMenu(event, [
                                {
                                  label: '取込',
                                  testId: 'ctx-artifact-import',
                                  run: () => setImportArtifactUid(artifact.uid)
                                }
                              ])
                            }
                          >
                            <button
                              type="button"
                              className="d2d-explorer-item-action"
                              data-tree-action
                              data-testid={artifactTestId}
                              title={tooltip}
                              onClick={(event) => {
                                event.preventDefault()
                                event.stopPropagation()
                                void openArtifact(artifact)
                              }}
                            >
                              <ExplorerResourceIcon kind="intermediate" />
                              <span className="d2d-explorer-resource-name">{artifact.artifact_name}</span>
                              <span className="d2d-explorer-tags">
                                <ReviewStatusBadge status={reviewStateFromEntityStatus(doc?.status ?? 'draft')} />
                                <span
                                  className={`d2d-unconfirmed-badge ${!doc || doc.unconfirmed_count === 0 ? 'is-zero' : ''}`}
                                  data-testid={doc ? `intermediate-unconfirmed-${doc.code}` : undefined}
                                >
                                  未確定 {doc?.unconfirmed_count ?? 0}
                                </span>
                                <span className="d2d-explorer-tag muted">{doc?.item_count ?? 0}要素</span>
                              </span>
                            </button>
                          </summary>
                          {sourceIds.length > 0 && (
                            <div className="d2d-explorer-sources" role="group">
                              {sourceIds.map((id) => (
                                <span
                                  key={id}
                                  className="d2d-explorer-source-row"
                                  role="treeitem"
                                  tabIndex={-1}
                                  data-explorer-treeitem
                                >
                                  <ExplorerResourceIcon kind="source" />
                                  <span className="d2d-explorer-resource-name">
                                    {extracted.find((item) => item.uid === id)?.title ?? id}
                                  </span>
                                  <span className="d2d-explorer-tag muted">取込元</span>
                                </span>
                              ))}
                            </div>
                          )}
                        </details>
                      )
                    })}
                </details>
              ))}
          </details>
          <DesignModelTree />
        </div>
      </details>
      {importArtifactUid !== undefined && (
        <IntermediateImportDialog
          initialArtifactUid={importArtifactUid ?? undefined}
          onClose={() => setImportArtifactUid(undefined)}
          onSaved={refresh}
        />
      )}
    </div>
  )
}

/** 原本の共通操作（P4-2 / P5、UI-010 / UI-046）。選択経路によらず同じ操作を提示する。 */
export function OriginalActions({ doc }: { doc: SourceDocumentItem }): React.JSX.Element {
  const notify = useJobsStore((s) => s.notify)

  const openExternal = async (): Promise<void> => {
    const result = await invoke('document.openExternal', { uid: doc.uid })
    if (!result.ok) notify('error', '原本を開けませんでした', result.error.message)
  }

  const extract = async (): Promise<void> => {
    const res = await invoke('document.extract', { uid: doc.uid })
    if (res.ok) {
      notify('info', '抽出ジョブを開始しました')
      void executeCommand('job.openPanel')
    } else {
      notify('error', '抽出を開始できませんでした', res.error.message)
    }
  }

  return (
    <div className="stage-actions" style={{ marginTop: 12 }}>
      <button type="button" className="d2d-btn" onClick={() => void openExternal()} data-testid="source-open-external">
        OSアプリで開く
      </button>
      <button
        type="button"
        className="d2d-btn primary"
        onClick={() => void extract()}
        disabled={doc.file_type !== 'word' || Boolean(doc.has_extracted_data)}
        data-testid="extract-button"
        title={doc.has_extracted_data ? 'この原本の抽出データは既に存在します' : undefined}
      >
        ②抽出データの生成（{doc.file_type === 'word' ? '抽出ジョブ実行' : `${doc.file_type} は P5 後続対応`}）
      </button>
    </div>
  )
}

/** 原本ビュー（V-01）。プレビューと原本共通操作の起点 */
export function OriginalViewer({ uid }: { uid: string }): React.JSX.Element {
  const [doc, setDoc] = useState<(SourceDocumentItem & { file_hash: string; imported_at: string }) | null>(null)

  useEffect(() => {
    const refresh = (): void => {
      void invoke<SourceDocumentItem & { file_hash: string; imported_at: string }>('document.get', { uid }).then(
        (res) => {
          if (res.ok) setDoc(res.result)
        }
      )
    }
    refresh()
    return onBackendEvent((event) => {
      if (['artifact.updated', 'extraction.completed', 'extracted.updated', 'job.updated'].includes(event)) refresh()
    })
  }, [uid])

  if (!doc) return <div className="d2d-empty">読込中…</div>

  return (
    <div style={{ padding: 20 }} data-testid="original-viewer">
      <h1 style={{ fontSize: 16, marginTop: 0 }}>{doc.file_name}</h1>
      <dl className="d2d-kv" style={{ padding: 0 }}>
        <dt>表示コード</dt>
        <dd>{doc.code}</dd>
        <dt>形式</dt>
        <dd>{doc.file_type}</dd>
        <dt>SHA-256</dt>
        <dd style={{ fontFamily: 'monospace', fontSize: 11 }}>{doc.file_hash}</dd>
        <dt>取込日時</dt>
        <dd>{doc.imported_at}</dd>
      </dl>
      <OriginalActions doc={doc} />
      <p style={{ color: 'var(--d2d-fg-muted)', marginTop: 16, fontSize: 11.5 }}>
        原本は blobs/originals/ に無改変で保管されています（IMP-009）。
      </p>
    </div>
  )
}
