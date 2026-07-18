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
import { useSelectionStore } from '../../stores/selection-store'
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

interface GitStatusFile {
  path: string
  status: string
  staged: boolean
}

interface GitBranchState {
  current: string
  branches: string[]
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
  const [gitFiles, setGitFiles] = useState<GitStatusFile[]>([])
  const [branches, setBranches] = useState<GitBranchState>({ current: '', branches: [] })
  const [selectedGitPaths, setSelectedGitPaths] = useState<string[]>([])
  const [commitMessage, setCommitMessage] = useState('')
  const [authorName, setAuthorName] = useState('D2D User')
  const [authorEmail, setAuthorEmail] = useState('d2d@example.local')
  const [newBranchName, setNewBranchName] = useState('')

  const refresh = useCallback(async () => {
    const [archivesRes, gitRes, statusRes, branchRes] = await Promise.all([
      invoke<ArchiveItem[]>('archive.list'),
      invoke<{ isRepo: boolean; commits: GitCommit[] }>('git.log', { maxCount: 30 }),
      invoke<{ isRepo: boolean; files: GitStatusFile[] }>('git.status'),
      invoke<GitBranchState>('git.branches')
    ])
    if (archivesRes.ok) setArchives(archivesRes.result)
    if (gitRes.ok) setGit(gitRes.result)
    if (statusRes.ok) setGitFiles(statusRes.result.files)
    if (branchRes.ok) setBranches(branchRes.result)
  }, [])

