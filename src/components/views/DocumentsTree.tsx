/**
 * Explorer の ①原本 / ②抽出データ ツリー（P4-2 / P5-15、UI-010/011）。
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke, onBackendEvent } from '../../services/backend'
import { executeCommand } from '../../services/command-registry'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { reviewStateFromEntityStatus, ReviewStatusBadge } from '../common/review'

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

export function DocumentsTree(): React.JSX.Element {
  const [sources, setSources] = useState<SourceDocumentItem[]>([])
  const [extracted, setExtracted] = useState<ExtractedDocumentItem[]>([])
  const openResource = useEditorStore((s) => s.openResource)
  const notify = useJobsStore((s) => s.notify)

  const refresh = useCallback(async () => {
    const [docs, exts] = await Promise.all([
      invoke<SourceDocumentItem[]>('document.list'),
      invoke<ExtractedDocumentItem[]>('extracted.list')
    ])
    if (docs.ok) setSources(docs.result)
    if (exts.ok) setExtracted(exts.result)
  }, [])

  useEffect(() => {
    void refresh()
    return onBackendEvent((event) => {
      if (['source.imported', 'artifact.updated', 'extraction.completed', 'job.updated'].includes(event)) {
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
        </div>
      ))}

      <div style={{ padding: '8px 4px 2px', color: 'var(--d2d-fg-muted)' }}>
        <div>③中間データ（P7 で実装）</div>
        <div>④設計モデル（P8 で実装）</div>
      </div>
    </div>
  )
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
