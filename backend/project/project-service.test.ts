import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { closeProject, createProject, currentProject, openProject } from './project-service'
import { PROJECT_DIRECTORIES } from './layout'

describe('プロジェクト作成・オープン（P1-3 / P1-5）', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-prj-'))
  })

  afterEach(() => {
    closeProject()
    rmSync(dir, { recursive: true, force: true })
  })

  it('createProject がレイアウト一式と project.d2d / project.db を生成する', () => {
    const root = join(dir, 'proj1')
    const info = createProject(
      { rootPath: root, name: 'サンプル', description: '説明' },
      {
        initializeGitRepository(projectRoot) {
          mkdirSync(join(projectRoot, '.git'))
        }
      }
    )

    expect(info.name).toBe('サンプル')
    expect(info.schemaVersion).toBe('2.3.0')
    expect(info.code).toBe('PRJ-000001')

    // sdd_directory §2 のディレクトリ構成
    for (const d of PROJECT_DIRECTORIES) {
      expect(existsSync(join(root, d)), `${d} が生成されること`).toBe(true)
    }
    expect(existsSync(join(root, 'project.d2d'))).toBe(true)
    expect(existsSync(join(root, 'project.db'))).toBe(true)
    expect(existsSync(join(root, '.gitignore'))).toBe(true)
    expect(existsSync(join(root, '.gitattributes'))).toBe(true)
    expect(existsSync(join(root, '.git'))).toBe(true)

    // CORE-013: 標準の5フェーズ・18成果物を作成時点で利用できる。
    const db = currentProject()!.db
    const phases = db.prepare('SELECT dev_phase_name FROM project_dev_phase_setting ORDER BY sort_order').all() as {
      dev_phase_name: string
    }[]
    expect(phases.map((phase) => phase.dev_phase_name)).toEqual([
      'システム設計',
      'SW要求分析',
      '外部設計',
      '内部設計',
      '全般'
    ])
    expect((db.prepare('SELECT COUNT(*) AS n FROM project_artifact_setting').get() as { n: number }).n).toBe(18)
    expect(
      (
        db.prepare("SELECT COUNT(*) AS n FROM project_artifact_setting WHERE artifact_name='レビュー記録'").get() as {
          n: number
        }
      ).n
    ).toBe(4)

    // project.d2d は相対参照のみ（絶対パスを含まない）
    const d2d = JSON.parse(readFileSync(join(root, 'project.d2d'), 'utf-8'))
    expect(d2d.d2d_version).toBe('1')
    expect(d2d.project_uid).toBe(info.projectUid)
    expect(JSON.stringify(d2d)).not.toContain(root.replaceAll('\\', '\\\\'))
  })

  it('Git初期化を無効化でき、初期化失敗時もプロジェクト作成を継続する（CORE-047）', () => {
    const disabledInitializer = vi.fn()
    const disabledRoot = join(dir, 'git-disabled')
    createProject(
      { rootPath: disabledRoot, name: 'git-disabled', initializeGit: false },
      { initializeGitRepository: disabledInitializer }
    )
    expect(disabledInitializer).not.toHaveBeenCalled()
    closeProject()

    const failedRoot = join(dir, 'git-failed')
    const info = createProject(
      { rootPath: failedRoot, name: 'git-failed' },
      {
        initializeGitRepository() {
          throw new Error('git command failed')
        }
      }
    )
    expect(info.name).toBe('git-failed')
    expect(existsSync(join(failedRoot, 'project.d2d'))).toBe(true)
  })
  it('openProject が project.d2d 経由で開き、uid 整合を検証する', () => {
    const root = join(dir, 'proj2')
    const created = createProject({ rootPath: root, name: 'p2' })
    closeProject()

    const opened = openProject({ path: join(root, 'project.d2d') })
    expect(opened.projectUid).toBe(created.projectUid)
    expect(opened.name).toBe('p2')
    expect(currentProject()?.info.projectUid).toBe(created.projectUid)
  })

  it('ディレクトリ指定でも開ける', () => {
    const root = join(dir, 'proj3')
    const created = createProject({ rootPath: root, name: 'p3' })
    closeProject()
    const opened = openProject({ path: root })
    expect(opened.projectUid).toBe(created.projectUid)
  })

  it('壊れた project.d2d は validation エラーになる（P1-5 ajv）', () => {
    const root = join(dir, 'proj4')
    createProject({ rootPath: root, name: 'p4' })
    closeProject()

    const bad = join(root, 'project.d2d')
    // project_uid を不正値に書き換える
    const content = JSON.parse(readFileSync(bad, 'utf-8'))
    content.project_uid = 'not-a-uuid'
    writeFileSync(bad, JSON.stringify(content))

    expect(() => openProject({ path: bad })).toThrowError(/スキーマに適合しません/)
  })

  it('既存プロジェクトのあるフォルダへの作成は conflict になる', () => {
    const root = join(dir, 'proj5')
    createProject({ rootPath: root, name: 'p5' })
    closeProject()
    expect(() => createProject({ rootPath: root, name: 'p5b' })).toThrowError(/既にプロジェクト/)
  })

  it('プロジェクト切替: open が現在のプロジェクトを差し替える（CORE-011）', () => {
    const rootA = join(dir, 'projA')
    const rootB = join(dir, 'projB')
    createProject({ rootPath: rootA, name: 'A' })
    closeProject()
    createProject({ rootPath: rootB, name: 'B' })
    closeProject()

    openProject({ path: rootA })
    expect(currentProject()?.info.name).toBe('A')
    openProject({ path: rootB })
    expect(currentProject()?.info.name).toBe('B')
  })
})
