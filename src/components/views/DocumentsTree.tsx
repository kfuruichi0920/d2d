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
  file_name: string
  file_type: string
  status: string
  is_current: number
}

export interface ExtractedDocumentItem {
  uid: string
  code: string
  title: string | null
  status: string
  item_count: number
  source_document_uid: string
}

interface ArtifactSetting {
  uid: string
  artifact_name: string
  artifact_type_id: string
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
  artifact_type_id: string
  dev_phase_id: string
  item_count: number
  sources?: { extracted_document_uid: string; order: number }[]
}

export function DocumentsTree(): React.JSX.Element {
  const [sources, setSources] = useState<SourceDocumentItem[]>([])
  const [extracted, setExtracted] = useState<ExtractedDocumentItem[]>([])
  const [intermediates, setIntermediates] = useState<IntermediateDocumentItem[]>([])
  const [artifacts, setArtifacts] = useState<ArtifactSetting[]>([])
  const [phases, setPhases] = useState<DevPhaseSetting[]>([])
  const [importTarget, setImportTarget] = useState<{ artifact: ArtifactSetting; phase: DevPhaseSetting } | null>(null)
  const [selectedSources, setSelectedSources] = useState<Set<string>>(new Set())
  const openResource = useEditorStore((s) => s.openResource)
  const notify = useJobsStore((s) => s.notify)

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
        ['source.imported', 'artifact.updated', 'extraction.completed', 'intermediate.updated', 'job.updated'].includes(
          event
        )
      ) {
        void refresh()
      }
    })
  }, [refresh])

  const importDocument = async (): Promise<void> => {
    const filePath = await window.api.showOpenDialog({
      title: '取込む原本ファイルを選択',
      mode: 'file',
      filters: [
        {
          name: '対象文書',
          extensions: ['docx', 'xlsx', 'pptx', 'vsdx', 'pdf', 'txt', 'md', 'csv', 'tsv', 'json', 'jsonl', 'yaml']
        }
      ]
    })
    if (!filePath) return
    const res = await invoke('document.import', { filePath })
    if (!res.ok) notify('error', '取込を開始できませんでした', res.error.message)
  }

  return (
    <div data-testid="documents-tree">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '2px 4px' }}>
        <span style={{ fontWeight: 700 }}>①原本</span>
        <span style={{ color: 'var(--d2d-fg-muted)' }}>{sources.length}</span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="d2d-btn small"
          onClick={() => void importDocument()}
          data-testid="import-button"
        >
          取込…
        </button>
      </div>
      {sources.map((doc) => (
        <div
          key={doc.uid}
          className="d2d-list-row"
          data-testid={`source-doc-${doc.code}`}
          onClick={() => openResource(`original://${doc.uid}`, doc.file_name, { preview: true })}
        >
          <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{doc.file_type}</span>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.file_name}</span>
          {doc.is_current === 0 && <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 10 }}>旧版</span>}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 4px 2px' }}>
        <span style={{ fontWeight: 700 }}>②抽出データ</span>
        <span style={{ color: 'var(--d2d-fg-muted)' }}>{extracted.length}</span>
      </div>
      {extracted.map((doc) => (
        <div
          key={doc.uid}
          className="d2d-list-row"
          data-testid={`extracted-doc-${doc.code}`}
          onClick={() => openResource(`extracted://${doc.uid}`, `抽出: ${doc.title ?? doc.code}`, { preview: true })}
        >
          <ReviewStatusBadge status={reviewStateFromEntityStatus(doc.status)} />
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.title ?? doc.code}</span>
          <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{doc.item_count}要素</span>
          {doc.status === 'approved' && (
            <button
              type="button"
              className="d2d-btn small"
              title="承認済み②から③中間データ（統合設計書）を生成"
              data-testid={`compose-${doc.code}`}
              onClick={(e) => {
                e.stopPropagation()
                void composeIntermediate(doc.uid)
              }}
            >
              ③へ統合
            </button>
          )}
        </div>
      ))}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 4px 2px' }}>
        <span style={{ fontWeight: 700 }}>③中間データ</span>
        <span style={{ color: 'var(--d2d-fg-muted)' }}>{intermediates.length}</span>
      </div>
      {phases
        .filter((p) => p.is_active === 1)
        .map((phase) => (
          <div key={phase.uid} data-testid={`phase-${phase.dev_phase_id}`}>
            <div style={{ padding: '5px 4px 2px', fontWeight: 600 }}>▾ {phase.dev_phase_name}</div>
            {artifacts
              .filter((a) => a.is_active === 1)
              .map((artifact) => {
                const doc = intermediates.find(
                  (m) => m.dev_phase_id === phase.dev_phase_id && m.artifact_type_id === artifact.artifact_type_id
                )
                const sourceIds = doc?.sources?.map((x) => x.extracted_document_uid) ?? []
                return (
                  <div
                    key={artifact.uid}
                    className="d2d-list-row"
                    style={{ paddingLeft: 14 }}
                    data-testid={
                      doc
                        ? `intermediate-doc-${doc.code}`
                        : `artifact-slot-${phase.dev_phase_id}-${artifact.artifact_type_id}`
                    }
                    onClick={() =>
                      doc &&
                      openResource(`intermediate://${doc.uid}`, `③: ${doc.title ?? artifact.artifact_name}`, {
                        preview: true
                      })
                    }
                  >
                    {doc && <ReviewStatusBadge status={reviewStateFromEntityStatus(doc.status)} />}
                    <span style={{ flex: 1 }}>
                      {artifact.artifact_name}
                      <small style={{ display: 'block', color: 'var(--d2d-fg-muted)' }}>
                        {sourceIds.map((id) => extracted.find((x) => x.uid === id)?.title ?? id).join(' / ') ||
                          '統合元未選択'}
                      </small>
                    </span>
                    <button
                      type="button"
                      className="d2d-btn small"
                      onClick={(e) => {
                        e.stopPropagation()
                        setImportTarget({ artifact, phase })
                        setSelectedSources(new Set(sourceIds))
                      }}
                    >
                      取込
                    </button>
                  </div>
                )
              })}
          </div>
        ))}
      {importTarget && (
        <div
          role="dialog"
          data-testid="intermediate-source-dialog"
          style={{
            position: 'fixed',
            inset: '20% 25%',
            zIndex: 20,
            background: 'var(--d2d-bg-elevated)',
            border: '1px solid var(--d2d-border)',
            padding: 16,
            boxShadow: '0 8px 30px #0008'
          }}
        >
          <h3>
            {importTarget.phase.dev_phase_name} / {importTarget.artifact.artifact_name} の統合元
          </h3>
          {extracted
            .filter((x) => x.status === 'approved')
            .map((x) => (
              <label key={x.uid} style={{ display: 'block', padding: 6 }}>
                <input
                  type="checkbox"
                  checked={selectedSources.has(x.uid)}
                  onChange={(e) =>
                    setSelectedSources((current) => {
                      const next = new Set(current)
                      if (e.target.checked) next.add(x.uid)
                      else next.delete(x.uid)
                      return next
                    })
                  }
                />{' '}
                {x.title ?? x.code}
              </label>
            ))}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button className="d2d-btn" onClick={() => setImportTarget(null)}>
              キャンセル
            </button>
            <button
              className="d2d-btn primary"
              disabled={selectedSources.size === 0}
              onClick={() => void createArtifactIntermediate()}
            >
              選択して取込
            </button>
          </div>
        </div>
      )}
      <DesignModelTree />
    </div>
  )

  async function createArtifactIntermediate(): Promise<void> {
    if (!importTarget) return
    const existing = intermediates.find(
      (m) =>
        m.dev_phase_id === importTarget.phase.dev_phase_id &&
        m.artifact_type_id === importTarget.artifact.artifact_type_id
    )
    if (existing) {
      notify('error', 'この成果物は作成済みです', '統合元の追加・削除は中間データ編集画面で行ってください。')
      setImportTarget(null)
      return
    }
    const res = await invoke<{ code: string }>('intermediate.create', {
      extractedDocumentUids: [...selectedSources],
      artifactTypeId: importTarget.artifact.artifact_type_id,
      devPhaseId: importTarget.phase.dev_phase_id,
      title: importTarget.artifact.artifact_name,
      importItems: false
    })
    if (res.ok) {
      notify('info', `③中間データを作成しました: ${res.result.code}`)
      setImportTarget(null)
      await refresh()
    } else notify('error', '③中間データを作成できませんでした', res.error.message)
  }

  async function composeIntermediate(extractedUid: string): Promise<void> {
    const res = await invoke<{ code: string }>('intermediate.create', { extractedDocumentUids: [extractedUid] })
    if (res.ok) {
      notify('info', `③中間データを生成しました: ${res.result.code}`)
    } else {
      notify('error', '③中間データを生成できませんでした', res.error.message)
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
