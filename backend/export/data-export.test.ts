import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import AdmZip from 'adm-zip'
import { simpleGit } from 'simple-git'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { registerEntity } from '../store/entity-registry'
import { exportDbToText, exportSqliteDump, listExportTables } from './db-to-text-service'
import {
  createArchive,
  getArchiveDiffContent,
  importArchiveForDiff,
  listArchives,
  type ArchiveManifest
} from './archive-service'
import {
  checkoutGitBranch,
  commitGitChanges,
  createGitBranch,
  getGitBranches,
  getGitFileAt,
  getGitLog,
  getGitShow,
  getGitStatus,
  isGitRepo,
  stageGitFiles,
  unstageGitFiles
} from '../git/git-service'

describe('P12 データ出力・アーカイブ・Git', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-data-'))
    root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'p12' })
    projectUid = getProjectRow(db).uid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  function addRequirement(title: string): { uid: string; code: string } {
    const created = registerEntity(db, {
      projectUid,
      entityType: 'resource_text',
      designCategory: 'REQ',
      title,
      createdBy: 'user'
    })
    db.prepare(
      `INSERT INTO resource_text (uid, text_body, text_role, language) VALUES (?, ?, 'description', 'ja')`
    ).run(created.uid, `本文: ${title}`)
    return created
  }

  describe('DB to Text（P12-1、DATA-020〜023）', () => {
    it('全テーブルを安定順序の JSONL で出力し、同一内容から同一バイト列を生成する', () => {
      addRequirement('応答時間要求')
      const first = exportDbToText(db, projectUid, root)
      expect(first.files).toContain('entity_registry.jsonl')
      expect(first.files).toContain('elements.md')

      const registry1 = readFileSync(join(first.outDir, 'entity_registry.jsonl'), 'utf-8')
      expect(registry1).toContain('REQ-000001')

      // 再出力で同一バイト列（DATA-020 安定順序、タイムスタンプ非含有）
      const second = exportDbToText(db, projectUid, root)
      const registry2 = readFileSync(join(second.outDir, 'entity_registry.jsonl'), 'utf-8')
      expect(registry2).toBe(registry1)
    })

    it('要素一覧・関係一覧・マトリクスを Markdown/CSV で出力する（DATA-021）', () => {
      addRequirement('第一要求')
      const { outDir } = exportDbToText(db, projectUid, root)
      expect(readFileSync(join(outDir, 'elements.md'), 'utf-8')).toContain('REQ-000001')
      expect(readFileSync(join(outDir, 'elements.csv'), 'utf-8')).toContain('第一要求')
      expect(existsSync(join(outDir, 'relations.csv'))).toBe(true)
      expect(existsSync(join(outDir, 'matrix_REQ_FUNC.csv'))).toBe(true)
    })

    it('FTS 仮想テーブル・影テーブルはエクスポート対象から除外する', () => {
      const names = listExportTables(db).map((t) => t.name)
      expect(names).toContain('entity_registry')
      expect(names.some((n) => n.includes('fts'))).toBe(false)
    })

    it('SQLite dump: schema.sql / data.sql を出力する（P12-2）', () => {
      addRequirement('ダンプ対象')
      const { outDir } = exportSqliteDump(db, root)
      expect(readFileSync(join(outDir, 'schema.sql'), 'utf-8')).toContain('CREATE TABLE')
      const data = readFileSync(join(outDir, 'data.sql'), 'utf-8')
      expect(data).toContain('INSERT INTO entity_registry')
      expect(data).toContain('ダンプ対象')
    })
  })

  describe('ZIP アーカイブ（P12-3/P12-4、DATA-003/004/030〜033）', () => {
    it('manifest 付き ZIP を archives/ へ生成し、archive.list で列挙できる', () => {
      addRequirement('アーカイブ要求')
      const result = createArchive(db, projectUid, root, { name: 'test' })
      expect(existsSync(result.zipPath)).toBe(true)

      const zip = new AdmZip(result.zipPath)
      const manifest = JSON.parse(zip.getEntry('manifest.json')!.getData().toString('utf-8')) as ArchiveManifest
      expect(manifest.schema_version).toBe(getProjectRow(db).schema_version)
      expect(manifest.artifact_summary.design_elements).toBe(1)
      // ファイル役割識別（DATA-004）
      expect(manifest.files.find((f) => f.path === 'project.db')?.role).toBe('db')
      expect(manifest.files.some((f) => f.path.startsWith('exports/') && f.role === 'export')).toBe(true)
      // DB to Text が同梱される
      expect(zip.getEntry('exports/db_to_text/entity_registry.jsonl')).toBeTruthy()

      expect(listArchives(root).map((a) => a.fileName)).toContain(result.fileName)
    })

    it('差分インポート: 変更を検出し、正本は上書きしない（DATA-007/031/032、NFR-014）', () => {
      const req = addRequirement('差分前タイトル')
      const archive = createArchive(db, projectUid, root)

      // アーカイブ後に正本を変更（タイトル変更 + 要素追加）
      db.prepare(`UPDATE entity_registry SET title = ? WHERE uid = ?`).run('差分後タイトル', req.uid)
      addRequirement('追加要求')
      const dbBytesBefore = db.pragma('page_count', { simple: true })

      const diff = importArchiveForDiff(db, projectUid, root, archive.fileName)
      const registryDiff = diff.tables.find((t) => t.file === 'entity_registry.jsonl')
      expect(registryDiff).toBeTruthy()
      expect(registryDiff!.changed).toBeGreaterThanOrEqual(1) // タイトル変更
      expect(registryDiff!.added).toBeGreaterThanOrEqual(1) // 追加要求

      // 正本 DB は変更されていない（DATA-032）
      expect(db.pragma('page_count', { simple: true })).toBe(dbBytesBefore)
      expect(
        (db.prepare(`SELECT title FROM entity_registry WHERE uid = ?`).get(req.uid) as { title: string }).title
      ).toBe('差分後タイトル')

      // Diff ビュー用の左右テキスト（左=アーカイブ=旧、右=現在）
      const pair = getArchiveDiffContent('entity_registry.jsonl')
      expect(pair.left).toContain('差分前タイトル')
      expect(pair.right).toContain('差分後タイトル')
    })

    it('manifest の無い ZIP は差分インポートを拒否する（DATA-003）', () => {
      const zip = new AdmZip()
      zip.addFile('dummy.txt', Buffer.from('x'))
      const badPath = join(root, 'archives', 'bad.zip')
      zip.writeZip(badPath)
      expect(() => importArchiveForDiff(db, projectUid, root, 'bad.zip')).toThrowError(/manifest/)
    })
  })

  describe('Git連携（P12-5、GIT-001〜007）', () => {
    it('非リポジトリでは isRepo=false を返す', async () => {
      expect(await isGitRepo(root)).toBe(false)
    })

    it('ステージ・解除・テキスト化コミット・ローカルブランチ操作ができる（GIT-003/004/007）', async () => {
      const repository = simpleGit({ baseDir: root })
      await repository.init()
      addRequirement('コミット対象要求')
      exportDbToText(db, projectUid, root)
      exportSqliteDump(db, root)

      await stageGitFiles(root, ['exports/db_to_text', 'exports/sqlite_dump'])
      expect(
        (await getGitStatus(root)).some((file) => file.path.endsWith('entity_registry.jsonl') && file.staged)
      ).toBe(true)
      await unstageGitFiles(root, ['exports/sqlite_dump/schema.sql'])
      expect((await getGitStatus(root)).find((file) => file.path.endsWith('schema.sql'))?.staged).toBe(false)
      await stageGitFiles(root, ['exports/sqlite_dump'])

      const committed = await commitGitChanges(root, 'D2Dテキストスナップショット', 'D2D Test', 'd2d@example.test')
      expect(committed.message).toBe('D2Dテキストスナップショット')
      expect(await getGitFileAt(root, committed.hash, 'exports/sqlite_dump/schema.sql')).toContain('CREATE TABLE')
      expect(await getGitFileAt(root, committed.hash, 'exports/db_to_text/entity_registry.jsonl')).toContain(
        'コミット対象要求'
      )

      const initialBranch = (await getGitBranches(root)).current
      const created = await createGitBranch(root, 'review/snapshot')
      expect(created.current).toBe('review/snapshot')
      expect((await getGitBranches(root)).branches).toContain('review/snapshot')
      expect((await checkoutGitBranch(root, initialBranch)).current).toBe(initialBranch)
    }, 15_000)
    it('履歴・patch・過去版ファイル内容を読み取り専用で参照できる', async () => {
      // 履歴比較用の既存コミットをテスト前提として準備する。
      const git = simpleGit({ baseDir: root })
      await git.init()
      await git.addConfig('user.email', 'test@example.com')
      await git.addConfig('user.name', 'test')
      writeFileSync(join(root, 'exports', 'db_to_text', 'sample.jsonl'), '{"uid":"a","title":"v1"}\n', 'utf-8')
      await git.add('.')
      await git.commit('first')
      writeFileSync(join(root, 'exports', 'db_to_text', 'sample.jsonl'), '{"uid":"a","title":"v2"}\n', 'utf-8')
      await git.add('.')
      await git.commit('second')

      expect(await isGitRepo(root)).toBe(true)
      const log = await getGitLog(root)
      expect(log).toHaveLength(2)
      expect(log[0]!.message).toBe('second')

      const patch = await getGitShow(root, log[0]!.hash)
      expect(patch).toContain('sample.jsonl')
      expect(patch).toContain('+{"uid":"a","title":"v2"}')

      // GIT-001/006: 過去コミット時点の DB to Text 内容
      const old = await getGitFileAt(root, log[1]!.hash, 'exports/db_to_text/sample.jsonl')
      expect(old).toContain('"v1"')
      // 不正ハッシュ・パスは拒否
      await expect(getGitShow(root, 'x; rm -rf')).rejects.toThrowError(/ハッシュ/)
      await expect(getGitFileAt(root, log[0]!.hash, '../outside')).rejects.toThrowError(/パス/)
    }, 15_000)
  })
})
