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
  const [selectedCommitHashes, setSelectedCommitHashes] = useState<string[]>([])
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

  const openExports = async (): Promise<void> => {
    const res = await invoke<{ path: string }>('export.openFolder')
    if (!res.ok) notify('error', 'exportsフォルダを開けませんでした', res.error.message)
  }

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
  const compareCommits = (): void => {
    if (!git?.isRepo || selectedCommitHashes.length === 0) return
    const selected = selectedCommitHashes
      .map((hash) => ({ hash, index: git.commits.findIndex((commit) => commit.hash === hash) }))
      .filter((item) => item.index >= 0)
      .sort((a, b) => b.index - a.index)
    const fromHash = selected[0]?.hash
    const toHash = selected.length === 1 ? git.commits[0]?.hash : selected.at(-1)?.hash
    if (!fromHash || !toHash) return
    openResource(
      `diff://git-compare/${fromHash}..${toHash}`,
      `Git項目差分 ${fromHash.slice(0, 8)}..${toHash.slice(0, 8)}`,
      { preview: false }
    )
  }

  const toggleCommitSelection = (hash: string): void => {
    setSelectedCommitHashes((current) =>
      current.includes(hash) ? current.filter((item) => item !== hash) : [...current.slice(-1), hash]
    )
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
        <button
          type="button"
          className="d2d-btn"
          onClick={() => openResource('store://tables', 'ストア閲覧')}
          data-testid="open-store-browser"
        >
          ストア閲覧（DBテーブル）
        </button>
        <button
          type="button"
          className="d2d-btn primary"
          onClick={() => void createArchive()}
          data-testid="archive-create"
        >
          ZIPアーカイブ作成
        </button>
        <button type="button" className="d2d-btn" onClick={() => void exportDbToText()} data-testid="export-db-to-text">
          DB to Text出力
        </button>
        <button type="button" className="d2d-btn" onClick={() => void exportDump()} data-testid="export-sqlite-dump">
          SQLite dump出力
        </button>
        <button type="button" className="d2d-btn" onClick={() => void openExports()} data-testid="open-exports-folder">
          エクスプローラで開く
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
              <div key={file.path} className="d2d-list-row" style={{ display: 'flex', gap: 5 }}>
                <input
                  type="checkbox"
                  checked={selectedGitPaths.includes(file.path)}
                  onChange={(event) => changeGitSelection(file.path, event.target.checked)}
                  data-testid={`git-select-${file.path.replaceAll('/', '-')}`}
                  aria-label={`${file.path}をステージ操作対象にする`}
                />
                <code style={{ width: 24, color: file.staged ? 'var(--d2d-success)' : 'var(--d2d-warning)' }}>
                  {file.status || 'M'}
                </code>
                <button
                  type="button"
                  className="git-file-diff-link"
                  title={`${file.path}をHEADと比較`}
                  onClick={() =>
                    openResource(`diff://git-working/${encodeURIComponent(file.path)}`, `変更差分: ${file.path}`, {
                      preview: true
                    })
                  }
                  data-testid={`git-diff-${file.path.replaceAll('/', '-')}`}
                >
                  {file.path}
                </button>
              </div>
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
        {git?.isRepo && git.commits.length > 0 && (
          <button
            type="button"
            className="d2d-btn small"
            disabled={selectedCommitHashes.length === 0}
            onClick={compareCommits}
            data-testid="git-compare-selected"
            title="1件選択時は最新コミット、2件選択時は選択した新旧コミットを比較します"
          >
            選択履歴を比較（{selectedCommitHashes.length}/2）
          </button>
        )}
        {git?.isRepo &&
          git.commits.map((commit) => (
            <label key={commit.hash} className="d2d-list-row git-commit-row" title={`${commit.author} ${commit.date}`}>
              <input
                type="checkbox"
                checked={selectedCommitHashes.includes(commit.hash)}
                onChange={() => toggleCommitSelection(commit.hash)}
                data-testid={`git-commit-select-${commit.shortHash}`}
              />
              <span style={{ color: 'var(--d2d-fg-muted)', fontFamily: 'monospace' }}>{commit.shortHash}</span>
              <span>{commit.message}</span>
            </label>
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

// ---- Git Monaco差分・項目差分（P12-6、GIT-005/006） ----

interface GitFilePair {
  path: string
  left: string
  right: string
}

interface GitSemanticChange extends GitFilePair {
  key: string
  table: string
  status: '追加' | '削除' | '変更' | 'ファイル変更'
  uid?: string
  code?: string
  title?: string
  entityType?: string
  changedFields: string[]
}

function parseJsonl(text: string): Map<string, Record<string, unknown>> | null {
  if (!text.trim()) return new Map()
  const result = new Map<string, Record<string, unknown>>()
  try {
    text
      .split(/\r?\n/)
      .filter(Boolean)
      .forEach((line, index) => {
        const row = JSON.parse(line) as Record<string, unknown>
        const key = String(row.uid ?? row.code ?? index)
        result.set(key, row)
      })
    return result
  } catch {
    return null
  }
}

function semanticChanges(pair: GitFilePair): GitSemanticChange[] {
  const table =
    pair.path
      .split('/')
      .at(-1)
      ?.replace(/\.jsonl$/, '') ?? pair.path
  if (!pair.path.endsWith('.jsonl')) {
    return [{ ...pair, key: pair.path, table, status: 'ファイル変更', changedFields: [] }]
  }
  const leftRows = parseJsonl(pair.left)
  const rightRows = parseJsonl(pair.right)
  if (!leftRows || !rightRows) {
    return [{ ...pair, key: pair.path, table, status: 'ファイル変更', changedFields: [] }]
  }
  const changes: GitSemanticChange[] = []
  for (const key of new Set([...leftRows.keys(), ...rightRows.keys()])) {
    const left = leftRows.get(key)
    const right = rightRows.get(key)
    if (left && right && JSON.stringify(left) === JSON.stringify(right)) continue
    const changedFields = [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])].filter(
      (field) => JSON.stringify(left?.[field]) !== JSON.stringify(right?.[field])
    )
    const row = right ?? left ?? {}
    changes.push({
      path: pair.path,
      key: `${pair.path}:${key}`,
      table,
      status: left ? (right ? '変更' : '削除') : '追加',
      uid: typeof row.uid === 'string' ? row.uid : undefined,
      code: typeof row.code === 'string' ? row.code : undefined,
      title: typeof row.title === 'string' ? row.title : undefined,
      entityType: typeof row.entity_type === 'string' ? row.entity_type : undefined,
      changedFields,
      left: left ? JSON.stringify(left, null, 2) : '',
      right: right ? JSON.stringify(right, null, 2) : ''
    })
  }
  return changes
}

export function GitWorkingDiffEditor({ path }: { path: string }): React.JSX.Element {
  const [pair, setPair] = useState<GitFilePair | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void invoke<GitFilePair>('git.workingFileDiffPair', { path }).then((result) => {
      if (result.ok) setPair(result.result)
      else setError(result.error.message)
    })
  }, [path])
  if (error) return <div className="d2d-empty">差分を表示できません: {error}</div>
  if (!pair) return <div className="d2d-empty">差分を読込中…</div>
  return (
    <div className="git-working-diff" data-testid="git-working-diff">
      <header>
        HEAD ↔ 作業ツリー: <code>{pair.path}</code>
      </header>
      <DiffEditor
        original={pair.left}
        modified={pair.right}
        language={pair.path.endsWith('.json') ? 'json' : 'plaintext'}
      />
    </div>
  )
}

