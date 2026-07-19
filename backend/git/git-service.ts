/**
 * Git連携（P12-5、GIT-001〜007）。
 * 履歴・差分参照に加え、状態確認、ステージ、コミット、ローカルブランチ操作を提供する。
 * コミット前のDB to Text／SQLite dump生成はAPI層が担う（GIT-004/007）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { simpleGit, type SimpleGit } from 'simple-git'
import { BackendError } from '../api/errors'

function git(projectRoot: string): SimpleGit {
  return simpleGit({ baseDir: projectRoot })
}

export async function isGitRepo(projectRoot: string): Promise<boolean> {
  try {
    return await git(projectRoot).checkIsRepo()
  } catch {
    return false
  }
}

export interface GitCommitItem {
  hash: string
  shortHash: string
  date: string
  message: string
  author: string
}

/** コミット履歴（GIT-002）。新しい順 */
export async function getGitLog(projectRoot: string, maxCount = 50): Promise<GitCommitItem[]> {
  try {
    const log = await git(projectRoot).log({ maxCount })
    return log.all.map((c) => ({
      hash: c.hash,
      shortHash: c.hash.slice(0, 8),
      date: c.date,
      message: c.message,
      author: c.author_name
    }))
  } catch (error) {
    // CORE-047: git init直後の未コミットRepositoryは正常な空履歴として扱う。
    const message = error instanceof Error ? error.message : String(error)
    if (/does not have any commits|bad default revision|unknown revision/i.test(message)) return []
    throw error
  }
}

export interface GitStatusItem {
  path: string
  status: string
  staged: boolean
}

/** 作業ツリーの変更一覧（Diff ビューの入口） */
export async function getGitStatus(projectRoot: string): Promise<GitStatusItem[]> {
  const status = await git(projectRoot).status()
  return status.files.map((f) => ({
    path: f.path,
    status: `${f.index}${f.working_dir}`.trim(),
    staged: f.index !== ' ' && f.index !== '?'
  }))
}

function assertPaths(paths: string[]): string[] {
  if (paths.length === 0) throw new BackendError('validation', '対象ファイルを1件以上選択してください', '')
  for (const path of paths) {
    if (!path || path.includes('..') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) {
      throw new BackendError('validation', `不正なパスです: ${path}`, '')
    }
  }
  return paths.map((path) => path.replaceAll('\\', '/'))
}

/** 選択ファイルをステージする（GIT-003）。 */
export async function stageGitFiles(projectRoot: string, paths: string[]): Promise<void> {
  await git(projectRoot).add(assertPaths(paths))
}

/** 選択ファイルのステージを解除する（GIT-003）。未コミットRepositoryにも対応する。 */
export async function unstageGitFiles(projectRoot: string, paths: string[]): Promise<void> {
  const safePaths = assertPaths(paths)
  if ((await getGitLog(projectRoot, 1)).length === 0) {
    await git(projectRoot).raw(['rm', '--cached', '--ignore-unmatch', '--', ...safePaths])
  } else {
    await git(projectRoot).raw(['reset', 'HEAD', '--', ...safePaths])
  }
}

export interface GitBranchState {
  current: string
  branches: string[]
}

/** ローカルブランチ一覧（GIT-003）。 */
export async function getGitBranches(projectRoot: string): Promise<GitBranchState> {
  const result = await git(projectRoot).branchLocal()
  return { current: result.current, branches: result.all }
}

/** ローカルブランチを作成して切り替える（GIT-003）。 */
export async function createGitBranch(projectRoot: string, branchName: string): Promise<GitBranchState> {
  if (!branchName.trim() || /[\r\n]/.test(branchName)) {
    throw new BackendError('validation', 'ブランチ名を入力してください', '')
  }
  await git(projectRoot).checkoutLocalBranch(branchName.trim())
  return getGitBranches(projectRoot)
}

/** 既存ローカルブランチへ切り替える（GIT-003）。 */
export async function checkoutGitBranch(projectRoot: string, branchName: string): Promise<GitBranchState> {
  const branches = await getGitBranches(projectRoot)
  if (!branches.branches.includes(branchName)) {
    throw new BackendError('validation', `存在しないローカルブランチです: ${branchName}`, '')
  }
  await git(projectRoot).checkout(branchName)
  return getGitBranches(projectRoot)
}

export interface GitCommitResult {
  hash: string
  shortHash: string
  message: string
}

