/**
 * プロジェクト設定 CRUD（P2-1、CORE-012/013）。
 * 成果物定義（project_artifact_setting）、文書体系（project_artifact_relation）、
 * 開発フェーズ（project_dev_phase_setting）を管理する。
 * これらは project 設定情報であり entity_registry には登録しない（sdd_data_structure §4.2〜4.4）。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { newUid } from '../store/uid'

function nowIso(): string {
  return new Date().toISOString()
}

/** CORE-013: 新規プロジェクトへ登録する標準の開発フェーズ・成果物。 */
export const DEFAULT_PROJECT_PHASES = [
  {
    devPhaseId: 'SYSTEM_DESIGN',
    devPhaseName: 'システム設計',
    artifacts: [
      { artifactName: 'システム仕様書', artifactTypeId: 'system_specification' },
      { artifactName: 'システム試験仕様書', artifactTypeId: 'system_test_specification' },
      { artifactName: 'レビュー記録', artifactTypeId: 'review_record' }
    ]
  },
  {
    devPhaseId: 'SW_REQUIREMENTS',
    devPhaseName: 'SW要求分析',
    artifacts: [
      { artifactName: 'SW要求仕様書', artifactTypeId: 'sw_requirements_specification' },
      { artifactName: 'SW総合試験仕様書', artifactTypeId: 'sw_comprehensive_test_specification' },
      { artifactName: 'レビュー記録', artifactTypeId: 'review_record' },
      { artifactName: '障害台帳', artifactTypeId: 'defect_ledger' }
    ]
  },
  {
    devPhaseId: 'EXTERNAL_DESIGN',
    devPhaseName: '外部設計',
    artifacts: [
      { artifactName: 'SW方式設計書', artifactTypeId: 'sw_architecture_design' },
      { artifactName: 'SW結合仕様書', artifactTypeId: 'sw_integration_specification' },
      { artifactName: 'レビュー記録', artifactTypeId: 'review_record' },
      { artifactName: '障害台帳', artifactTypeId: 'defect_ledger' }
    ]
  },
  {
    devPhaseId: 'INTERNAL_DESIGN',
    devPhaseName: '内部設計',
    artifacts: [
      { artifactName: 'SW詳細設計書', artifactTypeId: 'sw_detailed_design' },
      { artifactName: 'SW単体仕様書', artifactTypeId: 'sw_unit_test_specification' },
      { artifactName: 'レビュー記録', artifactTypeId: 'review_record' },
      { artifactName: '障害台帳', artifactTypeId: 'defect_ledger' }
    ]
  },
  {
    devPhaseId: 'GENERAL',
    devPhaseName: '全般',
    artifacts: [
      { artifactName: '変更管理票', artifactTypeId: 'change_request' },
      { artifactName: 'タスク管理表', artifactTypeId: 'task_management' },
      { artifactName: '議事録', artifactTypeId: 'meeting_minutes' }
    ]
  }
] as const

/** 新規プロジェクトの標準設定を1トランザクションで登録する（CORE-013）。 */
export function seedDefaultProjectSettings(db: Database, projectUid: string): void {
  db.transaction(() => {
    for (const [phaseIndex, phase] of DEFAULT_PROJECT_PHASES.entries()) {
      saveDevPhase(db, projectUid, {
        devPhaseId: phase.devPhaseId,
        devPhaseName: phase.devPhaseName,
        sortOrder: phaseIndex
      })
      for (const [artifactIndex, artifact] of phase.artifacts.entries()) {
        saveArtifactSetting(db, projectUid, {
          ...artifact,
          devPhaseId: phase.devPhaseId,
          sortOrder: artifactIndex
        })
      }
    }
  })()
}

// ---- 成果物定義 ----

export interface ArtifactSetting {
  uid: string
  artifact_name: string
  artifact_type_id: string
  dev_phase_id: string | null
  sort_order: number
  is_active: number
}

export function listArtifactSettings(db: Database, projectUid: string): ArtifactSetting[] {
  return db
    .prepare(
      `SELECT uid, artifact_name, artifact_type_id, dev_phase_id, sort_order, is_active
         FROM project_artifact_setting WHERE project_uid = ? ORDER BY sort_order, artifact_name`
    )
    .all(projectUid) as ArtifactSetting[]
}

export interface SaveArtifactSettingInput {
  uid?: string
  artifactName: string
  artifactTypeId: string
  devPhaseId?: string
  sortOrder?: number
  isActive?: boolean
}

