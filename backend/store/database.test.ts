import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow, openDatabase } from './database'
import { checkIntegrity, getSchemaVersion } from '../db/migrations'
import { buildRelationRules } from '../db/seed/relation-rules'

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
      'resource_scenario',
      'resource_interface',
      'resource_state_transition',
      'resource_data_structure',
      'resource_reference',
      'resource_metadata',
      'resource_glossary',
      'resource_glossary_synonym',
      'trace_link',
      'relation_rule_master',
      'llm_run_ref',
      'prompt_template'
    ]
    for (const t of expected) {
      expect(tables, `テーブル ${t} が存在すること`).toContain(t)
    }
    expect(tables).toContain('fts_entity_text')

    expect(getSchemaVersion(db)).toBe('1.2.0')
    expect(getProjectRow(db).name).toBe('テスト')
    checkIntegrity(db) // 例外が出ないこと
  })

  it('relation_rule_master へシードが投入される（P1-6）', () => {
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    const count = (db.prepare('SELECT COUNT(*) AS n FROM relation_rule_master').get() as { n: number }).n
    expect(count).toBe(buildRelationRules().length)
    expect(count).toBeGreaterThan(50)

    // 代表ルールの確認（srs §9.4）
    const satisfies = db
      .prepare(
        `SELECT * FROM relation_rule_master WHERE relation_type='satisfies' AND source_category='FUNC' AND target_category='REQ'`
      )
      .get()
    expect(satisfies).toBeTruthy()
    const uses = db
      .prepare(
        `SELECT required_attr FROM relation_rule_master WHERE relation_type='uses' AND source_category='STRUCT' AND target_category='IF'`
      )
      .get() as { required_attr: string }
    expect(uses.required_attr).toBe('usage_kind')
    // SRC は satisfies の source に現れない
    const srcSatisfies = db
      .prepare(
        `SELECT COUNT(*) AS n FROM relation_rule_master WHERE relation_type='satisfies' AND source_category='SRC'`
      )
      .get() as { n: number }
    expect(srcSatisfies.n).toBe(0)
  })

  it('既存 DB を openDatabase で開ける（スキーマ版数維持）', () => {
    const path = join(dir, 'project.db')
    const created = createDatabase(path, { projectName: 'p' })
    closeDatabase(created)

    db = openDatabase(path)
    expect(getSchemaVersion(db)).toBe('1.2.0')
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