/** 現在のステージ内容をコミットする。API層が生成済みexportsも事前にステージする（GIT-004/007）。 */
export async function commitGitChanges(
  projectRoot: string,
  message: string,
  authorName: string,
  authorEmail: string
): Promise<GitCommitResult> {
  const cleanMessage = message.trim()
  if (!cleanMessage || /[\r\n]/.test(cleanMessage)) {
    throw new BackendError('validation', 'コミットメッセージを1行で入力してください', '')
  }
  if (!authorName.trim() || /[\r\n]/.test(authorName) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(authorEmail)) {
    throw new BackendError('validation', 'コミット作成者名と有効なメールアドレスを入力してください', '')
  }
  await git(projectRoot).raw([
    '-c',
    `user.name=${authorName.trim()}`,
    '-c',
    `user.email=${authorEmail.trim()}`,
    'commit',
    '-m',
    cleanMessage
  ])
  const latest = (await getGitLog(projectRoot, 1))[0]
  if (!latest) throw new BackendError('internal', 'コミット結果を取得できませんでした', '')
  return { hash: latest.hash, shortHash: latest.shortHash, message: latest.message }
}
const HASH_PATTERN = /^[0-9a-fA-F]{4,40}$/

function assertHash(hash: string): void {
  if (!HASH_PATTERN.test(hash)) {
    throw new BackendError('validation', `不正なコミットハッシュです: ${hash}`, '')
  }
}

/** コミットの変更概要 + パッチ（GIT-005）。サイズ上限つき */
export async function getGitShow(projectRoot: string, hash: string, maxChars = 200_000): Promise<string> {
  assertHash(hash)
  const text = await git(projectRoot).show([hash, '--stat', '--patch', '--no-color'])
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n... （${text.length - maxChars} 文字省略）` : text
}

/**
 * 過去コミット時点のファイル内容（GIT-001/006）。
 * DB to Text 出力（exports/db_to_text/*.jsonl 等）を過去版と比較する用途。
 * 存在しない場合は空文字を返す（新規ファイルの比較を許容）。
 */
function assertRelativePath(relPath: string): string {
  if (!relPath || relPath.includes('..') || relPath.startsWith('/') || /^[A-Za-z]:/.test(relPath)) {
    throw new BackendError('validation', `不正なパスです: ${relPath}`, '')
  }
  return relPath.replaceAll('\\', '/')
}

export async function getGitFileAt(projectRoot: string, hash: string, relPath: string): Promise<string> {
  assertHash(hash)
  const safePath = assertRelativePath(relPath)
  try {
    return await git(projectRoot).show([`${hash}:${safePath}`])
  } catch {
    return ''
  }
}

/** 作業ツリーのファイルをHEADと比較するMonaco Diff用ペア（GIT-003/005）。 */
export async function getGitWorkingFilePair(
  projectRoot: string,
  relPath: string
): Promise<{ path: string; left: string; right: string }> {
  const path = assertRelativePath(relPath)
  let left = ''
  try {
    left = await git(projectRoot).show([`HEAD:${path}`])
  } catch {
    left = ''
  }
  let right = ''
  try {
    right = readFileSync(join(projectRoot, path), 'utf-8')
  } catch {
    right = ''
  }
  return { path, left, right }
}

/** 2コミット間で変更されたファイル一覧（GIT-005/006）。 */
export async function getGitComparisonFiles(projectRoot: string, fromHash: string, toHash: string): Promise<string[]> {
  assertHash(fromHash)
  assertHash(toHash)
  if (fromHash === toHash) return []
  const output = await git(projectRoot).raw(['diff', '--name-only', fromHash, toHash, '--'])
  return output
    .split(/\r?\n/)
    .map((path) => path.trim())
    .filter(Boolean)
}

/** 2コミット時点の同一ファイル内容を返す（GIT-005/006）。 */
export async function getGitComparisonFilePair(
  projectRoot: string,
  fromHash: string,
  toHash: string,
  relPath: string
): Promise<{ path: string; fromHash: string; toHash: string; left: string; right: string }> {
  assertHash(fromHash)
  assertHash(toHash)
  const path = assertRelativePath(relPath)
  const [left, right] = await Promise.all([
    getGitFileAt(projectRoot, fromHash, path),
    getGitFileAt(projectRoot, toHash, path)
  ])
  return { path, fromHash, toHash, left, right }
}
