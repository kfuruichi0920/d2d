import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from './database'
import { createProjectLayout } from '../project/layout'
import { saveBlobFromData, saveBlobFromFile, sha256OfBuffer, verifyBlob } from './blob-store'

describe('blob_resource 管理（P1-4）', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-blob-'))
    root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('originals はファイル名保持で uid サブディレクトリへ無改変コピーする（IMP-009 の基礎）', () => {
    const src = join(dir, 'spec.docx')
    writeFileSync(src, 'dummy-docx-content')

    const blob = saveBlobFromFile(db, {
      projectUid,
      projectRoot: root,
      category: 'originals',
      sourceFilePath: src,
      preserveFileName: true
    })

    expect(blob.relativePath).toBe(`blobs/originals/${blob.uid}/spec.docx`)
    expect(existsSync(blob.absolutePath)).toBe(true)
    expect(blob.sha256).toBe(sha256OfBuffer('dummy-docx-content'))
    expect(blob.mimeType).toContain('wordprocessingml')
    expect(blob.code).toMatch(/^BLOB-\d{6}$/)

    const row = db.prepare('SELECT * FROM blob_resource WHERE uid = ?').get(blob.uid) as {
      relative_path: string
      sha256: string
      byte_size: number
    }
    expect(row.relative_path).toBe(blob.relativePath)
    expect(row.byte_size).toBe(Buffer.byteLength('dummy-docx-content'))
  })

  it('データから blob を保存できる（figures 分類）', () => {
    const blob = saveBlobFromData(db, {
      projectUid,
      projectRoot: root,
      category: 'figures',
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      fileNameHint: 'diagram.png'
    })
    expect(blob.relativePath).toBe(`blobs/figures/${blob.uid}.png`)
    expect(blob.mimeType).toBe('image/png')
    expect(existsSync(blob.absolutePath)).toBe(true)
  })

  it('verifyBlob が存在・ハッシュ一致を検査する', () => {
    const blob = saveBlobFromData(db, {
      projectUid,
      projectRoot: root,
      category: 'tables',
      data: 'a,b,c\n1,2,3\n',
      fileNameHint: 'table.csv'
    })
    const ok = verifyBlob(db, root, blob.uid)
    expect(ok).toEqual({ uid: blob.uid, relativePath: blob.relativePath, exists: true, hashMatches: true })

    // 改変検出
    writeFileSync(blob.absolutePath, 'tampered')
    const ng = verifyBlob(db, root, blob.uid)
    expect(ng.hashMatches).toBe(false)
  })

  it('存在しないファイルの取込は io エラーになる', () => {
    expect(() =>
      saveBlobFromFile(db, {
        projectUid,
        projectRoot: root,
        category: 'originals',
        sourceFilePath: join(dir, 'missing.pdf')
      })
    ).toThrowError(/見つかりません/)
  })
})
