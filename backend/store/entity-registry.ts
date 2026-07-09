/**
 * entity_registry 共通台帳アクセス（P1-2）。
 * すべての設計リソースはここで uid（UUIDv7）と表示コード（prefix-6桁）を採番して登録する。
 * code は欠番許容・再採番禁止（sdd_data_structure §2.6, §10.1）。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { ENTITY_CODE_PREFIX, type DesignCategory, type EntityStatus, type EntityType } from './entity-types'
import { newUid } from './uid'

export interface RegisterEntityInput {
  projectUid: string
  entityType: EntityType
  /** ④設計モデルへ昇格したリソースに設定する設計13分類 */
  designCategory?: DesignCategory
  title?: string
  status?: EntityStatus
  ownerUid?: string
  createdBy?: string
  batchOperationUid?: string
  sourceHash?: string
}

export interface EntityRegistryRow {
  uid: string
  project_uid: string
  entity_type: EntityType
  design_category: DesignCategory | null
  code: string
  title: string | null
  status: EntityStatus
  owner_uid: string | null
  created_at: string
  updated_at: string
}

function nowIso(): string {
  return new Date().toISOString()
}

/**
 * prefix ごとの次コードを採番する。
 * MAX(既存連番)+1 方式（欠番許容・再採番禁止）。同時編集は考慮しない（TBD-08 未決）。
 * design_category prefix の場合、IF/DATA は entity_type prefix と同一連番空間になる（§10.1）。
 */
export function nextCode(db: Database, prefix: string): string {
  const row = db
    .prepare(
      `SELECT MAX(CAST(substr(code, ?) AS INTEGER)) AS max_no
         FROM entity_registry
        WHERE code GLOB ?`
    )
    .get(prefix.length + 2, `${prefix}-[0-9][0-9][0-9][0-9][0-9][0-9]`) as { max_no: number | null }
  const next = (row.max_no ?? 0) + 1
  if (next > 999999) {
    throw new BackendError('db', `表示コードの連番が上限に達しました: ${prefix}`, '')
  }
  return `${prefix}-${String(next).padStart(6, '0')}`
}

/**
 * 共通台帳へエンティティを登録し、uid と code を返す。
 * designCategory が指定された場合は分類 prefix で採番する（例: REQ-000001）。
 */
export function registerEntity(db: Database, input: RegisterEntityInput): { uid: string; code: string } {
  const prefix = input.designCategory ?? ENTITY_CODE_PREFIX[input.entityType]
  if (!prefix) {
    throw new BackendError('validation', `不明な entity_type です: ${input.entityType}`, '')
  }
  const uid = newUid()
  const code = nextCode(db, prefix)
  const ts = nowIso()
  db.prepare(
    `INSERT INTO entity_registry
       (uid, project_uid, entity_type, design_category, code, title, status,
        owner_uid, created_by, updated_by, batch_operation_uid, source_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid,
    input.projectUid,
    input.entityType,
    input.designCategory ?? null,
    code,
    input.title ?? null,
    input.status ?? 'draft',
    input.ownerUid ?? null,
    input.createdBy ?? null,
    input.createdBy ?? null,
    input.batchOperationUid ?? null,
    input.sourceHash ?? null,
    ts,
    ts
  )
  return { uid, code }
}

export function getEntity(db: Database, uid: string): EntityRegistryRow {
  const row = db
    .prepare(
      `SELECT uid, project_uid, entity_type, design_category, code, title, status, owner_uid, created_at, updated_at
         FROM entity_registry WHERE uid = ?`
    )
    .get(uid) as EntityRegistryRow | undefined
  if (!row) {
    throw new BackendError('not_found', `エンティティが見つかりません: ${uid}`, '')
  }
  return row
}

/**
 * 状態を更新する。通常削除は status='deleted' の論理削除とする（sdd_data_structure §10.6）。
 */
export function updateEntityStatus(db: Database, uid: string, status: EntityStatus, updatedBy?: string): void {
  const result = db
    .prepare(`UPDATE entity_registry SET status = ?, updated_by = ?, updated_at = ? WHERE uid = ?`)
    .run(status, updatedBy ?? null, nowIso(), uid)
  if (result.changes === 0) {
    throw new BackendError('not_found', `エンティティが見つかりません: ${uid}`, '')
  }
}
