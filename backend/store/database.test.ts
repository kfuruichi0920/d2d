import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow, openDatabase } from './database'
import { checkIntegrity, getSchemaVersion } from '../db/migrations'
import {
  confirmOntology,
  saveModelDefinition,
  saveRelationDefinition,
  setAllowance
} from '../ontology/ontology-service'

describe('createDatabase / openDatabase（P1-1）', () => {
  let dir: string
  let db: Database | null = null

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-db-'))
  })

  afterEach(() => {
    if (db) {
      closeDatabase(db)
      db = null
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('全テーブル・FTS・インデックスを含む初期スキーマを作成する', () => {
    db = createDatabase(join(dir, 'project.db'), { projectName: 'テスト' })
    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all() as {
        name: string
      }[]
    ).map((r) => r.name)

    // 主要テーブル（sdd_directory §5 のテーブル割り当て）
    const expected = [
      'project',
      'project_artifact_setting',
      'project_artifact_relation',
      'project_dev_phase_setting',
      'entity_registry',
      'batch_operation_info',
      'source_document',
      'source_location',
      'blob_resource',
      'extracted_document',
      'extracted_item',
      'intermediate_document',
      'intermediate_item',
      'chunk',
      'chunk_item',
      'resource_label',
      'resource_text',
      'resource_list',
      'resource_figure',
      'resource_table',
      'resource_formula',
      'resource_code',
      'resource_model',
      'resource_reference',
      'resource_glossary',
      'resource_glossary_synonym',
      'ontology_version',
      'ontology_model_definition',
      'ontology_relation_definition',
      'ontology_relation_allowance',
      'model_src',
      'model_std',
      'model_req',
      'model_cst',
      'model_func',
      'model_struct',
      'model_action',
      'model_state',
      'model_data',
      'model_if',
      'model_verif',
      'model_impl',
      'model_mgmt',
      'semantic_text',
      'semantic_reference',
      'semantic_normalization_history',
      'trace_link',
      'llm_run_ref',
      'prompt_template'
    ]
    for (const t of expected) {
      expect(tables, `テーブル ${t} が存在すること`).toContain(t)
    }
    expect(tables).not.toEqual(
      expect.arrayContaining([
        'resource_scenario',
        'resource_state_transition',
        'resource_interface',
        'resource_data_structure',
        'resource_metadata'
      ])
    )
    expect(tables).toContain('fts_entity_text')

    expect(getSchemaVersion(db)).toBe('2.0.0')
    expect(getProjectRow(db).name).toBe('テスト')
    checkIntegrity(db) // 例外が出ないこと
  })

  it('オントロジー初期定義・関係・許可マトリクスを投入する（MODEL-019〜028）', () => {
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    expect(db.prepare('SELECT version FROM ontology_version').get()).toEqual({ version: '0.1.0' })
    expect((db.prepare('SELECT COUNT(*) AS n FROM ontology_model_definition').get() as { n: number }).n).toBe(13)
    expect((db.prepare('SELECT COUNT(*) AS n FROM ontology_relation_definition').get() as { n: number }).n).toBe(10)
    expect(() =>
      db!.prepare(`UPDATE ontology_model_definition SET field_schema_json='{}' WHERE model_type='model_req'`).run()
    ).toThrow()
    expect(
      db
        .prepare(
          `SELECT allowed FROM ontology_relation_allowance WHERE relation_type='satisfies' AND source_model_type='model_func' AND target_model_type='model_req'`
        )
        .get()
    ).toEqual({ allowed: 1 })
    expect(
      db
        .prepare(
          `SELECT allowed FROM ontology_relation_allowance WHERE relation_type='satisfies' AND source_model_type='model_req' AND target_model_type='model_func'`
        )
        .get()
    ).toBeUndefined()
  })
  it('モデル・関係を追加し、許容マトリクスとオントロジー版を更新する', () => {
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    saveModelDefinition(db, {
      modelType: 'model_risk',
      codePrefix: 'RISK',
      label: 'リスク',
      layer: '知識・管理',
      definition: '設計上のリスクを表す。',
      fieldSchemaJson: '[{"key":"severity","label":"重大度","type":"text","description":"重大度"}]',
      enabled: true
    })
    expect(db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='model_risk'`).get()).toEqual({
      name: 'model_risk'
    })
    saveRelationDefinition(db, {
      relationType: 'mitigates',
      label: '軽減',
      definition: '設計要素がリスクを軽減する。',
      enabled: true
    })
    setAllowance(db, {
      relationType: 'mitigates',
      sourceModelType: 'model_func',
      targetModelType: 'model_risk',
      allowed: true
    })
    expect(
      db
        .prepare(
          `SELECT allowed FROM ontology_relation_allowance WHERE relation_type='mitigates' AND source_model_type='model_func' AND target_model_type='model_risk'`
        )
        .get()
    ).toEqual({ allowed: 1 })
    expect(confirmOntology(db)).toBe('0.1.1')
  })
  it('不正な独自項目定義を拒否し、追加model_*テーブルを残さない', () => {
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    expect(() =>
      saveModelDefinition(db!, {
        modelType: 'model_invalid',
        codePrefix: 'INVALID',
        label: '不正モデル',
        layer: '知識・管理',
        definition: '不正な独自項目定義の確認用。',
        fieldSchemaJson: '[{"key":"severity","label":"重大度","type":"select","description":"重大度"}]',
        enabled: true
      })
    ).toThrowError(/field_schema_json/)
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='model_invalid'`).get()
    ).toBeUndefined()
  })
  it('model_*テーブル作成後に定義登録が失敗した場合もDDLをロールバックする', () => {
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    expect(() =>
      saveModelDefinition(db!, {
        modelType: 'model_duplicate_prefix',
        codePrefix: 'REQ',
        label: '重複prefix',
        layer: '要求',
        definition: 'トランザクション確認用。',
        fieldSchemaJson: '[]',
        enabled: true
      })
    ).toThrow()
    expect(
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='model_duplicate_prefix'`).get()
    ).toBeUndefined()
  })
  it('許容マトリクスは未定義のモデル・関係とbased_onを拒否する', () => {
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    expect(() =>
      setAllowance(db!, {
        relationType: 'unknown_relation',
        sourceModelType: 'model_func',
        targetModelType: 'model_req',
        allowed: true
      })
    ).toThrowError(/定義が存在しません/)
    expect(() =>
      setAllowance(db!, {
        relationType: 'based_on',
        sourceModelType: 'model_func',
        targetModelType: 'model_req',
        allowed: true
      })
    ).toThrowError(/マトリクス/)
  })
  it('schema 1.x は変更せず再作成を要求する', () => {
    const path = join(dir, 'legacy.db')
    const legacy = createDatabase(path, { projectName: 'legacy' })
    legacy.prepare(`UPDATE project SET schema_version='1.10.0'`).run()
    closeDatabase(legacy)
    expect(() => openDatabase(path)).toThrowError(/再作成/)
  })
  it('既存 DB を openDatabase で開ける（スキーマ版数維持）', () => {
    const path = join(dir, 'project.db')
    const created = createDatabase(path, { projectName: 'p' })
    closeDatabase(created)

    db = openDatabase(path)
    expect(getSchemaVersion(db)).toBe('2.0.0')
  })

  it('存在しない DB を開くと not_found エラーになる', () => {
    expect(() => openDatabase(join(dir, 'missing.db'))).toThrowError(/見つかりません/)
  })

  it('二重作成は conflict エラーになる', () => {
    const path = join(dir, 'project.db')
    db = createDatabase(path, { projectName: 'p' })
    expect(() => createDatabase(path, { projectName: 'q' })).toThrowError(/既に存在/)
  })
})
