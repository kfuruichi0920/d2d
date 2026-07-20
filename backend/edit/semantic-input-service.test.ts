import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { registerEntity } from '../store/entity-registry'
import { addSynonym, addTerm } from './glossary-service'
import {
  analyzeSemanticText,
  DEFAULT_SEMANTIC_POLICY,
  getSemanticText,
  parseStructuredSemanticText,
  saveSemanticText,
  searchSemanticCandidates
} from './semantic-input-service'

describe('セマンティック入力支援（P10-7、EDIT-057〜071）', () => {
  let dir: string, db: Database, projectUid: string, ownerUid: string, termUid: string, modelUid: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-semantic-'))
    db = createDatabase(join(dir, 'project.db'), { projectName: 'semantic' })
    projectUid = getProjectRow(db).uid
    const owner = registerEntity(db, {
      projectUid,
      entityType: 'resource_text',
      title: '要求本文',
      status: 'approved',
      createdBy: 'user'
    })
    ownerUid = owner.uid
    db.prepare(
      `INSERT INTO resource_text (uid,text_body,text_role,language) VALUES (?,'通信インターフェースを提供する','body','ja')`
    ).run(ownerUid)
    const term = addTerm(db, projectUid, { term: 'インターフェース', definition: '境界', approved: true })
    termUid = term.uid
    addSynonym(db, projectUid, term.uid, 'I/F', 'abbreviation')
    db.prepare(
      `UPDATE entity_registry SET status='approved' WHERE uid IN (SELECT uid FROM resource_glossary_synonym WHERE glossary_uid=?)`
    ).run(term.uid)
    const model = registerEntity(db, {
      projectUid,
      entityType: 'model_struct',
      title: '通信制御部',
      status: 'approved',
      createdBy: 'user'
    })
    modelUid = model.uid
    db.prepare(`INSERT INTO model_struct (uid,summary,detail_json) VALUES (?,'通信制御部','{}')`).run(model.uid)
  })
  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('未保存欄でも承認済み用語・モデルの完全一致を弱い参照として初期表示する', () => {
    const document = getSemanticText(db, projectUid, ownerUid, 'text_body', 'インターフェースを通信制御部へ接続する')
    expect(document.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ targetUid: termUid, status: 'approved', relationType: 'relates_to' }),
        expect.objectContaining({ targetUid: modelUid, status: 'approved', relationType: 'relates_to' })
      ])
    )
  })
  it('候補を最近使用／辞書／モデルでグループ化し短すぎる検索を抑止する', () => {
    expect(searchSemanticCandidates(db, projectUid, 'イ').tooBroad).toBe(true)
    const glossary = searchSemanticCandidates(db, projectUid, 'イン')
    expect(glossary.groups.glossary[0]).toMatchObject({ uid: termUid, kind: 'glossary' })
    const model = searchSemanticCandidates(db, projectUid, '通信')
    expect(model.groups.model[0]).toMatchObject({ uid: modelUid, kind: 'model' })
  })

  it('既存文章を認識して参照候補・正規化候補・未登録候補を返す', () => {
    const result = analyzeSemanticText(db, projectUid, 'I/Fは通信制御部からAPIを呼び出す')
    expect(result.references.map((r) => r.targetUid)).toEqual(expect.arrayContaining([termUid, modelUid]))
    expect(result.normalizations).toContainEqual(expect.objectContaining({ before: 'I/F', after: 'インターフェース' }))
    expect(result.unknownTerms).toContain('API')
  })

  it('原文を保持したまま表示文と承認参照を保存し弱いtraceを生成する', () => {
    const text = '通信制御部を参照する',
      start = 0,
      end = '通信制御部'.length
    const saved = saveSemanticText(db, projectUid, {
      ownerUid,
      fieldName: 'text_body',
      originalText: '元の文章',
      displayText: text,
      policy: DEFAULT_SEMANTIC_POLICY,
      references: [
        {
          startOffset: start,
          endOffset: end,
          surfaceText: '通信制御部',
          targetUid: modelUid,
          targetKind: 'model',
          displayMode: 'link',
          relationType: 'relates_to',
          status: 'approved',
          source: 'user'
        }
      ],
      normalization: { beforeText: '元の文章', afterText: text, method: 'user', status: 'approved' }
    })
    expect(saved.createdTraceLinks).toHaveLength(1)
    const loaded = getSemanticText(db, projectUid, ownerUid, 'text_body')
    expect(loaded.originalText).toBe('元の文章')
    expect(loaded.displayText).toBe(text)
    expect(loaded.references[0]).toMatchObject({ targetUid: modelUid, status: 'approved' })
    expect(loaded.history[0]).toMatchObject({ beforeText: '元の文章', afterText: text })
  })

  it('構造化直接編集はUID・文字範囲・関係ルールを検証する', () => {
    const valid = JSON.stringify({
      schemaVersion: 1,
      originalText: 'I/F',
      displayText: 'I/F',
      policy: DEFAULT_SEMANTIC_POLICY,
      references: [
        {
          startOffset: 0,
          endOffset: 3,
          surfaceText: 'I/F',
          targetUid: termUid,
          targetKind: 'glossary',
          displayMode: 'uid',
          relationType: 'relates_to',
          status: 'candidate',
          source: 'user'
        }
      ]
    })
    expect(parseStructuredSemanticText(db, projectUid, ownerUid, 'text_body', valid).references).toHaveLength(1)
    expect(() =>
      parseStructuredSemanticText(db, projectUid, ownerUid, 'text_body', valid.replace(termUid, 'missing'))
    ).toThrow(/存在/)
    const invalidSurface = JSON.stringify({
      ...JSON.parse(valid),
      references: [{ ...JSON.parse(valid).references[0], surfaceText: 'XX' }]
    })
    expect(() => parseStructuredSemanticText(db, projectUid, ownerUid, 'text_body', invalidSurface)).toThrow(
      /surfaceText/
    )
  })

  it('②③Resourceからの強い設計関係は拒否する', () => {
    expect(() =>
      saveSemanticText(db, projectUid, {
        ownerUid,
        fieldName: 'text_body',
        originalText: '要求本文',
        displayText: '要求本文',
        policy: DEFAULT_SEMANTIC_POLICY,
        references: [
          {
            startOffset: 0,
            endOffset: 4,
            surfaceText: '要求本文',
            targetUid: modelUid,
            targetKind: 'model',
            displayMode: 'link',
            relationType: 'allocated_to',
            status: 'approved',
            source: 'user'
          }
        ]
      })
    ).toThrow(/両端は model_\*/)
  })
})
