import { getDatabase } from '../db/database'
import { generateUid } from '../utils/uuid'

export type EntityType =
  | 'source_document'
  | 'source_location'
  | 'blob_resource'
  | 'extracted_document'
  | 'extracted_item'
  | 'intermediate_document'
  | 'intermediate_item'
  | 'chunk'
  | 'chunk_item'
  | 'resource_label'
  | 'resource_text'
  | 'resource_list'
  | 'resource_figure'
  | 'resource_table'
  | 'resource_formula'
  | 'resource_code'
  | 'resource_model'
  | 'resource_scenario'
  | 'resource_interface'
  | 'resource_state_transition'
  | 'resource_data_structure'
  | 'resource_reference'
  | 'resource_metadata'
  | 'resource_glossary'
  | 'resource_glossary_synonym'
  | 'trace_link'
  | 'llm_run_ref'
  | 'batch_operation_info'

export type EntityStatus = 'draft' | 'review' | 'approved' | 'rejected' | 'deleted'

export interface EntityRegistryRecord {
  uid: string
  project_uid: string
  entity_type: EntityType
  code: string
  title: string
  status: EntityStatus
  source_hash: string | null
  created_at: string
  updated_at: string
}

export interface CreateEntityOptions {
  entityType: EntityType
  code: string
  title: string
  status?: EntityStatus
  sourceHash?: string
  batchOperationUid?: string
}

function projectUid(): string {
  const db = getDatabase()
  const row = db.prepare('SELECT uid FROM project LIMIT 1').get() as { uid: string } | undefined
  if (!row) throw new Error('No project in database')
  return row.uid
}

export function createEntityEntry(opts: CreateEntityOptions): string {
  const db = getDatabase()
  const uid = generateUid()
  const pUid = projectUid()
  const now = new Date().toISOString()

  db.prepare(
    `INSERT INTO entity_registry
     (uid, project_uid, entity_type, code, title, status, source_hash, batch_operation_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uid,
    pUid,
    opts.entityType,
    opts.code,
    opts.title,
    opts.status ?? 'draft',
    opts.sourceHash ?? null,
    opts.batchOperationUid ?? null,
    now,
    now
  )

  return uid
}

export function getEntityByCode(entityType: EntityType, code: string): EntityRegistryRecord | undefined {
  const db = getDatabase()
  return db
    .prepare('SELECT * FROM entity_registry WHERE entity_type = ? AND code = ?')
    .get(entityType, code) as EntityRegistryRecord | undefined
}

export function updateEntityStatus(uid: string, status: EntityStatus): void {
  const db = getDatabase()
  db.prepare('UPDATE entity_registry SET status = ?, updated_at = ? WHERE uid = ?').run(
    status,
    new Date().toISOString(),
    uid
  )
}
