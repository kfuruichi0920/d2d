import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { updateExtractedItemStatuses } from './review-service'

describe('抽出レビュー状態一括更新（P5-6、EXT-021/022/041）', () => {
  let db: Database.Database | undefined

  beforeEach(() => {
    db = new Database(':memory:')
    db.exec(`
      CREATE TABLE entity_registry (
        uid TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        updated_by TEXT,
        updated_at TEXT
      );
      CREATE TABLE extracted_item (
        extracted_document_uid TEXT NOT NULL,
        resource_uid TEXT NOT NULL
      );
      INSERT INTO entity_registry(uid, status, entity_type) VALUES
        ('doc1', 'draft', 'extracted_document'), ('doc2', 'draft', 'extracted_document'),
        ('r1', 'draft', 'resource_text'), ('r2', 'draft', 'resource_text'), ('other', 'draft', 'resource_text');
      INSERT INTO extracted_item(extracted_document_uid, resource_uid) VALUES ('doc1', 'r1'), ('doc1', 'r2'), ('doc2', 'other');
    `)
  })

  afterEach(() => db?.close())

  it('非連続の複数要素を更新し、全要素確定時だけ文書を確定する', () => {
    expect(updateExtractedItemStatuses(db!, 'doc1', ['r1', 'r2'], 'approved')).toEqual({ updatedCount: 2 })
    expect(db!.prepare(`SELECT uid, status FROM entity_registry WHERE uid IN ('r1', 'r2') ORDER BY uid`).all()).toEqual(
      [
        { uid: 'r1', status: 'approved' },
        { uid: 'r2', status: 'approved' }
      ]
    )
    expect(db!.prepare(`SELECT status FROM entity_registry WHERE uid = 'doc1'`).get()).toEqual({ status: 'approved' })
    updateExtractedItemStatuses(db!, 'doc1', ['r1'], 'review')
    expect(db!.prepare(`SELECT status FROM entity_registry WHERE uid = 'doc1'`).get()).toEqual({ status: 'draft' })
  })

  it('別文書の要素を含む場合は全更新をロールバックする', () => {
    expect(() => updateExtractedItemStatuses(db!, 'doc1', ['r1', 'other'], 'rejected')).toThrowError(/属さない/)
    expect(db!.prepare(`SELECT status FROM entity_registry WHERE uid = 'r1'`).get()).toEqual({ status: 'draft' })
  })
})
