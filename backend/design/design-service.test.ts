import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { createProjectLayout } from '../project/layout'
import { importSourceDocument } from '../import/import-service'
import { storeExtractionResult } from '../extract/store-extraction'
import { createChunk, createIntermediateDocument } from '../intermediate/intermediate-service'
import { buildDesignCandidateMessages } from '../llm/request-messages'
import { saveModelDefinition, saveRelationDefinition } from '../ontology/ontology-service'
import {
  adoptCandidates,
  checkRelationAllowed,
  createDesignElement,
  createTraceLink,
  listDesignElements,
  listAllowedRelationRules,
  listTraceLinks,
  updateDesignElement
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
    const req = createDesignElement(db, projectUid, { modelType: 'model_req', title: '応答時間要求' })
    const func = createDesignElement(db, projectUid, {
      modelType: 'model_func',
      title: '応答処理機能',
      summary: '要求を処理する'
    })
    expect(req.code).toBe('REQ-000001')
    expect(func.code).toBe('FUNC-000001')

    const list = listDesignElements(db, projectUid)
    expect(list).toHaveLength(2)
    expect(list.find((e) => e.code === 'FUNC-000001')?.summary).toBe('要求を処理する')

    const onlyReq = listDesignElements(db, projectUid, { modelType: 'model_req' })
    expect(onlyReq).toHaveLength(1)
  })

  it('定義駆動の独自項目型を登録・更新時に検証し、不正入力を正本へ残さない', () => {
    const before = (
      db.prepare(`SELECT COUNT(*) AS n FROM entity_registry WHERE entity_type='model_func'`).get() as {
        n: number
      }
    ).n
    expect(() =>
      createDesignElement(db, projectUid, {
        modelType: 'model_func',
        title: '不正な機能',
        detail: { inputs: '{invalid json' }
      })
    ).toThrowError(/有効なJSON/)
    expect(
      (db.prepare(`SELECT COUNT(*) AS n FROM entity_registry WHERE entity_type='model_func'`).get() as { n: number }).n
    ).toBe(before)

    const created = createDesignElement(db, projectUid, {
      modelType: 'model_struct',
      title: '構造要素',
      detail: { structure_kind: 'component' }
    })
    expect(() =>
      updateDesignElement(db, created.uid, {
        title: '更新後',
        summary: '更新後',
        detail: { structure_kind: 'unsupported-kind' }
      })
    ).toThrowError(/選択肢/)
    expect(listDesignElements(db, projectUid).find((element) => element.uid === created.uid)?.title).toBe('構造要素')
    expect(() => db.prepare(`UPDATE model_struct SET detail_json='[]' WHERE uid=?`).run(created.uid)).toThrow()
  })
  it('LLM導出入力は有効なモデル・関係定義と許容組合せだけを使用する', () => {
    const req = db
      .prepare(
        `SELECT code_prefix,label,layer,field_schema_json FROM ontology_model_definition WHERE model_type='model_req'`
      )
      .get() as { code_prefix: string; label: string; layer: string; field_schema_json: string }
    saveModelDefinition(db, {
      modelType: 'model_req',
      codePrefix: req.code_prefix,
      label: req.label,
      layer: req.layer,
      definition: 'プロジェクト固有の要求定義。',
      fieldSchemaJson: req.field_schema_json,
      enabled: true
    })
    const std = db
      .prepare(
        `SELECT code_prefix,label,layer,definition,field_schema_json FROM ontology_model_definition WHERE model_type='model_std'`
      )
      .get() as {
      code_prefix: string
      label: string
      layer: string
      definition: string
      field_schema_json: string
    }
    saveModelDefinition(db, {
      modelType: 'model_std',
      codePrefix: std.code_prefix,
      label: std.label,
      layer: std.layer,
      definition: std.definition,
      fieldSchemaJson: std.field_schema_json,
      enabled: false
    })
    saveRelationDefinition(db, {
      relationType: 'satisfies',
      label: '充足',
      definition: 'プロジェクト固有の充足関係定義。',
      enabled: true
    })
    const chunk = createChunk(db, projectUid, intermediateUid, ['i1'], undefined, '要求だけを重点抽出する')
    const messages = buildDesignCandidateMessages(db, chunk.chunkUid)
    expect(messages[0]!.content).toContain('プロジェクト固有の要求定義。')
    expect(messages[0]!.content).toContain('プロジェクト固有の充足関係定義。')
    expect(messages[0]!.content).not.toContain('"model_type":"model_std"')
    expect(messages[0]!.content).not.toContain('"source_model_type":"model_std"')
    expect(messages[0]!.content).not.toContain('"target_model_type":"model_std"')
    expect(messages[1]!.content).toContain('要求だけを重点抽出する')
  })
  it('checkRelationAllowed が ontology_relation_allowance を評価する（P8-2 / srs §9.4）', () => {
    expect(checkRelationAllowed(db, 'satisfies', 'model_func', 'model_req').allowed).toBe(true)
    expect(checkRelationAllowed(db, 'satisfies', 'model_req', 'model_func').allowed).toBe(false) // 逆方向は不許容
    expect(checkRelationAllowed(db, 'uses', 'model_struct', 'model_data')).toEqual({
      allowed: true,
      requiredAttr: 'usage_kind'
    })
    expect(checkRelationAllowed(db, 'relates_to', 'model_req', 'model_mgmt').allowed).toBe(true) // ANY
    expect(checkRelationAllowed(db, 'depends_on', 'model_req', 'model_func').allowed).toBe(false) // 非採用 relation_type
  })

  it('候補編集用に許容関係ルールを返す（MODEL-010）', () => {
    const rules = listAllowedRelationRules(db)
    expect(rules).toContainEqual({
      relationType: 'satisfies',
      sourceModelType: 'model_func',
      targetModelType: 'model_req',
      requiredAttr: null
    })
    expect(rules).toContainEqual({
      relationType: 'relates_to',
      sourceModelType: 'model_req',
      targetModelType: 'model_mgmt',
      requiredAttr: 'review_status'
    })
    expect(rules).not.toContainEqual({
      relationType: 'satisfies',
      sourceModelType: 'model_req',
      targetModelType: 'model_func'
    })
  })
  it('createTraceLink: 許容外・必須属性欠落・重複を拒否する（P8-2）', () => {
    const req = createDesignElement(db, projectUid, { modelType: 'model_req', title: 'R1' })
    const func = createDesignElement(db, projectUid, { modelType: 'model_func', title: 'F1' })
    const struct = createDesignElement(db, projectUid, { modelType: 'model_struct', title: 'S1' })
    const dataEl = createDesignElement(db, projectUid, { modelType: 'model_data', title: 'D1' })

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
          { temp_id: 't1', category: 'model_req', title: '応答時間要求', evidence: '応答は100ms以内。' },
          { temp_id: 't2', category: 'model_func', title: '応答処理機能' }
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

  it('候補採用時は設計要素から生成元チャンクへbased_onを付与する', () => {
    const chunk = createChunk(db, projectUid, intermediateUid, ['i1'])
    const result = adoptCandidates(db, projectUid, {
      intermediateDocumentUid: intermediateUid,
      chunkUid: chunk.chunkUid,
      candidateSet: {
        elements: [{ temp_id: 't1', category: 'model_req', title: 'チャンク由来要求', evidence: '応答は100ms以内。' }],
        relations: []
      }
    })
    const link = db
      .prepare(`SELECT to_uid FROM trace_link WHERE from_uid=? AND relation_type='based_on'`)
      .get(result.elements[0]!.uid) as { to_uid: string }
    expect(link.to_uid).toBe(chunk.chunkUid)
  })
  it('候補関係の必須属性が未入力なら仮値と作成中で採用する', () => {
    const result = adoptCandidates(db, projectUid, {
      intermediateDocumentUid: intermediateUid,
      candidateSet: {
        elements: [
          { temp_id: 'struct-01', category: 'model_struct', title: '利用側' },
          { temp_id: 'data-02', category: 'model_data', title: '利用データ' }
        ],
        relations: [{ from_temp_id: 'struct-01', to_temp_id: 'data-02', relation_type: 'uses' }]
      }
    })
    const link = db
      .prepare(`SELECT usage_kind,review_status FROM trace_link WHERE relation_type='uses' AND from_uid=?`)
      .get(result.elements.find((element) => element.tempId === 'struct-01')!.uid) as {
      usage_kind: string
      review_status: string
    }
    expect(link).toEqual({ usage_kind: 'read', review_status: 'creating' })
  })

  it('採用トランザクション: 許容外関係が 1 件でもあれば全体を反映しない（MODEL-009 同一トランザクション）', () => {
    const before = listDesignElements(db, projectUid).length
    expect(() =>
      adoptCandidates(db, projectUid, {
        intermediateDocumentUid: intermediateUid,
        candidateSet: {
          elements: [
            { temp_id: 't1', category: 'model_req', title: 'R' },
            { temp_id: 't2', category: 'model_func', title: 'F' }
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
        candidateSet: { elements: [{ temp_id: 't1', category: 'model_req', title: 'R' }], relations: [] }
      })
    ).toThrowError(/根拠/)
  })
})
