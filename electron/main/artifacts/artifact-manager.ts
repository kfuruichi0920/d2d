import { getDatabase } from '../db/database'
import { withTransaction } from '../store/store-access'
import { generateUid } from '../utils/uuid'

export interface ArtifactSettingRow {
  uid: string
  project_uid: string
  artifact_name: string
  artifact_type_id: string
  sort_order: number
  is_active: number
}

export function listArtifactSettings(): ArtifactSettingRow[] {
  return getDatabase()
    .prepare(
      `SELECT uid, project_uid, artifact_name, artifact_type_id, sort_order, is_active
       FROM project_artifact_setting
       ORDER BY sort_order, artifact_name`
    )
    .all() as ArtifactSettingRow[]
}

export function createArtifactSetting(
  projectUid: string,
  artifactName: string,
  artifactTypeId: string,
  sortOrder: number = 0
): string {
  return withTransaction(() => {
    const uid = generateUid()
    getDatabase()
      .prepare(
        `INSERT INTO project_artifact_setting
         (uid, project_uid, artifact_name, artifact_type_id, sort_order)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(uid, projectUid, artifactName, artifactTypeId, sortOrder)
    return uid
  })
}

export function updateArtifactSetting(
  uid: string,
  updates: Partial<Pick<ArtifactSettingRow, 'artifact_name' | 'artifact_type_id' | 'sort_order' | 'is_active'>>
): void {
  const db = getDatabase()
  if (updates.artifact_name !== undefined)
    db.prepare(`UPDATE project_artifact_setting SET artifact_name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid = ?`)
      .run(updates.artifact_name, uid)
  if (updates.artifact_type_id !== undefined)
    db.prepare(`UPDATE project_artifact_setting SET artifact_type_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid = ?`)
      .run(updates.artifact_type_id, uid)
  if (updates.sort_order !== undefined)
    db.prepare(`UPDATE project_artifact_setting SET sort_order = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid = ?`)
      .run(updates.sort_order, uid)
  if (updates.is_active !== undefined)
    db.prepare(`UPDATE project_artifact_setting SET is_active = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid = ?`)
      .run(updates.is_active, uid)
}

export function deleteArtifactSetting(uid: string): void {
  getDatabase()
    .prepare(`DELETE FROM project_artifact_setting WHERE uid = ?`)
    .run(uid)
}
