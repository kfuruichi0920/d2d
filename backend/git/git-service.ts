/**
 * Git 履歴参照（P12-5、GIT-001/002/005/006/007）。
 * simple-git による読み取り専用参照に限定する。コミット・プッシュ等の書込み操作は
 * 本ツールでは一切実行せず、ユーザがツール外の Git 操作として行う（GIT-007）。
 */
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
}

/** 作業ツリーの変更一覧（Diff ビューの入口） */
export async function getGitStatus(projectRoot: string): Promise<GitStatusItem[]> {
  const status = await git(projectRoot).status()
  return status.files.map((f) => ({ path: f.path, status: `${f.index}${f.working_dir}`.trim() }))
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
export async function getGitFileAt(projectRoot: string, hash: string, relPath: string): Promise<string> {
  assertHash(hash)
  if (relPath.includes('..') || relPath.startsWith('/') || /^[A-Za-z]:/.test(relPath)) {
    throw new BackendError('validation', `不正なパスです: ${relPath}`, '')
  }
  try {
    return await git(projectRoot).show([`${hash}:${relPath.replaceAll('\\', '/')}`])
  } catch {
    return ''
  }
}
