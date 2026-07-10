import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Database } from 'better-sqlite3'
import { closeDatabase, createDatabase, getProjectRow } from '../store/database'
import { listPromptTemplates, renderTemplate, savePromptTemplate } from './prompt-templates'

describe('プロンプトテンプレート管理（P6-3、LLM-020〜023）', () => {
  let dir: string
  let db: Database
  let projectUid: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-tpl-'))
    db = createDatabase(join(dir, 'project.db'), { projectName: 'p' })
    projectUid = getProjectRow(db).uid
  })

  afterEach(() => {
    closeDatabase(db)
    rmSync(dir, { recursive: true, force: true })
  })

  it('登録・一覧・バージョン管理ができる', () => {
    savePromptTemplate(db, projectUid, {
      templateName: '要求抽出',
      templateVersion: '1.0.0',
      purpose: 'extract',
      templateText: '次の本文から要求を抽出せよ: {{body}}'
    })
    savePromptTemplate(db, projectUid, {
      templateName: '要求抽出',
      templateVersion: '1.1.0',
      purpose: 'extract',
      templateText: '次の本文から要求候補を JSON で抽出せよ: {{body}}'
    })

    const list = listPromptTemplates(db, projectUid)
    expect(list).toHaveLength(2)
    expect(list.map((t) => t.template_version)).toEqual(['1.1.0', '1.0.0'])
    expect(list[0]!.code).toMatch(/^PROMPT-\d{6}$/)

    // 同名・同版は conflict（上書きせず新版を作る運用）
    expect(() =>
      savePromptTemplate(db, projectUid, {
        templateName: '要求抽出',
        templateVersion: '1.0.0',
        purpose: 'extract',
        templateText: 'x'
      })
    ).toThrowError(/既に存在/)
  })

  it('renderTemplate が {{変数}} を展開し、未指定変数はエラーにする', () => {
    expect(renderTemplate('本文: {{body}} / 観点: {{aspect}}', { body: 'AAA', aspect: '要求' })).toBe(
      '本文: AAA / 観点: 要求'
    )
    expect(() => renderTemplate('{{missing}}', {})).toThrowError(/未指定/)
  })
})
