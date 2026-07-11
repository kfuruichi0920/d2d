import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import {
  addArtifactRelation,
  deactivateArtifactRelation,
  deactivateArtifactSetting,
  listArtifactRelations,
  listArtifactSettings,
  listDevPhases,
  saveArtifactSetting,
  saveDevPhase
} from './project-settings'

describe('プロジェクト設定 CRUD（P2-1、CORE-012）', () => {
  let dir: string
  let db: Database
  let projectUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-ps-'))
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('成果物定義を作成・更新・一覧・無効化できる', () => {
    const created = saveArtifactSetting(db, projectUid, { artifactName: '要求仕様書', artifactTypeId: 'srs' })
    expect(created.artifact_name).toBe('要求仕様書')

    const updated = saveArtifactSetting(db, projectUid, {
      uid: created.uid,
      artifactName: '要求仕様書v2',
      artifactTypeId: 'srs',
      sortOrder: 5
    })
    expect(updated.artifact_name).toBe('要求仕様書v2')
    expect(updated.sort_order).toBe(5)

    deactivateArtifactSetting(db, projectUid, created.uid)
    const list = listArtifactSettings(db, projectUid)
    expect(list).toHaveLength(1)
    expect(list[0]!.is_active).toBe(0)
  })

  it('同名成果物は conflict になる', () => {
    saveArtifactSetting(db, projectUid, { artifactName: '基本設計書', artifactTypeId: 'bd' })
    expect(() =>
      saveArtifactSetting(db, projectUid, { artifactName: '基本設計書', artifactTypeId: 'bd2' })
    ).toThrowError(/既に存在/)
  })

  it('文書体系（親子関係）を追加・検証・無効化できる', () => {
    const srs = saveArtifactSetting(db, projectUid, { artifactName: '要求仕様書', artifactTypeId: 'srs' })
    const bd = saveArtifactSetting(db, projectUid, { artifactName: '基本設計書', artifactTypeId: 'bd' })

    const rel = addArtifactRelation(db, projectUid, { parentArtifactUid: srs.uid, childArtifactUid: bd.uid })
    expect(listArtifactRelations(db, projectUid)).toHaveLength(1)

    // 自己参照・重複・未存在参照の検証
    expect(() =>
      addArtifactRelation(db, projectUid, { parentArtifactUid: srs.uid, childArtifactUid: srs.uid })
    ).toThrowError(/同一の成果物/)
    expect(() =>
      addArtifactRelation(db, projectUid, { parentArtifactUid: srs.uid, childArtifactUid: bd.uid })
    ).toThrowError(/既に存在/)
    expect(() =>
      addArtifactRelation(db, projectUid, {
        parentArtifactUid: srs.uid,
        childArtifactUid: '018fe6c2-0000-7000-8000-000000000000'
      })
    ).toThrowError(/存在しません/)

    deactivateArtifactRelation(db, projectUid, rel.uid)
    expect(listArtifactRelations(db, projectUid)[0]!.is_active).toBe(0)
  })

  it('開発フェーズを作成・更新・一覧できる', () => {
    saveDevPhase(db, projectUid, { devPhaseId: 'RD', devPhaseName: '要求定義', sortOrder: 1 })
    saveDevPhase(db, projectUid, { devPhaseId: 'BD', devPhaseName: '基本設計', sortOrder: 2 })

    expect(() => saveDevPhase(db, projectUid, { devPhaseId: 'RD', devPhaseName: '重複' })).toThrowError(/既に存在/)

    const phases = listDevPhases(db, projectUid)
    expect(phases.map((p) => p.dev_phase_id)).toEqual(['RD', 'BD'])

    const rd = phases[0]!
    const updated = saveDevPhase(db, projectUid, { uid: rd.uid, devPhaseId: 'RD', devPhaseName: '要求定義（改）' })
    expect(updated.dev_phase_name).toBe('要求定義（改）')
  })
})
