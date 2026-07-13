import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { addIntermediateElement } from '../intermediate/intermediate-service'
import { registerEntity } from '../store/entity-registry'
import {
  getResource,
  getResourceMergeContext,
  mergeResourceValues,
  parseLlmMergeCandidate,
  RESOURCE_TYPE_DEFINITIONS,
  reviseResource
} from './resource-service'

describe('共通Resource Editor（P7-2/P7-3、MID-002/004/005）', () => {
  let dir: string
  let db: Database
  let projectUid: string
  let documentUid: string
  let elementId: string
  let resourceUid: string
  let itemUid: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-resource-'))
    const root = join(dir, 'project')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'resource editor' })
    projectUid = getProjectRow(db).uid
    const document = registerEntity(db, { projectUid, entityType: 'intermediate_document', title: '成果物' })
    documentUid = document.uid
    db.prepare(
      `INSERT INTO intermediate_document (uid, artifact_type_id, dev_phase_id, structure_json) VALUES (?, 'spec', 'DD', ?)`
    ).run(
      documentUid,
      JSON.stringify({
        metadata: { title: '成果物', artifact_type_id: 'spec', dev_phase_id: 'DD' },
        sources: [],
        elements: []
      })
    )
    const added = addIntermediateElement(db, projectUid, documentUid, {
      position: 'below',
      type: 'paragraph',
      text: '変更前本文'
    })
    elementId = added.elementId
    resourceUid = added.resourceUid
    itemUid = (
      db.prepare('SELECT uid FROM intermediate_item WHERE intermediate_document_uid=?').get(documentUid) as {
        uid: string
      }
    ).uid
  })
  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('4章で定義した14種類を編集定義として提供する', () => {
    expect(RESOURCE_TYPE_DEFINITIONS).toHaveLength(14)
    expect(RESOURCE_TYPE_DEFINITIONS.map((definition) => definition.type)).toContain('resource_state_transition')
    expect(getResource(db, resourceUid).values.text_body).toBe('変更前本文')
  })

  it('画面追加した中間要素は現在Resourceを編集可能なマージ元として返す', () => {
    const context = getResourceMergeContext(db, documentUid, itemUid, resourceUid)
    expect(context.sources).toHaveLength(1)
    expect(context.sources[0]).toMatchObject({
      resourceUid,
      sourceKind: 'intermediate',
      readonly: false,
      type: 'resource_text'
    })
  })

  it('通常マージはDBを変更せず、同種本文と異種の必須文字列へ候補を構築する', () => {
    const merged = mergeResourceValues('resource_text', [
      { type: 'resource_text', values: { text_body: 'A', text_role: 'body', language: 'ja' } },
      { type: 'resource_text', values: { text_body: 'B', text_role: 'body', language: 'ja' } }
    ])
    expect(merged.values.text_body).toBe('A\nB')
    const converted = mergeResourceValues('resource_formula', [
      { type: 'resource_text', values: { text_body: 'x + 1' } }
    ])
    expect(converted.values.formula_text).toBe('x + 1')
    expect(converted.warnings.join('')).toContain('テキストとしてマージ')
    expect(
      parseLlmMergeCandidate('resource_text', '```json\n{"text_body":"LLM候補","language":"ja"}\n```').text_body
    ).toBe('LLM候補')
  })
  it('同種編集は旧Resourceを残し、新Resourceとbased_onへ差し替える', () => {
    const revised = reviseResource(db, projectUid, {
      resourceUid,
      targetType: 'resource_text',
      values: { text_body: '変更後本文', text_role: 'description', language: 'ja' },
      intermediateDocumentUid: documentUid,
      intermediateItemUid: itemUid,
      elementId
    })
    expect(revised.uid).not.toBe(resourceUid)
    expect(
      (db.prepare('SELECT text_body FROM resource_text WHERE uid=?').get(resourceUid) as { text_body: string })
        .text_body
    ).toBe('変更前本文')
    expect(
      (db.prepare('SELECT text_body FROM resource_text WHERE uid=?').get(revised.uid) as { text_body: string })
        .text_body
    ).toBe('変更後本文')
    expect(
      db
        .prepare("SELECT uid FROM trace_link WHERE from_uid=? AND to_uid=? AND relation_type='based_on'")
        .get(revised.uid, resourceUid)
    ).toBeTruthy()
  })

  it('マージ候補の保存は全マージ元とLLM実行をbased_onへ記録する', () => {
    const other = addIntermediateElement(db, projectUid, documentUid, {
      targetElementId: elementId,
      position: 'below',
      type: 'paragraph',
      text: '別本文'
    })
    const revised = reviseResource(db, projectUid, {
      resourceUid,
      targetType: 'resource_text',
      values: { text_body: '統合本文', text_role: 'body', language: 'ja' },
      intermediateDocumentUid: documentUid,
      intermediateItemUid: itemUid,
      elementId,
      basedOnResourceUids: [other.resourceUid],
      transformNote: 'merge'
    })
    const links = db
      .prepare(`SELECT to_uid,transform_note FROM trace_link WHERE from_uid=? ORDER BY to_uid`)
      .all(revised.uid) as { to_uid: string; transform_note: string }[]
    expect(links.map((link) => link.to_uid).sort()).toEqual([resourceUid, other.resourceUid].sort())
    expect(new Set(links.map((link) => link.transform_note))).toEqual(new Set(['merge']))
  })
  it('種別変更はitem_typeとstructure_jsonを新Resource種別へ同期する', () => {
    const revised = reviseResource(db, projectUid, {
      resourceUid,
      targetType: 'resource_formula',
      values: { formula_text: 'x + 1', formula_format: 'plain', formula_kind: 'calculation' },
      intermediateDocumentUid: documentUid,
      intermediateItemUid: itemUid,
      elementId
    })
    const item = db.prepare('SELECT item_type,resource_uid FROM intermediate_item WHERE uid=?').get(itemUid) as {
      item_type: string
      resource_uid: string
    }
    expect(item).toEqual({ item_type: 'resource_formula', resource_uid: revised.uid })
    const row = db.prepare('SELECT structure_json FROM intermediate_document WHERE uid=?').get(documentUid) as {
      structure_json: string
    }
    const element = (JSON.parse(row.structure_json) as { elements: Array<{ resource_uid: string; text: string }> })
      .elements[0]!
    expect(element).toMatchObject({ resource_uid: revised.uid, text: 'x + 1' })
  })
})
