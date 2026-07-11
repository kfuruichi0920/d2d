import BetterSqlite3 from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { INITIAL_SCHEMA_SQL } from '../db/schema/initial-schema'
import { registerEntity } from '../store/entity-registry'
import { rebuildSearchIndex, searchElements } from './search-service'

describe('P11 MeCab + FTS5 検索', () => {
  let db: BetterSqlite3.Database
  const projectUid = '01900000-0000-7000-8000-000000000001'

  beforeEach(() => {
    db = new BetterSqlite3(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(INITIAL_SCHEMA_SQL)
    db.prepare(`INSERT INTO project (uid, name, schema_version) VALUES (?, '検索テスト', '1.0.0')`).run(projectUid)
  })
  afterEach(() => db.close())

  function text(title: string, body: string, status: 'draft' | 'deleted' = 'draft') {
    const entity = registerEntity(db, { projectUid, entityType: 'resource_text', title, status })
    db.prepare(`INSERT INTO resource_text (uid, text_body, text_role, language) VALUES (?, ?, 'body', 'ja')`).run(
      entity.uid,
      body
    )
    return entity
  }

  it('タイトルと日本語本文を索引化し、Resource URIを返す', () => {
    const target = text('ブレーキ制御要求', '車輪の滑りを検出して制動力を調整する')
    const response = searchElements(db, projectUid, '制動力', {})
    expect(response.tokenizer).toBe('unicode')
    expect(response.results[0]).toMatchObject({ uid: target.uid, resourceUri: `design://${target.uid}` })
    expect(response.indexCount).toBe(1)
  })

  it('code前方一致とuid完全一致に対応する', () => {
    const target = text('通信要求', 'CAN通信を監視する')
    expect(searchElements(db, projectUid, target.code.slice(0, -2), {}).results[0]?.uid).toBe(target.uid)
    expect(searchElements(db, projectUid, target.uid, {}).results[0]?.uid).toBe(target.uid)
  })

  it('レビュー記録を検索し、deletedは索引から除外する', () => {
    const target = text('電源要求', '電圧を監視する')
    db.prepare(`UPDATE entity_registry SET review_info_json = ? WHERE uid = ?`).run(
      JSON.stringify({ comments: [{ body: 'フェイルセーフ条件を追記してください' }] }),
      target.uid
    )
    text('削除済み', 'フェイルセーフ条件', 'deleted')
    const response = searchElements(db, projectUid, 'フェイルセーフ', {})
    expect(response.results.map((r) => r.uid)).toEqual([target.uid])
    expect(response.indexCount).toBe(1)
  })

  it('存在しないMeCabパスではUnicodeフォールバックを使う', () => {
    text('診断要求', '故障を診断する')
    const rebuilt = rebuildSearchIndex(db, projectUid, { mecabPath: 'Z:\\missing\\mecab.exe' })
    expect(rebuilt.tokenizer).toBe('unicode')
    expect(rebuilt.warning).toContain('MeCab が見つかりません')
  })
})