  useEffect(() => {
    if (!project) return
    void refresh()
    return onBackendEvent((event) => {
      if (event === 'archive.created' || event === 'git.committed') void refresh()
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

  const changeGitSelection = (path: string, checked: boolean): void => {
    setSelectedGitPaths((current) =>
      checked ? [...new Set([...current, path])] : current.filter((item) => item !== path)
    )
  }

  const updateGitIndex = async (method: 'git.stage' | 'git.unstage'): Promise<void> => {
    if (selectedGitPaths.length === 0) return
    const result = await invoke(method, { paths: selectedGitPaths })
    if (result.ok) {
      setSelectedGitPaths([])
      await refresh()
    } else notify('error', 'Gitのステージ状態を更新できませんでした', result.error.message)
  }

  const commitGit = async (): Promise<void> => {
    const result = await invoke<{
      commit: GitCommit
      dbToTextFiles: number
      sqliteDumpFiles: number
    }>('git.commit', { message: commitMessage, authorName, authorEmail })
    if (result.ok) {
      notify(
        'info',
        `Gitコミット ${result.result.commit.shortHash} を作成しました`,
        `DB to Text ${result.result.dbToTextFiles}件 / SQLite dump ${result.result.sqliteDumpFiles}件`
      )
      setCommitMessage('')
      setSelectedGitPaths([])
      await refresh()
    } else notify('error', 'Gitコミットに失敗しました', result.error.message)
  }

  const createBranch = async (): Promise<void> => {
    const result = await invoke<GitBranchState>('git.branchCreate', { name: newBranchName })
    if (result.ok) {
      setBranches(result.result)
      setNewBranchName('')
      notify('info', `ブランチ ${result.result.current} を作成しました`)
    } else notify('error', 'ブランチを作成できませんでした', result.error.message)
  }

  const checkoutBranch = async (name: string): Promise<void> => {
    const result = await invoke<GitBranchState>('git.checkout', { name })
    if (result.ok) {
      setBranches(result.result)
      await refresh()
    } else notify('error', 'ブランチを切り替えられませんでした', result.error.message)
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
        Git操作（GIT-003/004/007）
      </div>
      {git === null && <div className="d2d-empty">読込中…</div>}
      {git !== null && !git.isRepo && (
        <div className="d2d-empty" data-testid="git-not-repo">
          Gitリポジトリではありません。ツール設定で新規プロジェクトのGit初期化を有効にしてください。
        </div>
      )}
      {git?.isRepo && (
        <div data-testid="git-operations" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <select
              value={branches.current}
              onChange={(event) => void checkoutBranch(event.target.value)}
              data-testid="git-current-branch"
              title="ローカルブランチを切り替えます"
              style={{ minWidth: 0, flex: 1 }}
            >
              {branches.branches.map((branch) => (
                <option key={branch} value={branch}>
                  {branch}
                </option>
              ))}
            </select>
            <button type="button" className="d2d-btn small" onClick={() => void refresh()} data-testid="git-refresh">
              更新
            </button>
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={newBranchName}
              onChange={(event) => setNewBranchName(event.target.value)}
              placeholder="新規ブランチ名"
              data-testid="git-new-branch-name"
              style={{ minWidth: 0, flex: 1 }}
            />
            <button
              type="button"
              className="d2d-btn small"
              disabled={!newBranchName.trim()}
              onClick={() => void createBranch()}
              data-testid="git-create-branch"
            >
              作成
            </button>
          </div>
          <div data-testid="git-status-files" style={{ maxHeight: 160, overflow: 'auto' }}>
            {gitFiles.length === 0 && <div className="d2d-empty">作業ツリーに変更はありません</div>}
            {gitFiles.map((file) => (
              <label key={file.path} className="d2d-list-row" style={{ display: 'flex', gap: 5 }}>
                <input
                  type="checkbox"
                  checked={selectedGitPaths.includes(file.path)}
                  onChange={(event) => changeGitSelection(file.path, event.target.checked)}
                  data-testid={`git-select-${file.path.replaceAll('/', '-')}`}
                />
                <code style={{ width: 24, color: file.staged ? 'var(--d2d-success)' : 'var(--d2d-warning)' }}>
                  {file.status || 'M'}
                </code>
                <span title={file.path} style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {file.path}
                </span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              className="d2d-btn small"
              disabled={selectedGitPaths.length === 0}
              onClick={() => void updateGitIndex('git.stage')}
              data-testid="git-stage"
            >
              ステージ
            </button>
            <button
              type="button"
              className="d2d-btn small"
              disabled={selectedGitPaths.length === 0}
              onClick={() => void updateGitIndex('git.unstage')}
              data-testid="git-unstage"
            >
              ステージ解除
            </button>
          </div>
          <input
            value={commitMessage}
            onChange={(event) => setCommitMessage(event.target.value)}
            placeholder="コミットメッセージ"
            data-testid="git-commit-message"
          />
          <div style={{ display: 'flex', gap: 4 }}>
            <input
              value={authorName}
              onChange={(event) => setAuthorName(event.target.value)}
              placeholder="作成者名"
              data-testid="git-author-name"
              style={{ minWidth: 0, flex: 1 }}
            />
            <input
              value={authorEmail}
              onChange={(event) => setAuthorEmail(event.target.value)}
              placeholder="メール"
              data-testid="git-author-email"
              style={{ minWidth: 0, flex: 1 }}
            />
          </div>
          <button
            type="button"
            className="d2d-btn primary"
            disabled={!commitMessage.trim() || !authorName.trim() || !authorEmail.trim()}
            onClick={() => void commitGit()}
            data-testid="git-commit"
            title="DB to TextとSQLite dumpを再生成・ステージして、現在のステージ内容をコミットします"
          >
            テキスト化してコミット
          </button>
        </div>
      )}

      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--d2d-fg-muted)', marginTop: 6 }}>Git履歴</div>
      <div data-testid="git-log">
        {git?.isRepo && git.commits.length === 0 && (
          <div className="d2d-empty" data-testid="git-empty-repo">
            Gitリポジトリは初期化済みです。コミットはまだありません。
          </div>
        )}
        {git?.isRepo &&
          git.commits.map((commit) => (
            <div
              key={commit.hash}
              className="d2d-list-row"
              onClick={() =>
                openResource(`diff://git/${commit.hash}`, `${commit.shortHash} ${commit.message.slice(0, 20)}`, {
                  preview: true
                })
              }
              title={`${commit.author} ${commit.date}`}
            >
              <span style={{ color: 'var(--d2d-fg-muted)', fontFamily: 'monospace' }}>{commit.shortHash}</span>{' '}
              {commit.message}
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
  const [data, setData] = useState<{ columns: string[]; rows: Record<string, unknown>[]; total: number } | null>(null)
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const setSelectedItem = useSelectionStore((s) => s.setSelectedItem)
  const clearSelectedItem = useSelectionStore((s) => s.clearSelectedItem)
  const PAGE = 500

  useEffect(() => {
    void invoke<StoreTable[]>('store.listTables').then((res) => {
      if (res.ok) setTables(res.result)
    })
  }, [])
  const load = useCallback(async (table: string, offset: number) => {
    setLoading(true)
    const res = await invoke<{ columns: string[]; rows: Record<string, unknown>[]; total: number }>('store.getRows', {
      table,
      limit: PAGE,
      offset
    })
    setLoading(false)
    if (res.ok)
      setData((current) => ({
        columns: res.result.columns,
        total: res.result.total,
        rows: offset === 0 ? res.result.rows : [...(current?.rows ?? []), ...res.result.rows]
      }))
  }, [])
  useEffect(() => {
    setData(null)
    setSelectedIndex(null)
    if (selected) void load(selected, 0)
  }, [load, selected])
  useEffect(() => {
    const contextUri = 'store://tables'
    const row = selectedIndex === null ? null : data?.rows[selectedIndex]
    if (!selected || !row) {
      clearSelectedItem(contextUri)
      return
    }
    const uid = typeof row.uid === 'string' ? row.uid : `${selected}:${(selectedIndex ?? 0) + 1}`
    const properties = Object.fromEntries(
      [['テーブル', selected] as const, ...Object.entries(row)].map(([k, v]) => [
        k,
        v === null || ['string', 'number', 'boolean'].includes(typeof v)
          ? (v as string | number | boolean | null)
          : JSON.stringify(v)
      ])
    )
    setSelectedItem({
      contextUri,
      uid,
      displayId: typeof row.code === 'string' ? row.code : uid,
      entityType: typeof row.entity_type === 'string' ? row.entity_type : selected,
      title: typeof row.title === 'string' ? row.title : undefined,
      status: typeof row.status === 'string' ? row.status : undefined,
      properties
    })
    return () => clearSelectedItem(contextUri)
  }, [clearSelectedItem, data, selected, selectedIndex, setSelectedItem])
  const cellText = (v: unknown): string => {
    if (v == null) return ''
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return s.length > 120 ? `${s.slice(0, 120)}…` : s
  }
  const choose = (index: number): void => setSelectedIndex(index)
  const key = (event: React.KeyboardEvent<HTMLTableRowElement>, index: number): void => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const next = Math.max(0, Math.min((data?.rows.length ?? 1) - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))
    choose(next)
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-store-row="${next}"]`)?.focus())
  }
  return (
    <div style={{ display: 'flex', height: '100%' }} data-testid="store-browser">
      <div style={{ width: 260, overflow: 'auto', borderRight: '1px solid var(--d2d-border)', padding: 8 }}>
        <h1 style={{ fontSize: 14, marginTop: 0 }}>ストア閲覧（UI-020）</h1>
        {tables.map((table) => (
          <div
            key={table.name}
            className="d2d-list-row"
            onClick={() => setSelected(table.name)}
            style={{ background: selected === table.name ? 'var(--d2d-selection-bg)' : undefined }}
            data-testid={`store-table-${table.name}`}
          >
            <span style={{ flex: 1 }}>{table.name}</span>
            <span style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{table.rowCount}</span>
          </div>
        ))}
      </div>
      <div
        className="store-rows-scroll"
        style={{ flex: 1, padding: 8 }}
        onScroll={(e) => {
          const el = e.currentTarget
          if (
            selected &&
            data &&
            !loading &&
            data.rows.length < data.total &&
            el.scrollTop + el.clientHeight >= el.scrollHeight - 80
          )
            void load(selected, data.rows.length)
        }}
      >
        {!data && <div className="d2d-empty">左の一覧からテーブルを選択してください。</div>}
        {data && (
          <>
            <div data-testid="store-row-count">
              {data.rows.length} / {data.total} 件
            </div>
            <table
              style={{ borderCollapse: 'collapse', fontSize: 11.5, minWidth: 'max-content' }}
              data-testid="store-rows"
            >
              <thead>
                <tr>
                  <th style={{ position: 'sticky', top: 0, background: 'var(--d2d-bg)' }}>行</th>
                  {data.columns.map((column) => (
                    <th
                      key={column}
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
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, index) => (
                  <tr
                    key={index}
                    tabIndex={0}
                    data-store-row={index}
                    aria-selected={selectedIndex === index}
                    className={selectedIndex === index ? 'store-row-selected' : ''}
                    onClick={() => choose(index)}
                    onKeyDown={(e) => key(e, index)}
                  >
                    <td style={{ padding: '2px 8px', borderBottom: '1px solid var(--d2d-border)' }}>{index + 1}</td>
                    {data.columns.map((column) => (
                      <td
                        key={column}
                        style={{
                          padding: '2px 8px',
                          borderBottom: '1px solid var(--d2d-border)',
                          whiteSpace: 'nowrap'
                        }}
                      >
                        {cellText(row[column])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {data.rows.length < data.total && (
              <button
                className="d2d-btn"
                disabled={loading}
                onClick={() => selected && void load(selected, data.rows.length)}
                data-testid="store-load-more"
              >
                {loading ? '読込中…' : 'さらに読込'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}