export function saveArtifactSetting(
  db: Database,
  projectUid: string,
  input: SaveArtifactSettingInput
): ArtifactSetting {
  if (!input.artifactName || !input.artifactTypeId) {
    throw new BackendError('validation', 'artifactName と artifactTypeId は必須です', '')
  }
  const ts = nowIso()
  if (input.uid) {
    const result = db
      .prepare(
        `UPDATE project_artifact_setting
            SET artifact_name = ?, artifact_type_id = ?, dev_phase_id = ?, sort_order = ?, is_active = ?, updated_at = ?
          WHERE uid = ? AND project_uid = ?`
      )
      .run(
        input.artifactName,
        input.artifactTypeId,
        input.devPhaseId ?? null,
        input.sortOrder ?? 0,
        input.isActive === false ? 0 : 1,
        ts,
        input.uid,
        projectUid
      )
    if (result.changes === 0) {
      throw new BackendError('not_found', `成果物設定が見つかりません: ${input.uid}`, '')
    }
    return getArtifactSetting(db, projectUid, input.uid)
  }
  const uid = newUid()
  try {
    db.prepare(
      `INSERT INTO project_artifact_setting (uid, project_uid, artifact_name, artifact_type_id, dev_phase_id, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uid,
      projectUid,
      input.artifactName,
      input.artifactTypeId,
      input.devPhaseId ?? null,
      input.sortOrder ?? 0,
      input.isActive === false ? 0 : 1,
      ts,
      ts
    )
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      throw new BackendError(
        'conflict',
        `同じ開発フェーズに同名の成果物が既に存在します: ${input.artifactName}`,
        err.message
      )
    }
    throw err
  }
  return getArtifactSetting(db, projectUid, uid)
}

function getArtifactSetting(db: Database, projectUid: string, uid: string): ArtifactSetting {
  const row = db
    .prepare(
      `SELECT uid, artifact_name, artifact_type_id, dev_phase_id, sort_order, is_active
         FROM project_artifact_setting WHERE uid = ? AND project_uid = ?`
    )
    .get(uid, projectUid) as ArtifactSetting | undefined
  if (!row) throw new BackendError('not_found', `成果物設定が見つかりません: ${uid}`, '')
  return row
}

/** 論理無効化（is_active=0）。削除せず非表示にする（sdd_data_structure §4.2 備考） */
export function deactivateArtifactSetting(db: Database, projectUid: string, uid: string): void {
  const result = db
    .prepare(`UPDATE project_artifact_setting SET is_active = 0, updated_at = ? WHERE uid = ? AND project_uid = ?`)
    .run(nowIso(), uid, projectUid)
  if (result.changes === 0) {
    throw new BackendError('not_found', `成果物設定が見つかりません: ${uid}`, '')
  }
}

/** 成果物設定と同じフェーズ・種別の③中間データを復旧不能で削除する（P7-1）。 */
export function deleteArtifactSetting(db: Database, projectUid: string, uid: string): { deletedDocuments: number } {
  const setting = getArtifactSetting(db, projectUid, uid)
  const txn = db.transaction(() => {
    const docs = db
      .prepare(
        `SELECT d.uid FROM intermediate_document d JOIN entity_registry e ON e.uid=d.uid WHERE e.project_uid=? AND d.artifact_type_id=? AND d.dev_phase_id=?`
      )
      .all(projectUid, setting.artifact_type_id, setting.dev_phase_id) as { uid: string }[]
    const remove = db.prepare(`DELETE FROM entity_registry WHERE uid=?`)
    for (const doc of docs) remove.run(doc.uid)
    db.prepare(`DELETE FROM project_artifact_setting WHERE uid=? AND project_uid=?`).run(uid, projectUid)
    return { deletedDocuments: docs.length }
  })
  return txn()
}

// ---- 文書体系（成果物親子関係） ----

export interface ArtifactRelation {
  uid: string
  parent_artifact_uid: string
  child_artifact_uid: string
  sort_order: number
  is_active: number
}

export function listArtifactRelations(db: Database, projectUid: string): ArtifactRelation[] {
  return db
    .prepare(
      `SELECT uid, parent_artifact_uid, child_artifact_uid, sort_order, is_active
         FROM project_artifact_relation WHERE project_uid = ? ORDER BY parent_artifact_uid, sort_order`
    )
    .all(projectUid) as ArtifactRelation[]
}

export interface SaveArtifactRelationInput {
  parentArtifactUid: string
  childArtifactUid: string
  sortOrder?: number
}

export function addArtifactRelation(
  db: Database,
  projectUid: string,
  input: SaveArtifactRelationInput
): ArtifactRelation {
  if (!input.parentArtifactUid || !input.childArtifactUid) {
    throw new BackendError('validation', 'parentArtifactUid と childArtifactUid は必須です', '')
  }
  if (input.parentArtifactUid === input.childArtifactUid) {
    throw new BackendError('validation', '親と子に同一の成果物は指定できません', '')
  }
  const uid = newUid()
  const ts = nowIso()
  try {
    db.prepare(
      `INSERT INTO project_artifact_relation (uid, project_uid, parent_artifact_uid, child_artifact_uid, sort_order, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(uid, projectUid, input.parentArtifactUid, input.childArtifactUid, input.sortOrder ?? 0, ts, ts)
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      throw new BackendError('conflict', '同一の親子関係が既に存在します', err.message)
    }
    if (err instanceof Error && /FOREIGN KEY/.test(err.message)) {
      throw new BackendError('validation', '親または子の成果物設定が存在しません', err.message)
    }
    throw err
  }
  const row = db
    .prepare(
      `SELECT uid, parent_artifact_uid, child_artifact_uid, sort_order, is_active FROM project_artifact_relation WHERE uid = ?`
    )
    .get(uid) as ArtifactRelation
  return row
}

export function deactivateArtifactRelation(db: Database, projectUid: string, uid: string): void {
  const result = db
    .prepare(`UPDATE project_artifact_relation SET is_active = 0, updated_at = ? WHERE uid = ? AND project_uid = ?`)
    .run(nowIso(), uid, projectUid)
  if (result.changes === 0) {
    throw new BackendError('not_found', `成果物親子関係が見つかりません: ${uid}`, '')
  }
}

// ---- 開発フェーズ ----

export interface DevPhaseSetting {
  uid: string
  dev_phase_id: string
  dev_phase_name: string
  sort_order: number
  is_active: number
}

export function listDevPhases(db: Database, projectUid: string): DevPhaseSetting[] {
  return db
    .prepare(
      `SELECT uid, dev_phase_id, dev_phase_name, sort_order, is_active
         FROM project_dev_phase_setting WHERE project_uid = ? ORDER BY sort_order, dev_phase_id`
    )
    .all(projectUid) as DevPhaseSetting[]
}

export interface SaveDevPhaseInput {
  uid?: string
  devPhaseId: string
  devPhaseName: string
  sortOrder?: number
  isActive?: boolean
}

export function saveDevPhase(db: Database, projectUid: string, input: SaveDevPhaseInput): DevPhaseSetting {
  if (!input.devPhaseId || !input.devPhaseName) {
    throw new BackendError('validation', 'devPhaseId と devPhaseName は必須です', '')
  }
  const ts = nowIso()
  if (input.uid) {
    const result = db
      .prepare(
        `UPDATE project_dev_phase_setting
            SET dev_phase_name = ?, sort_order = ?, is_active = ?, updated_at = ?
          WHERE uid = ? AND project_uid = ?`
      )
      .run(input.devPhaseName, input.sortOrder ?? 0, input.isActive === false ? 0 : 1, ts, input.uid, projectUid)
    if (result.changes === 0) {
      throw new BackendError('not_found', `開発フェーズが見つかりません: ${input.uid}`, '')
    }
  } else {
    try {
      db.prepare(
        `INSERT INTO project_dev_phase_setting (uid, project_uid, dev_phase_id, dev_phase_name, sort_order, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newUid(),
        projectUid,
        input.devPhaseId ?? null,
        input.devPhaseName,
        input.sortOrder ?? 0,
        input.isActive === false ? 0 : 1,
        ts,
        ts
      )
    } catch (err) {
      if (err instanceof Error && /UNIQUE/.test(err.message)) {
        throw new BackendError('conflict', `同一 ID の開発フェーズが既に存在します: ${input.devPhaseId}`, err.message)
      }
      throw err
    }
  }
  const row = db
    .prepare(
      `SELECT uid, dev_phase_id, dev_phase_name, sort_order, is_active
         FROM project_dev_phase_setting WHERE project_uid = ? AND dev_phase_id = ?`
    )
    .get(projectUid, input.devPhaseId) as DevPhaseSetting
  return row
}

/** フェーズ配下の成果物と関連③中間データを含めて復旧不能で削除する（P7-1）。 */
export function deleteDevPhase(
  db: Database,
  projectUid: string,
  uid: string
): { deletedArtifacts: number; deletedDocuments: number } {
  const phase = db
    .prepare(`SELECT dev_phase_id FROM project_dev_phase_setting WHERE uid=? AND project_uid=?`)
    .get(uid, projectUid) as { dev_phase_id: string } | undefined
  if (!phase) throw new BackendError('not_found', `開発フェーズが見つかりません: ${uid}`, '')
  const artifacts = listArtifactSettings(db, projectUid).filter((a) => a.dev_phase_id === phase.dev_phase_id)
  let deletedDocuments = 0
  const txn = db.transaction(() => {
    for (const artifact of artifacts)
      deletedDocuments += deleteArtifactSetting(db, projectUid, artifact.uid).deletedDocuments
    db.prepare(`DELETE FROM project_dev_phase_setting WHERE uid=? AND project_uid=?`).run(uid, projectUid)
  })
  txn()
  return { deletedArtifacts: artifacts.length, deletedDocuments }
}
