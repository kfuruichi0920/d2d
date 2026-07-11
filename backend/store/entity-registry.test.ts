import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from './database'
import { getEntity, nextCode, registerEntity, updateEntityStatus } from './entity-registry'

describe('entity_registry 台帳・採番（P1-2）', () => {
  let dir: string
  let db: Database
  let projectUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-reg-'))
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('entity_type prefix で 6桁ゼロ埋め採番する（TEXT-000001, 000002...）', () => {
    const a = registerEntity(db, { projectUid, entityType: 'resource_text', title: '本文1' })
    const b = registerEntity(db, { projectUid, entityType: 'resource_text', title: '本文2' })
    expect(a.code).toBe('TEXT-000001')
    expect(b.code).toBe('TEXT-000002')
    expect(a.uid).not.toBe(b.uid)
  })

  it('design_category 指定時は分類 prefix で採番する（REQ-000001）', () => {
    const req = registerEntity(db, {
      projectUid,
      entityType: 'resource_text',
      designCategory: 'REQ',
      title: 'ログインできること'
    })
    expect(req.code).toBe('REQ-000001')
    const row = getEntity(db, req.uid)
    expect(row.design_category).toBe('REQ')
    expect(row.entity_type).toBe('resource_text')
  })

  it('IF/DATA 分類は entity_type prefix と同一連番空間になる（§10.1）', () => {
    const byType = registerEntity(db, { projectUid, entityType: 'resource_interface' }) // IF-000001
    const byCategory = registerEntity(db, {
      projectUid,
      entityType: 'resource_table',
      designCategory: 'IF'
    })
    expect(byType.code).toBe('IF-000001')
    expect(byCategory.code).toBe('IF-000002')
  })

  it('欠番許容: 論理削除後も再採番しない', () => {
    const a = registerEntity(db, { projectUid, entityType: 'resource_figure' })
    updateEntityStatus(db, a.uid, 'deleted')
    const b = registerEntity(db, { projectUid, entityType: 'resource_figure' })
    expect(a.code).toBe('FIG-000001')
    expect(b.code).toBe('FIG-000002') // FIG-000001 を再利用しない
  })

  it('nextCode は既存の最大値+1 を返す', () => {
    registerEntity(db, { projectUid, entityType: 'resource_model' })
    expect(nextCode(db, 'MODEL')).toBe('MODEL-000002')
    expect(nextCode(db, 'CHUNK')).toBe('CHUNK-000001')
  })

  it('updateEntityStatus は updated_at / updated_by を更新する', () => {
    const a = registerEntity(db, { projectUid, entityType: 'resource_text', createdBy: 'user' })
    updateEntityStatus(db, a.uid, 'approved', 'reviewer')
    const row = db.prepare('SELECT status, updated_by FROM entity_registry WHERE uid = ?').get(a.uid) as {
      status: string
      updated_by: string
    }
    expect(row.status).toBe('approved')
    expect(row.updated_by).toBe('reviewer')
  })

  it('存在しない uid の状態更新は not_found エラーになる', () => {
    expect(() => updateEntityStatus(db, '018fe6c2-0000-7000-8000-000000000000', 'approved')).toThrowError(
      /見つかりません/
    )
  })
})