export function GitSemanticDiffEditor({ fromHash, toHash }: { fromHash: string; toHash: string }): React.JSX.Element {
  const [changes, setChanges] = useState<GitSemanticChange[] | null>(null)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let disposed = false
    void invoke<{ files: string[] }>('git.compare', { fromHash, toHash }).then(async (result) => {
      if (!result.ok) {
        if (!disposed) setError(result.error.message)
        return
      }
      const pairs = await Promise.all(
        result.result.files.map(async (path) => {
          const pair = await invoke<GitFilePair>('git.comparisonFilePair', { fromHash, toHash, path })
          return pair.ok ? pair.result : null
        })
      )
      if (disposed) return
      const next = pairs.filter((pair): pair is GitFilePair => pair !== null).flatMap(semanticChanges)
      setChanges(next)
      setSelectedKey(next[0]?.key ?? null)
    })
    return () => {
      disposed = true
    }
  }, [fromHash, toHash])

  if (error) return <div className="d2d-empty">履歴差分を表示できません: {error}</div>
  if (!changes) return <div className="d2d-empty">履歴差分を解析中…</div>
  const selected = changes.find((change) => change.key === selectedKey) ?? null
  const grouped = changes.reduce((map, change) => {
    map.set(change.table, [...(map.get(change.table) ?? []), change])
    return map
  }, new Map<string, GitSemanticChange[]>())
  return (
    <div className="git-semantic-diff" data-testid="git-semantic-diff">
      <aside>
        <h1>監視項目の変更</h1>
        <p>
          <code>{fromHash.slice(0, 8)}</code> → <code>{toHash.slice(0, 8)}</code> / {changes.length}件
        </p>
        {[...grouped].map(([table, rows]) => (
          <details key={table} open>
            <summary>
              {table}（{rows.length}）
            </summary>
            {rows.map((change) => (
              <button
                type="button"
                key={change.key}
                className={selectedKey === change.key ? 'active' : ''}
                onClick={() => setSelectedKey(change.key)}
                title={change.path}
              >
                <span className={`git-change-status is-${change.status}`}>{change.status}</span>
                <b>{change.code ?? change.uid ?? change.path}</b>
                <span>{change.title ?? change.entityType ?? change.changedFields.join(', ')}</span>
              </button>
            ))}
          </details>
        ))}
        {changes.length === 0 && <div className="d2d-empty">選択した履歴間に変更はありません。</div>}
      </aside>
      <main>
        {selected ? (
          <>
            <header>
              <b>
                {selected.table}: {selected.code ?? selected.uid ?? selected.path}
              </b>
              <span>
                {selected.status} / 変更項目: {selected.changedFields.join(', ') || 'ファイル全体'}
              </span>
            </header>
            <DiffEditor
              original={selected.left}
              modified={selected.right}
              language={selected.path.endsWith('.jsonl') ? 'json' : 'plaintext'}
            />
          </>
        ) : (
          <div className="d2d-empty">比較する項目を選択してください。</div>
        )}
      </main>
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
