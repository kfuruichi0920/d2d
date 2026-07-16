import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { importSourceDocument } from '../import/import-service'
import { storeExtractionResult } from '../extract/store-extraction'
import { createIntermediateDocument } from '../intermediate/intermediate-service'
import {
  adoptCandidates,
  checkRelationAllowed,
  createDesignElement,
  createTraceLink,
  listDesignElements,
  listAllowedRelationRules,
  listTraceLinks
} from './design-service'

describe('④設計モデル（P8）', () => {
  let dir: string
  let root: string
  let db: Database
  let projectUid: string
  let intermediateUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-design-'))
    root = join(dir, 'proj')
    createProjectLayout(root)
    db = createDatabase(join(root, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid

    // 根拠となる③中間文書を用意
    const src = join(dir, 'spec.docx')
    writeFileSync(src, 'dummy')
    const imported = importSourceDocument(db, projectUid, root, src)
    mkdirSync(join(dir, 'work'), { recursive: true })
    const stored = storeExtractionResult(db, {
      projectUid,
      projectRoot: root,
      sourceDocumentUid: imported.sourceDocumentUid,
      extraction: {
        metadata: { title: 't' },
        elements: [{ id: 'e1', type: 'paragraph', text: '応答は100ms以内。', section_path: '' }]
      },
      workDir: join(dir, 'work')
    })
    db.prepare(`UPDATE entity_registry SET status = 'approved' WHERE uid = ?`).run(stored.extractedDocumentUid)
    intermediateUid = createIntermediateDocument(db, projectUid, {
      extractedDocumentUids: [stored.extractedDocumentUid],
      artifactTypeId: 'design_doc',
      devPhaseId: 'DD'
    }).intermediateDocumentUid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('設計要素を13分類 prefix で採番して登録・一覧できる（P8-1 / MODEL-001/002）', () => {
    const req = createDesignElement(db, projectUid, { category: 'REQ', title: '応答時間要求' })
    const func = createDesignElement(db, projectUid, {
      category: 'FUNC',
      title: '応答処理機能',
      description: '要求を処理する'
    })
    expect(req.code).toBe('REQ-000001')
    expect(func.code).toBe('FUNC-000001')

    const list = listDesignElements(db, projectUid)
    expect(list).toHaveLength(2)
    expect(list.find((e) => e.code === 'FUNC-000001')?.description).toBe('要求を処理する')

    const onlyReq = listDesignElements(db, projectUid, { category: 'REQ' })
    expect(onlyReq).toHaveLength(1)
  })

  it('checkRelationAllowed が relation_rule_master を評価する（P8-2 / srs §9.4）', () => {
    expect(checkRelationAllowed(db, 'satisfies', 'FUNC', 'REQ').allowed).toBe(true)
    expect(checkRelationAllowed(db, 'satisfies', 'REQ', 'FUNC').allowed).toBe(false) // 逆方向は不許容
    expect(checkRelationAllowed(db, 'uses', 'STRUCT', 'IF')).toEqual({ allowed: true, requiredAttr: 'usage_kind' })
    expect(checkRelationAllowed(db, 'relates_to', 'REQ', 'MGMT').allowed).toBe(true) // ANY
    expect(checkRelationAllowed(db, 'depends_on', 'REQ', 'FUNC').allowed).toBe(false) // 非採用 relation_type
  })

  it('候補編集用に許容関係ルールを返す（MODEL-010）', () => {
    const rules = listAllowedRelationRules(db)
    expect(rules).toContainEqual({ relationType: 'satisfies', sourceCategory: 'FUNC', targetCategory: 'REQ' })
    expect(rules).toContainEqual({ relationType: 'relates_to', sourceCategory: 'ANY', targetCategory: 'ANY' })
    expect(rules).not.toContainEqual({ relationType: 'satisfies', sourceCategory: 'REQ', targetCategory: 'FUNC' })
  })
  it('createTraceLink: 許容外・必須属性欠落・重複を拒否する（P8-2）', () => {
    const req = createDesignElement(db, projectUid, { category: 'REQ', title: 'R1' })
    const func = createDesignElement(db, projectUid, { category: 'FUNC', title: 'F1' })
    const struct = createDesignElement(db, projectUid, { category: 'STRUCT', title: 'S1' })
    const dataEl = createDesignElement(db, projectUid, { category: 'DATA', title: 'D1' })

    // OK: FUNC -satisfies-> REQ
    createTraceLink(db, projectUid, {
      fromUid: func.uid,
      toUid: req.uid,
      relationType: 'satisfies',
      createdBy: 'human'
    })

    // NG: 許容外（REQ -satisfies-> FUNC）
    expect(() =>
      createTraceLink(db, projectUid, {
        fromUid: req.uid,
        toUid: func.uid,
        relationType: 'satisfies',
        createdBy: 'human'
      })
    ).toThrowError(/許容されない関係/)

    // NG: required_attr（uses は usage_kind 必須）
    expect(() =>
      createTraceLink(db, projectUid, {
        fromUid: struct.uid,
        toUid: dataEl.uid,
        relationType: 'uses',
        createdBy: 'human'
      })
    ).toThrowError(/usage_kind は必須/)
    // OK: usage_kind 指定
    createTraceLink(db, projectUid, {
      fromUid: struct.uid,
      toUid: dataEl.uid,
      relationType: 'uses',
      attributes: { usageKind: 'read' },
      createdBy: 'human'
    })

    // NG: 重複
    expect(() =>
      createTraceLink(db, projectUid, {
        fromUid: func.uid,
        toUid: req.uid,
        relationType: 'satisfies',
        createdBy: 'human'
      })
    ).toThrowError(/既に存在/)

    const links = listTraceLinks(db, projectUid, { uid: func.uid })
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ relation_type: 'satisfies', from_code: 'FUNC-000001', to_code: 'REQ-000001' })
  })

  it('採用トランザクション: 一時ID→UUIDv7、根拠リンク、関係を一括反映する（P8-5 / MODEL-009）', () => {
    const result = adoptCandidates(db, projectUid, {
      intermediateDocumentUid: intermediateUid,
      llmRunUid: undefined,
      candidateSet: {
        elements: [
          { temp_id: 't1', category: 'REQ', title: '応答時間要求', evidence: '応答は100ms以内。' },
          { temp_id: 't2', category: 'FUNC', title: '応答処理機能' }
        ],
        relations: [
          { from_temp_id: 't2', to_temp_id: 't1', relation_type: 'satisfies', rationale: '機能が要求を満たす' }
        ]
      }
    })

    expect(result.elements).toHaveLength(2)
    expect(result.relationCount).toBe(1)
    expect(result.basedOnCount).toBe(2)

    // 採用済み要素は approved（④正本）
    const elements = listDesignElements(db, projectUid)
    expect(elements.every((e) => e.status === 'approved')).toBe(true)

    // 根拠リンク: 要素 → ③中間文書（based_on / inferred / evidence_span）
    const reqUid = result.elements.find((e) => e.tempId === 't1')!.uid
    const basedOn = db
      .prepare(
        `SELECT basis_kind, evidence_span, to_uid FROM trace_link WHERE from_uid = ? AND relation_type = 'based_on'`
      )
      .get(reqUid) as { basis_kind: string; evidence_span: string; to_uid: string }
    expect(basedOn).toEqual({ basis_kind: 'inferred', evidence_span: '応答は100ms以内。', to_uid: intermediateUid })
  })

  it('採用トランザクション: 許容外関係が 1 件でもあれば全体を反映しない（MODEL-009 同一トランザクション）', () => {
    const before = listDesignElements(db, projectUid).length
    expect(() =>
      adoptCandidates(db, projectUid, {
        intermediateDocumentUid: intermediateUid,
        candidateSet: {
          elements: [
            { temp_id: 't1', category: 'REQ', title: 'R' },
            { temp_id: 't2', category: 'FUNC', title: 'F' }
          ],
          // REQ -satisfies-> FUNC は許容外
          relations: [{ from_temp_id: 't1', to_temp_id: 't2', relation_type: 'satisfies' }]
        }
      })
    ).toThrowError(/許容されない関係/)

    // 要素・関係とも一切反映されていない（ROLLBACK）
    expect(listDesignElements(db, projectUid)).toHaveLength(before)
    const linkCount = (
      db.prepare(`SELECT COUNT(*) AS n FROM trace_link WHERE relation_type = 'satisfies'`).get() as { n: number }
    ).n
    expect(linkCount).toBe(0)
  })

  it('採用トランザクション: 根拠（③中間文書）が無い場合は拒否する（根拠リンク不足）', () => {
    expect(() =>
      adoptCandidates(db, projectUid, {
        intermediateDocumentUid: '018fe6c2-0000-7000-8000-000000000000',
        candidateSet: { elements: [{ temp_id: 't1', category: 'REQ', title: 'R' }], relations: [] }
      })
    ).toThrowError(/根拠/)
  })
})
