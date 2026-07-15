/**
 * Explorer の ①原本 / ②抽出データ ツリー（P4-2 / P5-15、UI-010/011）。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { executeCommand } from '../../services/command-registry'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'
import { DesignModelTree } from './DesignModelViews'

export interface SourceDocumentItem {
  uid: string
  code: string
  title: string | null
  file_name: string
  file_type: string
  file_hash: string
  status: string
  is_current: number
  imported_at: string
}

export interface ExtractedDocumentItem {
  uid: string
  code: string
  title: string | null
  status: string
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
  intermediate_status: string
  generated_at: string
  artifact_type_id: string
  dev_phase_id: string
  item_count: number
  unconfirmed_count: number
  sources?: { extracted_document_uid: string; order: number }[]
}

export function DocumentsTree(): React.JSX.Element {
  const [sources, setSources] = useState<SourceDocumentItem[]>([])
  const [extracted, setExtracted] = useState<ExtractedDocumentItem[]>([])
  const [intermediates, setIntermediates] = useState<IntermediateDocumentItem[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactSetting[]>([])
  const [phases, setPhases] = useState<DevPhaseSetting[]>([])
  const [importDialogOpen, setImportDialogOpen] = useState(false)
  const [selectedArtifactUid, setSelectedArtifactUid] = useState<string | null>(null)
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const [renamingExtractedUid, setRenamingExtractedUid] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const openResource = useEditorStore((s) => s.openResource)
  const notify = useJobsStore((s) => s.notify)
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

  useEffect(() => {
    void refresh()
    return onBackendEvent((event) => {
      if (
        [
          'source.imported',
          'artifact.updated',
          'extraction.completed',
          'extracted.renamed',
          'intermediate.updated',
          'job.updated'
        ].includes(event)
      ) {
        void refresh()
      }
    })
  }, [refresh])

  const importDocument = async (): Promise<void> => {
    const filePaths = await window.api.showOpenFilesDialog({
      title: '取込む原本ファイルを選択（複数選択可）',
      filters: [
        {
          name: '対象文書',
          extensions: ['docx', 'xlsx', 'pptx', 'vsdx', 'pdf', 'txt', 'md', 'csv', 'tsv', 'json', 'jsonl', 'yaml']
        }
      ]
    })
    if (filePaths.length === 0) return
    const results = await Promise.all(filePaths.map((filePath) => invoke('document.import', { filePath })))
    const failed = results.filter((result) => !result.ok)
    if (failed.length > 0) {
      notify('error', `${failed.length}件の取込Jobを登録できませんでした`)
      return
    }
    notify('info', `${filePaths.length}件の原本取込Jobを登録しました`)
  }

  const saveExtractedName = async (doc: ExtractedDocumentItem): Promise<void> => {
    const title = renameValue.trim()
    if (!title) {
      notify('error', '抽出データの名称を入力してください')
      return
    }
    const result = await invoke<{ title: string }>('extracted.rename', { uid: doc.uid, title })
    if (!result.ok) {
      notify('error', '抽出データの名称を変更できませんでした', result.error.message)
      return
    }
    setRenamingExtractedUid(null)
    notify('info', '抽出データの名称を変更しました')
    await refresh()
  }

  return (
    <div data-testid="documents-tree">
      <details open className="d2d-explorer-section" data-testid="explorer-section-original">
        <summary className="d2d-explorer-section-header">
          <span className="d2d-explorer-section-title">①原本</span>
          <span className="d2d-explorer-section-count">{sources.length}</span>
          <span className="d2d-explorer-section-actions">
            <button
              type="button"
              className="d2d-btn small"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void importDocument()
              }}
              data-testid="import-button"
              title="複数ファイルを選択し、ファイルごとの取込Jobとして登録"
            >
              取込…
            </button>
          </span>
        </summary>
        {sources.map((doc) => (
          <div
            key={doc.uid}
            className="d2d-list-row"
            data-testid={`source-doc-${doc.code}`}
            title={`名称: ${doc.file_name}\nID: ${doc.code}\n形式: ${doc.file_type}\n状態: ${doc.status}\nSHA-256: ${doc.file_hash}\n取込日時: ${doc.imported_at}`}
            onClick={() => openResource(`original://${doc.uid}`, doc.file_name, { preview: true })}
          >
            <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{doc.file_type}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.file_name}</span>
            {doc.is_current === 0 && <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 10 }}>旧版</span>}
          </div>
        ))}
      </details>

      <details open className="d2d-explorer-section" data-testid="explorer-section-extracted">
        <summary className="d2d-explorer-section-header">
          <span className="d2d-explorer-section-title">②抽出データ</span>
          <span style={{ color: 'var(--d2d-fg-muted)' }}>{extracted.length}</span>
          <span
            className={`d2d-unconfirmed-badge ${extractedUnconfirmed === 0 ? 'is-zero' : ''}`}
            data-testid="extracted-unconfirmed-badge"
            title="正本確定していない抽出要素数"
          >
            未確定 {extractedUnconfirmed}
          </span>
        </summary>
        {extracted.map((doc) => (
          <div
            key={doc.uid}
            className="d2d-list-row"
            data-testid={`extracted-doc-${doc.code}`}
            title={`名称: ${doc.title ?? doc.code}\nID: ${doc.code}\n状態: ${doc.status} / ${doc.extraction_status}\n抽出器: ${doc.extractor_name} ${doc.extractor_version}\n要素数: ${doc.item_count}\n未確定: ${doc.unconfirmed_count}\n抽出日時: ${doc.extracted_at}`}
            onClick={() => openResource(`extracted://${doc.uid}`, `抽出: ${doc.title ?? doc.code}`, { preview: true })}
          >
            <ReviewStatusBadge status={reviewStateFromEntityStatus(doc.status)} />
            {renamingExtractedUid === doc.uid ? (
              <input
                className="d2d-explorer-rename-input"
                data-testid={`rename-extracted-input-${doc.code}`}
                autoFocus
                value={renameValue}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setRenameValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void saveExtractedName(doc)
                  } else if (event.key === 'Escape') {
                    setRenamingExtractedUid(null)
                  }
                }}
              />
            ) : (
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.title ?? doc.code}</span>
            )}
            {renamingExtractedUid !== doc.uid && (
              <button
                type="button"
                className="d2d-icon-btn"
                data-testid={`rename-extracted-${doc.code}`}
                title="抽出データの名称を変更"
                aria-label="抽出データの名称を変更"
                onClick={(event) => {
                  event.stopPropagation()
                  setRenamingExtractedUid(doc.uid)
                  setRenameValue(doc.title ?? doc.code)
                }}
              >
                ✎
              </button>
            )}
            <span
              className={`d2d-unconfirmed-badge ${doc.unconfirmed_count === 0 ? 'is-zero' : ''}`}
              data-testid={`extracted-unconfirmed-${doc.code}`}
            >
              未確定 {doc.unconfirmed_count}
            </span>
            <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{doc.item_count}要素</span>
          </div>
        ))}
      </details>

      <details open className="d2d-explorer-section" data-testid="explorer-section-intermediate">
        <summary className="d2d-explorer-section-header">
          <span className="d2d-explorer-section-title">③中間データ</span>
          <span className="d2d-explorer-section-count">{intermediates.length}</span>
          <span
            className={`d2d-unconfirmed-badge ${intermediateUnconfirmed === 0 ? 'is-zero' : ''}`}
            data-testid="intermediate-unconfirmed-badge"
            title="正本確定していない中間要素数"
          >
            未確定 {intermediateUnconfirmed}
          </span>
          <span className="d2d-explorer-section-actions">
            <button
              type="button"
              className="d2d-btn small"
              data-testid="intermediate-import-button"
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                setSelectedArtifactUid(null)
                setSelectedSources(new Set())
                setImportDialogOpen(true)
              }}
            >
              取込
            </button>
          </span>
        </summary>
        {phases
          .filter((p) => p.is_active === 1)
          .map((phase) => (
            <div key={phase.uid} data-testid={`phase-${phase.dev_phase_id}`}>
              <div style={{ padding: '5px 4px 2px', fontWeight: 600 }}>▾ {phase.dev_phase_name}</div>
              {artifacts
                .filter((a) => a.is_active === 1 && a.dev_phase_id === phase.dev_phase_id)
                .map((artifact) => {
                  const doc = intermediates.find(
                    (m) => m.dev_phase_id === phase.dev_phase_id && m.artifact_type_id === artifact.artifact_type_id
                  )
                  const sourceIds = doc?.sources?.map((x) => x.extracted_document_uid) ?? []
                  const tooltip = doc
                    ? `名称: ${doc.title ?? artifact.artifact_name}\nID: ${doc.code}\n状態: ${doc.status} / ${doc.intermediate_status}\n開発フェーズ: ${phase.dev_phase_name}\n成果物: ${artifact.artifact_name}\n要素数: ${doc.item_count}\n未確定: ${doc.unconfirmed_count}\n統合元: ${sourceIds.length}件\n生成日時: ${doc.generated_at}`
                    : `名称: ${artifact.artifact_name}\n開発フェーズ: ${phase.dev_phase_name}\n成果物種別: ${artifact.artifact_type_id}\n状態: 未作成`
                  return (
                    <div
                      key={artifact.uid}
                      data-testid={
                        doc
                          ? `intermediate-doc-${doc.code}`
                          : `artifact-slot-${phase.dev_phase_id}-${artifact.artifact_type_id}`
                      }
                      title={tooltip}
                      style={{ paddingLeft: 14, marginBottom: 3 }}
                    >
                      <div
                        className="d2d-list-row"
                        style={{ paddingLeft: 0, alignItems: 'center' }}
                        onClick={() =>
                          doc &&
                          openResource(`intermediate://${doc.uid}`, `③: ${doc.title ?? artifact.artifact_name}`, {
                            preview: true
                          })
                        }
                      >
                        {doc && <ReviewStatusBadge status={reviewStateFromEntityStatus(doc.status)} />}
                        <span style={{ flex: 1, minWidth: 0, fontWeight: 500 }}>{artifact.artifact_name}</span>
                        {doc && (
                          <span
                            className={`d2d-unconfirmed-badge ${doc.unconfirmed_count === 0 ? 'is-zero' : ''}`}
                            data-testid={`intermediate-unconfirmed-${doc.code}`}
                          >
                            未確定 {doc.unconfirmed_count}
                          </span>
                        )}
                        {doc && (
                          <button
                            type="button"
                            className="d2d-btn small"
                            data-testid={`chunks-${doc.code}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              openResource(`chunk://${doc.uid}`, `チャンク: ${doc.title ?? artifact.artifact_name}`, {
                                preview: false
                              })
                            }}
                          >
                            チャンク
                          </button>
                        )}
                      </div>
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          padding: '1px 4px 3px 24px',
                          color: 'var(--d2d-fg-muted)',
                          fontSize: 11,
                          overflowWrap: 'anywhere'
                        }}
                      >
                        {sourceIds.length === 0 ? (
                          <span>↳ 統合元未選択</span>
                        ) : (
                          sourceIds.map((id) => (
                            <span key={id}>↳ {extracted.find((x) => x.uid === id)?.title ?? id}</span>
                          ))
                        )}
                      </div>
                    </div>
                  )
                })}
            </div>
          ))}
      </details>
      {importDialogOpen && (
        <div
          role="dialog"
          data-testid="intermediate-source-dialog"
          style={{
            position: 'fixed',
            inset: '12% 20%',
            zIndex: 20,
            background: 'var(--d2d-surface-raised)',
            color: 'var(--d2d-fg)',
            border: '1px solid var(--d2d-border)',
            borderRadius: 'var(--d2d-radius)',
            padding: 16,
            boxShadow: '0 8px 30px #0008',
            overflow: 'auto'
          }}
        >
          <h3 style={{ marginTop: 0 }}>③中間データへ取込</h3>
          <section data-testid="intermediate-import-targets">
            <b>取込先（③中間データの成果物・1件選択）</b>
            {phases
              .filter((phase) => phase.is_active === 1)
              .flatMap((phase) =>
                artifacts
                  .filter((artifact) => artifact.is_active === 1 && artifact.dev_phase_id === phase.dev_phase_id)
                  .map((artifact) => {
                    const checked = selectedArtifactUid === artifact.uid
                    return (
                      <label key={artifact.uid} style={{ display: 'block', padding: 6 }}>
                        <input
                          type="checkbox"
                          data-testid={`intermediate-target-${phase.dev_phase_id}-${artifact.artifact_type_id}`}
                          checked={checked}
                          onChange={(event) => {
                            if (!event.target.checked) {
                              setSelectedArtifactUid(null)
                              setSelectedSources(new Set())
                              return
                            }
                            const existing = intermediates.find(
                              (doc) =>
                                doc.dev_phase_id === phase.dev_phase_id &&
                                doc.artifact_type_id === artifact.artifact_type_id
                            )
                            setSelectedArtifactUid(artifact.uid)
                            setSelectedSources(
                              new Set(existing?.sources?.map((source) => source.extracted_document_uid) ?? [])
                            )
                          }}
                        />{' '}
                        {phase.dev_phase_name} / {artifact.artifact_name}
                      </label>
                    )
                  })
              )}
          </section>
          <section data-testid="intermediate-import-sources" style={{ marginTop: 12 }}>
            <b>取込元（②抽出データ・複数選択可）</b>
            {extracted
              .filter((item) => item.status === 'approved')
              .map((item) => (
                <label key={item.uid} style={{ display: 'block', padding: 6 }}>
                  <input
                    type="checkbox"
                    data-testid={`intermediate-source-${item.code}`}
                    disabled={!selectedArtifactUid}
                    checked={selectedSources.has(item.uid)}
                    onChange={(event) =>
                      setSelectedSources((current) => {
                        const next = new Set(current)
                        if (event.target.checked) next.add(item.uid)
                        else next.delete(item.uid)
                        return next
                      })
                    }
                  />{' '}
                  {item.title ?? item.code}
                </label>
              ))}
          </section>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
            <button className="d2d-btn" onClick={() => setImportDialogOpen(false)}>
              キャンセル
            </button>
            <button
              className="d2d-btn primary"
              disabled={!selectedArtifactUid || selectedSources.size === 0}
              onClick={() => void saveArtifactSources()}
            >
              選択して取込
            </button>
          </div>
        </div>
      )}
      <DesignModelTree />
    </div>
  )

  async function saveArtifactSources(): Promise<void> {
    const artifact = artifacts.find((item) => item.uid === selectedArtifactUid)
    const phase = artifact ? phases.find((item) => item.dev_phase_id === artifact.dev_phase_id) : undefined
    if (!artifact || !phase || selectedSources.size === 0) return

    const existing = intermediates.find(
      (doc) => doc.dev_phase_id === phase.dev_phase_id && doc.artifact_type_id === artifact.artifact_type_id
    )
    const res = existing
      ? await invoke<{ sourceCount: number }>('intermediate.updateSources', {
          uid: existing.uid,
          extractedDocumentUids: [...selectedSources]
        })
      : await invoke<{ code: string }>('intermediate.create', {
          extractedDocumentUids: [...selectedSources],
          artifactTypeId: artifact.artifact_type_id,
          devPhaseId: phase.dev_phase_id,
          title: artifact.artifact_name,
          importItems: false
        })
    if (res.ok) {
      notify('info', existing ? '③中間データの取込元を更新しました' : '③中間データを作成しました')
      setImportDialogOpen(false)
      setSelectedArtifactUid(null)
      setSelectedSources(new Set())
      await refresh()
    } else {
      notify('error', '③中間データへ取込できませんでした', res.error.message)
    }
  }
}

/** 原本ビュー（V-01）。プレビューと抽出実行の起点 */
export function OriginalViewer({ uid }: { uid: string }): React.JSX.Element {
  const [doc, setDoc] = useState<(SourceDocumentItem & { file_hash: string; imported_at: string }) | null>(null)
  const notify = useJobsStore((s) => s.notify)

  useEffect(() => {
    void invoke<SourceDocumentItem & { file_hash: string; imported_at: string }>('document.get', { uid }).then(
      (res) => {
        if (res.ok) setDoc(res.result)
      }
    )
  }, [uid])

  const extract = async (): Promise<void> => {
    const res = await invoke('document.extract', { uid })
    if (res.ok) {
      notify('info', '抽出ジョブを開始しました')
      void executeCommand('job.openPanel')
    } else {
      notify('error', '抽出を開始できませんでした', res.error.message)
    }
  }

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
      <div style={{ marginTop: 12 }}>
        <button
          type="button"
          className="d2d-btn primary"
          onClick={() => void extract()}
          disabled={doc.file_type !== 'word'}
          data-testid="extract-button"
        >
          ②抽出データを生成（{doc.file_type === 'word' ? '抽出ジョブ実行' : `${doc.file_type} は P5 後続対応`}）
        </button>
      </div>
      <p style={{ color: 'var(--d2d-fg-muted)', marginTop: 16, fontSize: 11.5 }}>
        原本は blobs/originals/ に無改変で保管されています（IMP-009）。
      </p>
    </div>
  )
}
