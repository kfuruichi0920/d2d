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
  getResourceOutlineContext,
  linkDerivedResource,
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

  it('②③で使用する9種類を編集定義として提供する', () => {
    expect(RESOURCE_TYPE_DEFINITIONS).toHaveLength(9)
    expect(RESOURCE_TYPE_DEFINITIONS.map((definition) => definition.type)).not.toEqual(
      expect.arrayContaining([
        'resource_scenario',
        'resource_state_transition',
        'resource_interface',
        'resource_data_structure',
        'resource_metadata'
      ])
    )
    expect(getResource(db, resourceUid).values.text_body).toBe('変更前本文')
  })

  it('編集定義は廃止フィールドを除外し、管理特記事項・Markdown・図・数式の新定義を提供する', () => {
    const label = RESOURCE_TYPE_DEFINITIONS.find((item) => item.type === 'resource_label')!
    const text = RESOURCE_TYPE_DEFINITIONS.find((item) => item.type === 'resource_text')!
    const list = RESOURCE_TYPE_DEFINITIONS.find((item) => item.type === 'resource_list')!
    const figure = RESOURCE_TYPE_DEFINITIONS.find((item) => item.type === 'resource_figure')!
    const table = RESOURCE_TYPE_DEFINITIONS.find((item) => item.type === 'resource_table')!
    const formula = RESOURCE_TYPE_DEFINITIONS.find((item) => item.type === 'resource_formula')!
    const code = RESOURCE_TYPE_DEFINITIONS.find((item) => item.type === 'resource_code')!
    expect(label.fields.some((field) => field.name === 'style_name')).toBe(false)
    expect(text.fields.map((field) => field.name)).toEqual([
      'text_body',
      'text_role',
      'language',
      'target_resource_uid'
    ])
    expect(list.fields.find((field) => field.name === 'items_json')).toMatchObject({
      kind: 'multiline',
      preview: 'markdown'
    })
    expect(figure.fields.map((field) => field.name)).toEqual(
      expect.arrayContaining(['image_hash', 'figure_number', 'caption', 'description'])
    )
    expect(figure.fields.map((field) => field.name)).not.toContain('caption_uid')
    expect(table.fields.find((field) => field.name === 'table_title')?.label).toBe('キャプション')
    expect(table.fields.find((field) => field.name === 'cells_json')?.kind).toBe('table')
    expect(table.fields.map((field) => field.name)).toContain('description')
    expect(code.fields.map((field) => field.name)).not.toEqual(
      expect.arrayContaining(['symbols_json', 'syntax_tree_json', 'parse_status'])
    )
    expect(code.fields.map((field) => field.name)).toContain('description')
    expect(formula.fields.map((field) => field.name)).not.toContain('variables_json')
    expect(formula.fields.find((field) => field.name === 'formula_text')).toMatchObject({ language: 'latex' })
    expect(RESOURCE_TYPE_DEFINITIONS.every((item) => item.fields.every((field) => field.description))).toBe(true)
  })

  it('表のスプレッドシート保存はセル行を同期し、同じ座標のUIDを維持する', () => {
    const values = {
      table_title: '性能表',
      row_count: 2,
      column_count: 2,
      table_kind: 'data',
      header_rows_json: '[0]',
      header_columns_json: '[]',
      cells_json: JSON.stringify([
        [{ text: '項目' }, { text: '値' }],
        [{ text: '応答時間' }, { text: '100ms以内' }]
      ]),
      source_range: '',
      description: '性能要求を示す表'
    }
    const created = reviseResource(db, projectUid, {
      resourceUid,
      targetType: 'resource_table',
      values,
      intermediateDocumentUid: documentUid,
      intermediateItemUid: itemUid,
      elementId
    })
    const first = db
      .prepare(`SELECT uid,cell_text,is_header FROM resource_table_cell WHERE table_uid=? AND row_no=0 AND col_no=0`)
      .get(created.uid) as { uid: string; cell_text: string; is_header: number }
    expect(first).toMatchObject({ cell_text: '項目', is_header: 1 })
    reviseResource(db, projectUid, {
      resourceUid: created.uid,
      targetType: 'resource_table',
      values: { ...values, cells_json: String(values.cells_json).replace('100ms以内', '150ms以内') },
      intermediateDocumentUid: documentUid,
      intermediateItemUid: itemUid,
      elementId
    })
    expect(
      db
        .prepare(`SELECT uid,cell_text FROM resource_table_cell WHERE table_uid=? AND row_no=0 AND col_no=0`)
        .get(created.uid)
    ).toEqual({ uid: first.uid, cell_text: '項目' })
    expect(
      db
        .prepare(`SELECT cell_text FROM resource_table_cell WHERE table_uid=? AND row_no=1 AND col_no=1`)
        .get(created.uid)
    ).toEqual({ cell_text: '150ms以内' })
  })

  it('アウトライン文脈をResourceから復元し、管理特記事項を設計値と分離して保存する', () => {
    const context = getResourceOutlineContext(db, resourceUid)
    expect(context).toMatchObject({ documentUid, outlineIndex: 0 })
    reviseResource(db, projectUid, {
      resourceUid,
      targetType: 'resource_text',
      values: {
        text_body: '変更後',
        text_role: 'body',
        language: 'ja',
        target_resource_uid: `resource://${resourceUid}`
      },
      intermediateItemUid: itemUid,
      administrativeNotes: 'レビュー担当だけが参照'
    })
    const loaded = getResource(db, resourceUid)
    expect(loaded.administrativeNotes).toBe('レビュー担当だけが参照')
    expect(loaded.values).not.toHaveProperty('administrative_notes')
    expect(loaded.values.target_resource_uid).toBe(resourceUid)
  })

  it('図・数式から派生Resourceを新規追加または既存参照して関係を保持する', () => {
    const created = linkDerivedResource(db, projectUid, {
      sourceUid: resourceUid,
      relationType: 'relates_to',
      newText: '図から読み取れる制約'
    })
    expect(created.created).toBe(true)
    const existing = linkDerivedResource(db, projectUid, {
      sourceUid: resourceUid,
      relationType: 'uses',
      targetUid: created.targetUid
    })
    expect(existing.created).toBe(false)
    expect(db.prepare('SELECT COUNT(*) AS count FROM trace_link WHERE from_uid=?').get(resourceUid)).toEqual({
      count: 2
    })
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
    expect(getResource(db, resourceUid).ownership).toMatchObject({ exclusiveIntermediate: true, protectionReasons: [] })
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
  it('③専有の同種編集は同じResourceへ上書きする', () => {
    const revised = reviseResource(db, projectUid, {
      resourceUid,
      targetType: 'resource_text',
      values: { text_body: '変更後本文', text_role: 'description', language: 'ja' },
      intermediateDocumentUid: documentUid,
      intermediateItemUid: itemUid,
      elementId
    })
    expect(revised).toMatchObject({ uid: resourceUid, type: 'resource_text', saveMode: 'updated' })
    expect(
      (db.prepare('SELECT text_body FROM resource_text WHERE uid=?').get(resourceUid) as { text_body: string })
        .text_body
    ).toBe('変更後本文')
    expect(db.prepare(`SELECT uid FROM trace_link WHERE from_uid=?`).get(resourceUid)).toBeUndefined()
  })

  it('他の中間要素が共有するResourceは保護して新Resourceへ差し替える', () => {
    const sharedItem = registerEntity(db, { projectUid, entityType: 'intermediate_item', createdBy: 'user' })
    db.prepare(
      `INSERT INTO intermediate_item (uid,intermediate_document_uid,item_type,resource_uid) VALUES (?,?,'resource_text',?)`
    ).run(sharedItem.uid, documentUid, resourceUid)
    const revised = reviseResource(db, projectUid, {
      resourceUid,
      targetType: 'resource_text',
      values: { text_body: '変更後本文', text_role: 'body', language: 'ja' },
      intermediateDocumentUid: documentUid,
      intermediateItemUid: itemUid,
      elementId
    })
    expect(revised.saveMode).toBe('created-protected')
    expect(revised.uid).not.toBe(resourceUid)
    expect(revised.protectionReasons.join('')).toContain('他の中間要素')
    expect(
      (db.prepare('SELECT text_body FROM resource_text WHERE uid=?').get(resourceUid) as { text_body: string })
        .text_body
    ).toBe('変更前本文')
    expect(
      db.prepare(`SELECT uid FROM trace_link WHERE from_uid=? AND to_uid=?`).get(revised.uid, resourceUid)
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
    expect(revised).toMatchObject({ uid: resourceUid, saveMode: 'updated' })
    const links = db
      .prepare(`SELECT to_uid,transform_note FROM trace_link WHERE from_uid=? ORDER BY to_uid`)
      .all(revised.uid) as { to_uid: string; transform_note: string }[]
    expect(links).toEqual([{ to_uid: other.resourceUid, transform_note: 'merge' }])
  })
  it('種別変更はitem_typeとstructure_jsonを同期し、旧Resourceの由来を移管する', () => {
    const origin = addIntermediateElement(db, projectUid, documentUid, {
      targetElementId: elementId,
      position: 'below',
      type: 'paragraph',
      text: '由来Resource'
    })
    const link = registerEntity(db, { projectUid, entityType: 'trace_link', createdBy: 'human' })
    db.prepare(
      `INSERT INTO trace_link (uid,from_uid,to_uid,relation_type,transform_note) VALUES (?,?,?,'based_on','duplicate')`
    ).run(link.uid, resourceUid, origin.resourceUid)
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
    expect(revised.saveMode).toBe('created-replaced')
    expect(item).toEqual({ item_type: 'resource_formula', resource_uid: revised.uid })
    expect(db.prepare(`SELECT uid FROM entity_registry WHERE uid=?`).get(resourceUid)).toBeUndefined()
    expect(
      db.prepare(`SELECT uid FROM trace_link WHERE from_uid=? AND to_uid=?`).get(revised.uid, origin.resourceUid)
    ).toBeTruthy()
    const row = db.prepare('SELECT structure_json FROM intermediate_document WHERE uid=?').get(documentUid) as {
      structure_json: string
    }
    const element = (JSON.parse(row.structure_json) as { elements: Array<{ resource_uid: string; text: string }> })
      .elements[0]!
    expect(element).toMatchObject({ resource_uid: revised.uid, text: 'x + 1' })
  })
})
