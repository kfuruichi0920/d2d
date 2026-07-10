/**
 * プロンプトテンプレート管理（P6-3、LLM-020〜023、NFR-031）。
 * template_name + template_version で版管理し、用途分類ごとに分ける。
 */
import type { Database } from 'better-sqlite3'
import { BackendError } from '../api/errors'
import { registerEntity } from '../store/entity-registry'

export const TEMPLATE_PURPOSES = [
  'extract',
  'summarize',
  'classify',
  'relation',
  'review',
  'normalize',
  'glossary',
  'other'
] as const
export type TemplatePurpose = (typeof TEMPLATE_PURPOSES)[number]

export interface PromptTemplateRow {
  uid: string
  code: string
  template_name: string
  template_version: string
  purpose: string
  template_text: string
  variables_json: string | null
  model_hint: string | null
  is_active: number
}

export function listPromptTemplates(db: Database, projectUid: string): PromptTemplateRow[] {
  return db
    .prepare(
      `SELECT e.uid, e.code, t.template_name, t.template_version, t.purpose, t.template_text,
              t.variables_json, t.model_hint, t.is_active
         FROM prompt_template t JOIN entity_registry e ON e.uid = t.uid
        WHERE e.project_uid = ? AND e.status <> 'deleted'
        ORDER BY t.template_name, t.template_version DESC`
    )
    .all(projectUid) as PromptTemplateRow[]
}

export interface SavePromptTemplateInput {
  templateName: string
  templateVersion: string
  purpose: TemplatePurpose
  templateText: string
  variables?: string[]
  modelHint?: string
}

/** 新しい版として登録する（既存版の上書きはしない = バージョン管理。LLM-021） */
export function savePromptTemplate(
  db: Database,
  projectUid: string,
  input: SavePromptTemplateInput
): PromptTemplateRow {
  if (!input.templateName || !input.templateVersion || !input.templateText) {
    throw new BackendError('validation', 'templateName / templateVersion / templateText は必須です', '')
  }
  if (!TEMPLATE_PURPOSES.includes(input.purpose)) {
    throw new BackendError('validation', `不正な用途分類です: ${input.purpose}`, '')
  }
  const { uid } = registerEntity(db, {
    projectUid,
    entityType: 'prompt_template',
    title: `${input.templateName}@${input.templateVersion}`,
    createdBy: 'user'
  })
  try {
    db.prepare(
      `INSERT INTO prompt_template (uid, template_name, template_version, purpose, template_text, variables_json, model_hint)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      uid,
      input.templateName,
      input.templateVersion,
      input.purpose,
      input.templateText,
      input.variables ? JSON.stringify(input.variables) : null,
      input.modelHint ?? null
    )
  } catch (err) {
    if (err instanceof Error && /UNIQUE/.test(err.message)) {
      throw new BackendError(
        'conflict',
        `同名・同版のテンプレートが既に存在します: ${input.templateName}@${input.templateVersion}`,
        ''
      )
    }
    throw err
  }
  const row = db
    .prepare(
      `SELECT e.uid, e.code, t.template_name, t.template_version, t.purpose, t.template_text, t.variables_json, t.model_hint, t.is_active
         FROM prompt_template t JOIN entity_registry e ON e.uid = t.uid WHERE t.uid = ?`
    )
    .get(uid) as PromptTemplateRow
  return row
}

export function getPromptTemplate(db: Database, uid: string): PromptTemplateRow {
  const row = db
    .prepare(
      `SELECT e.uid, e.code, t.template_name, t.template_version, t.purpose, t.template_text, t.variables_json, t.model_hint, t.is_active
         FROM prompt_template t JOIN entity_registry e ON e.uid = t.uid WHERE t.uid = ?`
    )
    .get(uid) as PromptTemplateRow | undefined
  if (!row) {
    throw new BackendError('not_found', `テンプレートが見つかりません: ${uid}`, '')
  }
  return row
}

/** {{variable}} 形式の変数を展開する。未解決変数はエラーにする */
export function renderTemplate(templateText: string, variables: Record<string, string>): string {
  const rendered = templateText.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_match, name: string) => {
    if (!(name in variables)) {
      throw new BackendError('validation', `テンプレート変数が未指定です: ${name}`, '')
    }
    return variables[name]!
  })
  return rendered
}
