/**
 * Workbench共通Secondary Side Barの関係・Reviewコメントサービス（P3-9、UI-026/040）。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { registerEntity } from '../store/entity-registry'

export interface SecondaryRelationRow {
  uid: string
  code: string
  relation_type: string
  link_direction: 'forward' | 'bidirectional'
  relative_direction: 'outgoing' | 'incoming' | 'bidirectional'
  other_uid: string
  other_code: string
  other_title: string | null
  other_entity_type: string
  open_uri: string | null
  rationale: string | null
  created_at: string
}

export interface ReviewCommentRow {
  uid: string
  code: string
  body: string
  created_at: string
  created_by: string | null
}

function requireTarget(db: Database, projectUid: string, itemUid: string): void {
  const row = db
    .prepare(`SELECT 1 FROM entity_registry WHERE uid=? AND project_uid=? AND status <> 'deleted'`)
    .get(itemUid, projectUid)
  if (!row) throw new BackendError('not_found', `選択アイテムが見つかりません: ${itemUid}`, '')
}

export function listItemRelations(db: Database, projectUid: string, itemUid: string): SecondaryRelationRow[] {
  requireTarget(db, projectUid, itemUid)
  return db
    .prepare(
      `SELECT t.uid, le.code, t.relation_type, t.direction AS link_direction,
              CASE WHEN t.direction='bidirectional' THEN 'bidirectional'
                   WHEN t.from_uid=? THEN 'outgoing' ELSE 'incoming' END AS relative_direction,
              CASE WHEN t.from_uid=? THEN t.to_uid ELSE t.from_uid END AS other_uid,
              oe.code AS other_code, oe.title AS other_title, oe.entity_type AS other_entity_type,
              CASE
                WHEN oe.entity_type LIKE 'resource_%' THEN 'resource://' || oe.uid
                WHEN oe.entity_type='source_document' THEN 'original://' || oe.uid
                WHEN oe.entity_type='extracted_document' THEN 'extracted://' || oe.uid
                WHEN oe.entity_type='intermediate_document' THEN 'intermediate://' || oe.uid
                WHEN oe.entity_type='extracted_item' THEN 'extracted://' || (SELECT extracted_document_uid FROM extracted_item WHERE uid=oe.uid)
                WHEN oe.entity_type='intermediate_item' THEN 'intermediate://' || (SELECT intermediate_document_uid FROM intermediate_item WHERE uid=oe.uid)
                WHEN oe.entity_type='chunk' THEN 'chunk://' || (SELECT intermediate_document_uid FROM chunk WHERE uid=oe.uid)
                ELSE NULL END AS open_uri,
              t.rationale, t.created_at
         FROM trace_link t
         JOIN entity_registry le ON le.uid=t.uid AND le.project_uid=? AND le.status <> 'deleted'
         JOIN entity_registry oe ON oe.uid=CASE WHEN t.from_uid=? THEN t.to_uid ELSE t.from_uid END
                                AND oe.project_uid=? AND oe.status <> 'deleted'
        WHERE t.from_uid=? OR t.to_uid=?
        ORDER BY t.created_at DESC, le.code DESC`
    )
    .all(itemUid, itemUid, projectUid, itemUid, projectUid, itemUid, itemUid) as SecondaryRelationRow[]
}

export function listReviewComments(db: Database, projectUid: string, itemUid: string): ReviewCommentRow[] {
  requireTarget(db, projectUid, itemUid)
  return db
    .prepare(
      `SELECT c.uid, c.code, r.text_body AS body, c.created_at, c.created_by
         FROM trace_link t
         JOIN entity_registry le ON le.uid=t.uid AND le.project_uid=? AND le.status <> 'deleted'
         JOIN resource_text r ON r.uid=t.from_uid AND r.text_role='comment'
         JOIN entity_registry c ON c.uid=r.uid AND c.project_uid=? AND c.status <> 'deleted'
        WHERE t.to_uid=? AND t.relation_type='relates_to'
        ORDER BY c.created_at DESC, c.code DESC`
    )
    .all(projectUid, projectUid, itemUid) as ReviewCommentRow[]
}

export function addReviewComment(db: Database, projectUid: string, itemUid: string, body: string): ReviewCommentRow {
  const normalized = body.trim()
  if (!normalized) throw new BackendError('validation', 'レビューコメントを入力してください', '')
  if (normalized.length > 10_000) throw new BackendError('validation', 'レビューコメントは10000文字以内です', '')
  requireTarget(db, projectUid, itemUid)

  return db.transaction(() => {
    const comment = registerEntity(db, {
      projectUid,
      entityType: 'resource_text',
      title: normalized.slice(0, 80),
      status: 'approved',
      createdBy: 'human'
    })
    db.prepare(`INSERT INTO resource_text (uid, text_body, text_role, language) VALUES (?, ?, 'comment', 'ja')`).run(
      comment.uid,
      normalized
    )
    const link = registerEntity(db, {
      projectUid,
      entityType: 'trace_link',
      status: 'approved',
      createdBy: 'human'
    })
    db.prepare(
      `INSERT INTO trace_link
         (uid, from_uid, to_uid, relation_type, direction, rationale, created_by, review_status, basis_kind)
       VALUES (?, ?, ?, 'relates_to', 'forward', 'Secondary Review comment', 'human', 'approved', 'human_approved')`
    ).run(link.uid, comment.uid, itemUid)
    const row = db
      .prepare(`SELECT uid, code, ? AS body, created_at, created_by FROM entity_registry WHERE uid=?`)
      .get(normalized, comment.uid) as ReviewCommentRow
    return row
  })()
}
