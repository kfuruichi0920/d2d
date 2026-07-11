/**
 * 履歴・差分ビュー群（P12、M5 Perspective）。
 * - HistorySideBar: DB to Text / SQLite dump / ZIP 作成・差分・Git 履歴・ストア閲覧の起点
 * - ArchiveDiffEditor: アーカイブ差分サマリ + ファイル単位の Monaco Diff（UI-017）
 * - GitCommitViewer: コミットの stat + patch 表示（GIT-005）
 * - StoreBrowserEditor: SQLite テーブル閲覧（UI-020）
 */
import { useCallback, useEffect, useState } from 'react'
import { invoke } from '../../services/backend'
import { onBackendEvent } from '../../services/backend'
import { useEditorStore } from '../../stores/editor-store'
import { useJobsStore } from '../../stores/jobs-store'
import { useProjectStore } from '../../stores/project-store'
import { DiffEditor } from '../common/DiffEditor'
import { CodeEditor } from '../common/CodeEditor'

interface ArchiveItem {
  fileName: string
  size: number
  modifiedAt: string
}

interface GitCommit {
  hash: string
  shortHash: string
  date: string
  message: string
  author: string
}

function formatSize(size: number): string {
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

export function HistorySideBar(): React.JSX.Element {
  const project = useProjectStore((s) => s.project)
  const openResource = useEditorStore((s) => s.openResource)
  const notify = useJobsStore((s) => s.notify)
  const [archives, setArchives] = useState<ArchiveItem[]>([])
  const [git, setGit] = useState<{ isRepo: boolean; commits: GitCommit[] } | null>(null)

  const refresh = useCallback(async () => {
    const [archivesRes, gitRes] = await Promise.all([
      invoke<ArchiveItem[]>('archive.list'),
      invoke<{ isRepo: boolean; commits: GitCommit[] }>('git.log', { maxCount: 30 })
    ])
    if (archivesRes.ok) setArchives(archivesRes.result)
    if (gitRes.ok) setGit(gitRes.result)
  }, [])

  useEffect(() => {
    if (!project) return
    void refresh()
    return onBackendEvent((event) => {
      if (event === 'archive.created') void refresh()
    })
  }, [project, refresh])

  if (!project) return <div className="d2d-empty">プロジェクトが開かれていません。</div>

  const exportDbToText = async (): Promise<void> => {
    const res = await invoke<{ relDir: string; files: string[] }>('export.dbToText')
    if (res.ok) {
      notify('info', `DB to Text を出力しました（${res.result.files.length} ファイル）`, res.result.relDir)
    } else {
      notify('error', 'DB to Text を出力できませんでした', res.error.message)
    }
  }

  const exportDump = async (): Promise<void> => {
    const res = await invoke<{ relDir: string }>('export.sqliteDump')
    if (res.ok) notify('info', 'SQLite dump を出力しました', res.result.relDir)
    else notify('error', 'SQLite dump を出力できませんでした', res.error.message)
  }

  const createArchive = async (): Promise<void> => {
    const res = await invoke('archive.create', {})
    if (res.ok) notify('info', 'アーカイブ作成ジョブを開始しました')
    else notify('error', 'アーカイブを作成できませんでした', res.error.message)
  }

  const importForDiff = async (fileName: string): Promise<void> => {
    const res = await invoke('archive.importForDiff', { fileName })
    if (res.ok) {
      openResource('diff://archive', 'アーカイブ差分', { preview: false })
    } else {
      notify('error', '差分インポートに失敗しました', res.error.message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 8 }} data-testid="history-sidebar">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button type="button" className="d2d-btn" onClick={() => void exportDbToText()} data-testid="export-db-to-text">
          DB to Text 出力
        </button>
        <button type="button" className="d2d-btn" onClick={() => void exportDump()} data-testid="export-sqlite-dump">
          SQLite dump 出力
        </button>
        <button
          type="button"
          className="d2d-btn primary"
          onClick={() => void createArchive()}
          data-testid="archive-create"
        >
          ZIP アーカイブ作成
        </button>
        <button
          type="button"
          className="d2d-btn"
          onClick={() => openResource('store://tables', 'ストア閲覧')}
          data-testid="open-store-browser"
        >
          ストア閲覧（DB テーブル）
        </button>
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--d2d-fg-muted)', marginTop: 6 }}>
        アーカイブ（{archives.length}）
      </div>
      <div data-testid="archives-list">
        {archives.length === 0 && <div className="d2d-empty">アーカイブはまだありません</div>}
        {archives.map((a) => (
          <div key={a.fileName} className="d2d-list-row" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span
              style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={a.fileName}
            >
              🗜 {a.fileName}
            </span>
            <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{formatSize(a.size)}</span>
            <button
              type="button"
              className="d2d-btn small"
              onClick={() => void importForDiff(a.fileName)}
              data-testid={`archive-diff-${a.fileName}`}
              title="現在の正本と差分比較（正本は上書きしません）"
            >
              差分
            </button>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--d2d-fg-muted)', marginTop: 6 }}>
        Git 履歴（読み取り専用）
      </div>
      <div data-testid="git-log">
        {git === null && <div className="d2d-empty">読込中…</div>}
        {git !== null && !git.isRepo && (
          <div className="d2d-empty" data-testid="git-not-repo">
            Git リポジトリではありません。コミットはツール外の Git 操作で行ってください（GIT-007）。
          </div>
        )}
        {git?.isRepo &&
          git.commits.map((c) => (
            <div
              key={c.hash}
              className="d2d-list-row"
              onClick={() =>
                openResource(`diff://git/${c.hash}`, `${c.shortHash} ${c.message.slice(0, 20)}`, { preview: true })
              }
              title={`${c.author} ${c.date}`}
            >
              <span style={{ color: 'var(--d2d-fg-muted)', fontFamily: 'monospace' }}>{c.shortHash}</span> {c.message}
            </div>
          ))}
      </div>
    </div>
  )
}

// ---- アーカイブ差分（P12-4/P12-6） ----

interface ArchiveDiff {
  archiveFileName: string
  manifest: {
    schema_version: string
    created_at: string
    project_name: string
    artifact_summary: { extracted_documents: number; intermediate_documents: number; design_elements: number }
  }
  warnings: string[]
  tables: { file: string; added: number; removed: number; changed: number }[]
}

export function ArchiveDiffEditor(): React.JSX.Element {
  const [diff, setDiff] = useState<ArchiveDiff | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [pair, setPair] = useState<{ file: string; left: string; right: string } | null>(null)

  useEffect(() => {
    void invoke<ArchiveDiff | null>('archive.lastDiff').then((res) => {
      if (res.ok) setDiff(res.result)
    })
  }, [])

  useEffect(() => {
    if (!selected) return
    void invoke<{ file: string; left: string; right: string }>('archive.getDiffContent', { file: selected }).then(
      (res) => {
        if (res.ok) setPair(res.result)
      }
    )
  }, [selected])

  if (!diff) {
    return <div className="d2d-empty">差分インポートが実行されていません（History サイドバーの「差分」から実行）。</div>
  }

  const changedTables = diff.tables.filter((t) => t.added + t.removed + t.changed > 0)

  return (
    <div style={{ display: 'flex', height: '100%' }} data-testid="archive-diff-editor">
      <div style={{ width: 320, overflow: 'auto', borderRight: '1px solid var(--d2d-border)', padding: 8 }}>
        <h1 style={{ fontSize: 14, marginTop: 0 }}>アーカイブ差分</h1>
        <p style={{ fontSize: 12, color: 'var(--d2d-fg-muted)', margin: '4px 0' }}>
          {diff.archiveFileName}
          <br />
          作成: {diff.manifest.created_at}（schema {diff.manifest.schema_version}）
        </p>
        {diff.warnings.map((w, i) => (
          <div key={i} style={{ color: 'var(--d2d-warning)', fontSize: 12 }}>
            ⚠ {w}
          </div>
        ))}
        <div style={{ fontSize: 12, color: 'var(--d2d-fg-muted)', margin: '6px 0' }}>
          左=アーカイブ（過去） / 右=現在正本。変更 {changedTables.length} ファイル
        </div>
        <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }} data-testid="archive-diff-tables">
          <thead>
            <tr>
              {['ファイル', '+', '−', '変更'].map((h) => (
                <th key={h} style={{ textAlign: 'left', color: 'var(--d2d-fg-muted)', padding: '2px 4px' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {diff.tables.map((t) => (
              <tr
                key={t.file}
                onClick={() => setSelected(t.file)}
                style={{
                  cursor: 'pointer',
                  background: selected === t.file ? 'var(--d2d-selection-bg)' : undefined,
                  color: t.added + t.removed + t.changed > 0 ? undefined : 'var(--d2d-fg-muted)'
                }}
                data-testid={`diff-row-${t.file}`}
              >
                <td style={{ padding: '2px 4px', wordBreak: 'break-all' }}>{t.file}</td>
                <td style={{ padding: '2px 4px', color: 'var(--d2d-success, #4c4)' }}>{t.added || ''}</td>
                <td style={{ padding: '2px 4px', color: 'var(--d2d-error, #c44)' }}>{t.removed || ''}</td>
                <td style={{ padding: '2px 4px', color: 'var(--d2d-warning)' }}>{t.changed || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {pair ? (
          <DiffEditor original={pair.left} modified={pair.right} language="plaintext" />
        ) : (
          <div className="d2d-empty">左の一覧からファイルを選択すると差分を表示します。</div>
        )}
      </div>
    </div>
  )
}

// ---- Git コミット表示（P12-5/P12-6、GIT-005） ----

export function GitCommitViewer({ hash }: { hash: string }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void invoke<{ text: string }>('git.show', { hash }).then((res) => {
      if (res.ok) setText(res.result.text)
      else setError(res.error.message)
    })
  }, [hash])

  if (error) return <div className="d2d-empty">コミットを表示できません: {error}</div>
  if (text === null) return <div className="d2d-empty">読込中…</div>
  return (
    <div style={{ height: '100%' }} data-testid="git-commit-viewer">
      <CodeEditor value={text} language="plaintext" readOnly />
    </div>
  )
}

// ---- ストア閲覧（P12-7、UI-020） ----

interface StoreTable {
  name: string
  columns: string[]
  rowCount: number
}

export function StoreBrowserEditor(): React.JSX.Element {
  const [tables, setTables] = useState<StoreTable[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [rows, setRows] = useState<{ columns: string[]; rows: Record<string, unknown>[] } | null>(null)

  useEffect(() => {
    void invoke<StoreTable[]>('store.listTables').then((res) => {
      if (res.ok) setTables(res.result)
    })
  }, [])

  useEffect(() => {
    if (!selected) return
    void invoke<{ columns: string[]; rows: Record<string, unknown>[] }>('store.getRows', {
      table: selected,
      limit: 200
    }).then((res) => {
      if (res.ok) setRows(res.result)
    })
  }, [selected])

  const cellText = (v: unknown): string => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return s.length > 120 ? `${s.slice(0, 120)}…` : s
  }

  return (
    <div style={{ display: 'flex', height: '100%' }} data-testid="store-browser">
      <div style={{ width: 260, overflow: 'auto', borderRight: '1px solid var(--d2d-border)', padding: 8 }}>
        <h1 style={{ fontSize: 14, marginTop: 0 }}>ストア閲覧（UI-020）</h1>
        {tables.map((t) => (
          <div
            key={t.name}
            className="d2d-list-row"
            onClick={() => setSelected(t.name)}
            style={{ background: selected === t.name ? 'var(--d2d-selection-bg)' : undefined }}
            data-testid={`store-table-${t.name}`}
          >
            <span style={{ flex: 1 }}>{t.name}</span>
            <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{t.rowCount}</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 8 }}>
        {!rows && <div className="d2d-empty">左の一覧からテーブルを選択してください。</div>}
        {rows && (
          <table style={{ borderCollapse: 'collapse', fontSize: 11.5 }} data-testid="store-rows">
            <thead>
              <tr>
                {rows.columns.map((c) => (
                  <th
                    key={c}
                    style={{
                      textAlign: 'left',
                      padding: '2px 8px',
                      color: 'var(--d2d-fg-muted)',
                      borderBottom: '1px solid var(--d2d-border)',
                      position: 'sticky',
                      top: 0,
                      background: 'var(--d2d-bg)'
                    }}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.rows.map((row, i) => (
                <tr key={i}>
                  {rows.columns.map((c) => (
                    <td
                      key={c}
                      style={{ padding: '2px 8px', borderBottom: '1px solid var(--d2d-border)', whiteSpace: 'nowrap' }}
                    >
                      {cellText(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
