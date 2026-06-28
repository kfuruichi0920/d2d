// T802: Git 連携 — simple-git でプロジェクトディレクトリを管理

import simpleGit, { type SimpleGit, type DefaultLogFields } from 'simple-git'
import path from 'path'
import { getProjectRoot } from '../project/project-manager'

function git(): SimpleGit {
  return simpleGit(getProjectRoot())
}

export interface GitCommit {
  hash: string
  date: string
  message: string
  author_name: string
  author_email: string
}

export interface GitStatusResult {
  isRepo: boolean
  branch: string
  ahead: number
  behind: number
  files: Array<{ path: string; index: string; working_dir: string }>
}

// ---- 初期化 -----------------------------------------------------------------

export async function initGit(): Promise<void> {
  const g = git()
  const isRepo = await g.checkIsRepo().catch(() => false)
  if (!isRepo) {
    await g.init()
    await g.addConfig('user.name', 'D2D')
    await g.addConfig('user.email', 'd2d@local')
  }
}

// ---- ステータス -------------------------------------------------------------

export async function gitStatus(): Promise<GitStatusResult> {
  const g = git()
  try {
    const isRepo = await g.checkIsRepo()
    if (!isRepo) return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [] }

    const status = await g.status()
    return {
      isRepo: true,
      branch: status.current ?? 'HEAD',
      ahead: status.ahead,
      behind: status.behind,
      files: status.files.map((f) => ({
        path: f.path,
        index: f.index,
        working_dir: f.working_dir,
      })),
    }
  } catch {
    return { isRepo: false, branch: '', ahead: 0, behind: 0, files: [] }
  }
}

// ---- ログ -------------------------------------------------------------------

export async function gitLog(limit = 30): Promise<GitCommit[]> {
  const g = git()
  const log = await g.log({ maxCount: limit })
  return (log.all as ReadonlyArray<DefaultLogFields>).map((c) => ({
    hash: c.hash,
    date: c.date,
    message: c.message,
    author_name: c.author_name,
    author_email: c.author_email,
  }))
}

// ---- コミット ---------------------------------------------------------------

export async function gitCommit(message: string, addAll = true): Promise<string> {
  const g = git()
  if (addAll) await g.add('.')
  const result = await g.commit(message)
  return result.commit
}

// ---- Diff -------------------------------------------------------------------

export async function gitDiff(fromHash?: string, toHash?: string): Promise<string> {
  const g = git()
  if (fromHash && toHash) {
    return g.diff([`${fromHash}..${toHash}`])
  }
  if (fromHash) {
    return g.diff([fromHash, 'HEAD'])
  }
  // 未コミット変更
  return g.diff(['HEAD'])
}

export async function gitShow(hash: string): Promise<string> {
  const g = git()
  return g.show([hash, '--stat', '--patch'])
}

// ---- ファイルログ -----------------------------------------------------------

export async function gitFileLog(filePath: string, limit = 20): Promise<GitCommit[]> {
  const g = git()
  const projectRoot = getProjectRoot()
  const rel = path.relative(projectRoot, filePath)
  const log = await g.log({ file: rel, maxCount: limit })
  return (log.all as ReadonlyArray<DefaultLogFields>).map((c) => ({
    hash: c.hash,
    date: c.date,
    message: c.message,
    author_name: c.author_name,
    author_email: c.author_email,
  }))
}
