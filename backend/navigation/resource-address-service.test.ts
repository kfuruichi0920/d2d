import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { registerEntity } from '../store/entity-registry'
import { listResourceAddresses } from './resource-address-service'

describe('Resource URI一覧（P3-7、UI-057）', () => {
  let dir: string
  let db: Database
  let projectUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-address-'))
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('Resourceをcode順のリンクとして返し、削除済みは除外する', () => {
    const active = registerEntity(db, { projectUid, entityType: 'resource_text', title: '本文' })
    db.prepare("INSERT INTO resource_text (uid, text_body, text_role) VALUES (?, 'text', 'body')").run(active.uid)
    const deleted = registerEntity(db, { projectUid, entityType: 'resource_text', title: '削除' })
    db.prepare("INSERT INTO resource_text (uid, text_body, text_role) VALUES (?, 'deleted', 'body')").run(deleted.uid)
    db.prepare("UPDATE entity_registry SET status='deleted' WHERE uid=?").run(deleted.uid)

    expect(listResourceAddresses(db, projectUid, 'resource')).toEqual([
      expect.objectContaining({ uid: active.uid, uri: `resource://${active.uid}`, title: '本文' })
    ])
  })

  it('chunk://一覧はチャンクを持つ中間成果物Editorへのリンクを返す', () => {
    const doc = registerEntity(db, { projectUid, entityType: 'intermediate_document', title: '仕様' })
    db.prepare(
      "INSERT INTO intermediate_document (uid, artifact_type_id, dev_phase_id, structure_json) VALUES (?, 'spec', 'P1', '{\"elements\":[]}')"
    ).run(doc.uid)
    const chunk = registerEntity(db, { projectUid, entityType: 'chunk', title: 'チャンク1' })
    db.prepare('INSERT INTO chunk (uid, intermediate_document_uid) VALUES (?, ?)').run(chunk.uid, doc.uid)

    expect(listResourceAddresses(db, projectUid, 'chunk')).toEqual([
      expect.objectContaining({ uid: doc.uid, uri: `chunk://${doc.uid}`, title: '仕様' })
    ])
  })

  it('未対応schemeを拒否する', () => {
    expect(() => listResourceAddresses(db, projectUid, 'unknown')).toThrow('一覧表示できないResource URIです')
  })
})
