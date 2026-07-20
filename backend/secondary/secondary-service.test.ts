import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { INITIAL_SCHEMA_SQL } from '../db/schema/initial-schema'
import { registerEntity } from '../store/entity-registry'
import { addReviewComment, listItemRelations, listReviewComments } from './secondary-service'

describe('Secondary Side Bar 共通関係・Review（P3-9）', () => {
  let db: BetterSqlite3.Database
  const projectUid = '01900000-0000-7000-8000-000000000001'

  beforeEach(() => {
    db = new BetterSqlite3(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(INITIAL_SCHEMA_SQL)
    db.prepare(`INSERT INTO project (uid, name, schema_version) VALUES (?, 'Secondaryテスト', '1.5.0')`).run(projectUid)
  })
  afterEach(() => db.close())

  function text(title: string): { uid: string; code: string } {
    const entity = registerEntity(db, { projectUid, entityType: 'resource_text', title, status: 'approved' })
    db.prepare(`INSERT INTO resource_text (uid, text_body, text_role) VALUES (?, ?, 'body')`).run(entity.uid, title)
    return entity
  }

  function link(fromUid: string, toUid: string, direction: 'forward' | 'bidirectional' = 'forward'): void {
    const entity = registerEntity(db, { projectUid, entityType: 'trace_link', status: 'approved' })
    db.prepare(
      `INSERT INTO trace_link (uid,from_uid,to_uid,relation_type,direction,review_status) VALUES (?,?,?,'relates_to',?,'approved')`
    ).run(entity.uid, fromUid, toUid, direction)
  }

  it('選択アイテム基準の出力・入力・双方向と相手情報を返す', () => {
    const selected = text('選択対象')
    const outgoing = text('出力先')
    const incoming = text('入力元')
    const both = text('双方向先')
    const design = registerEntity(db, {
      projectUid,
      entityType: 'model_req',
      title: '設計モデル',
      status: 'approved'
    })
    db.prepare(`INSERT INTO model_req (uid, summary) VALUES (?, '要求')`).run(design.uid)
    link(selected.uid, outgoing.uid)
    link(incoming.uid, selected.uid)
    link(selected.uid, both.uid, 'bidirectional')
    link(selected.uid, design.uid)
    expect(listItemRelations(db, projectUid, selected.uid)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          other_uid: outgoing.uid,
          relative_direction: 'outgoing',
          open_uri: 'resource://' + outgoing.uid
        }),
        expect.objectContaining({ other_uid: incoming.uid, relative_direction: 'incoming' }),
        expect.objectContaining({ other_uid: both.uid, relative_direction: 'bidirectional' }),
        expect.objectContaining({ other_uid: design.uid, open_uri: 'design://' + design.uid })
      ])
    )
  })

  it('コメントResourceと対象へのrelates_toを同一トランザクションで保存する', () => {
    const target = text('レビュー対象')
    const comment = addReviewComment(db, projectUid, target.uid, '  条件を追記してください  ')
    expect(comment.body).toBe('条件を追記してください')
    expect(listReviewComments(db, projectUid, target.uid)).toEqual([
      expect.objectContaining({ uid: comment.uid, body: '条件を追記してください' })
    ])
    expect(
      db
        .prepare(`SELECT relation_type,from_uid,to_uid FROM trace_link WHERE from_uid=? AND to_uid=?`)
        .get(comment.uid, target.uid)
    ).toMatchObject({ relation_type: 'relates_to' })
  })

  it('空コメントと別プロジェクトの対象を拒否する', () => {
    const target = text('対象')
    expect(() => addReviewComment(db, projectUid, target.uid, '   ')).toThrow(/入力/)
    expect(() => addReviewComment(db, '01900000-0000-7000-8000-000000000002', target.uid, 'コメント')).toThrow(
      /見つかりません/
    )
  })
})
