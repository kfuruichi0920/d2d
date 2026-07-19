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

  function text(title: string, body: string, status: 'draft' | 'deleted' = 'draft'): { uid: string; code: string } {
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
    expect(response.results[0]).toMatchObject({ uid: target.uid, resourceUri: `resource://${target.uid}` })
    expect(response.indexCount).toBe(1)
  })

  it('code前方一致とuid完全一致に対応する', () => {
    const target = text('通信要求', 'CAN通信を監視する')
    expect(searchElements(db, projectUid, target.code.slice(0, -2), {}).results[0]?.uid).toBe(target.uid)
    expect(searchElements(db, projectUid, target.uid, {}).results[0]?.uid).toBe(target.uid)
  })

  it('LIKEフォールバックは%と_を文字として検索する', () => {
    const target = text('特殊文字', '進捗率は100%_完了')
    expect(searchElements(db, projectUid, '%_', {}, { entityType: 'resource_text' }).results[0]?.uid).toBe(target.uid)
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

  it('文書種別検索は配下要素本文を検索し、文書内選択先を返す（SEARCH-001/003）', () => {
    const source = registerEntity(db, { projectUid, entityType: 'source_document', title: '要求原本' })
    db.prepare(
      "INSERT INTO source_document (uid, file_name, file_type, file_hash) VALUES (?, 'req.docx', 'word', 'hash')"
    ).run(source.uid)
    const extracted = registerEntity(db, { projectUid, entityType: 'extracted_document', title: '抽出要求' })
    db.prepare("INSERT INTO extracted_document (uid, source_document_uid, structure_json) VALUES (?, ?, '{}')").run(
      extracted.uid,
      source.uid
    )
    const resource = text('制御要求要素', '緊急停止時は駆動力を遮断する')
    const item = registerEntity(db, { projectUid, entityType: 'extracted_item', title: '要求段落' })
    db.prepare(
      "INSERT INTO extracted_item (uid, extracted_document_uid, source_document_uid, item_type, resource_uid) VALUES (?, ?, ?, 'resource_text', ?)"
    ).run(item.uid, extracted.uid, source.uid, resource.uid)

    const extractedResult = searchElements(db, projectUid, '駆動力', {}, { entityType: 'extracted_document' })
      .results[0]
    expect(extractedResult).toMatchObject({
      entityType: 'extracted_document',
      resourceUri: `extracted://${extracted.uid}`,
      targetItemUid: item.uid,
      targetResourceUid: resource.uid
    })
    const sourceResult = searchElements(db, projectUid, '駆動力', {}, { entityType: 'source_document' }).results[0]
    expect(sourceResult).toMatchObject({
      entityType: 'source_document',
      resourceUri: `extracted://${extracted.uid}`,
      targetItemUid: item.uid
    })
  })

  it('中間文書検索は配下要素本文を検索し、中間要素の選択先を返す', () => {
    const intermediate = registerEntity(db, { projectUid, entityType: 'intermediate_document', title: 'SW要求仕様書' })
    db.prepare(
      "INSERT INTO intermediate_document (uid, artifact_type_id, dev_phase_id, structure_json) VALUES (?, 'SRS', 'SWA', '{}')"
    ).run(intermediate.uid)
    const resource = text('監視要求', '通信タイムアウトを監視する')
    const item = registerEntity(db, { projectUid, entityType: 'intermediate_item', title: '監視段落' })
    db.prepare(
      "INSERT INTO intermediate_item (uid, intermediate_document_uid, item_type, resource_uid) VALUES (?, ?, 'resource_text', ?)"
    ).run(item.uid, intermediate.uid, resource.uid)
    expect(
      searchElements(db, projectUid, 'タイムアウト', {}, { entityType: 'intermediate_document' }).results[0]
    ).toMatchObject({
      resourceUri: `intermediate://${intermediate.uid}`,
      targetItemUid: item.uid,
      targetResourceUid: resource.uid
    })
  })

  it('MeCab設定済みでも利用フラグのデフォルトは無効', () => {
    text('既定無効', 'MeCabを起動しない')
    const rebuilt = rebuildSearchIndex(db, projectUid, { mecabPath: process.execPath })
    expect(rebuilt.tokenizer).toBe('unicode')
    expect(rebuilt.warning).toBeUndefined()
  })
  it('存在しないMeCabパスではUnicodeフォールバックを使う', () => {
    text('診断要求', '故障を診断する')
    const rebuilt = rebuildSearchIndex(db, projectUid, { useMecab: true, mecabPath: 'Z:\\missing\\mecab.exe' })
    expect(rebuilt.tokenizer).toBe('unicode')
    expect(rebuilt.warning).toContain('MeCab が見つかりません')
  })
})
