// T706: プロンプト管理 — テンプレート登録・バージョン管理

import { getDatabase } from '../db/database'
import { generateUid } from '../utils/uuid'

export type PromptPurpose = 'extract_terms' | 'generate_trace' | 'classify' | 'summarize' | 'review' | 'custom'

export interface PromptTemplate {
  uid: string
  name: string
  description: string | null
  purpose: PromptPurpose
  is_builtin: number
  created_at: string
  updated_at: string
}

export interface PromptVersion {
  uid: string
  template_uid: string
  version: number
  system_prompt: string | null
  user_template: string
  variables_json: string | null
  created_at: string
}

// ---- ビルトインテンプレート（初回起動時に挿入） -----------------------------

const BUILTIN_TEMPLATES: Array<{
  name: string
  description: string
  purpose: PromptPurpose
  system_prompt: string
  user_template: string
  variables_json: string
}> = [
  {
    name: '用語抽出',
    description: '文書テキストから専門用語・略語を抽出する',
    purpose: 'extract_terms',
    system_prompt: 'あなたは技術文書の専門用語を抽出するアシスタントです。JSONのみを返してください。',
    user_template: '以下のテキストから専門用語・略語・固有名詞を抽出してください。\n\n---\n{{text}}\n---\n\n出力形式: {"terms": [{"term": "...", "definition": "...", "abbreviation": "..."}]}',
    variables_json: '["text"]',
  },
  {
    name: 'トレースリンク候補生成',
    description: '設計要素間のトレースリンクを推薦する',
    purpose: 'generate_trace',
    system_prompt: 'あなたはシステム設計のトレーサビリティ専門家です。要素間の関係を分析しJSONで返してください。',
    user_template: '以下の要素間のトレースリンクを推薦してください。\n\n要素A: {{from_title}}\n{{from_content}}\n\n要素B: {{to_title}}\n{{to_content}}\n\n出力形式: {"relation_type": "derived_from|satisfies|...", "confidence": 0.0-1.0, "rationale": "理由"}',
    variables_json: '["from_title","from_content","to_title","to_content"]',
  },
  {
    name: '設計要素分類',
    description: '中間データアイテムを設計要素種別に分類する',
    purpose: 'classify',
    system_prompt: 'あなたはシステム設計文書の分類専門家です。JSONのみを返してください。',
    user_template: '以下のテキストを設計要素に分類してください。\n\nテキスト: {{text}}\n\n種別候補: label/text/list/table/code/model/scenario/interface/state_transition/data_structure\n\n出力形式: {"entity_type": "resource_xxx", "confidence": 0.0-1.0, "title": "要素タイトル"}',
    variables_json: '["text"]',
  },
  {
    name: '文書要約',
    description: '文書・章を要約する',
    purpose: 'summarize',
    system_prompt: 'あなたは技術文書の要約専門家です。',
    user_template: '以下の文書を日本語で{{max_sentences}}文以内に要約してください。\n\n---\n{{text}}\n---',
    variables_json: '["text","max_sentences"]',
  },
]

export function seedBuiltinTemplates(): void {
  const db = getDatabase()
  const count = (db.prepare('SELECT COUNT(*) as c FROM llm_prompt_template WHERE is_builtin=1').get() as { c: number }).c
  if (count > 0) return

  const insertTemplate = db.prepare(`
    INSERT OR IGNORE INTO llm_prompt_template (uid, name, description, purpose, is_builtin)
    VALUES (?, ?, ?, ?, 1)
  `)
  const insertVersion = db.prepare(`
    INSERT OR IGNORE INTO llm_prompt_version (uid, template_uid, version, system_prompt, user_template, variables_json)
    VALUES (?, ?, 1, ?, ?, ?)
  `)

  const txn = db.transaction(() => {
    for (const t of BUILTIN_TEMPLATES) {
      const tUid = generateUid()
      insertTemplate.run(tUid, t.name, t.description, t.purpose)
      insertVersion.run(generateUid(), tUid, t.system_prompt, t.user_template, t.variables_json)
    }
  })
  txn()
}

// ---- CRUD -------------------------------------------------------------------

export function listTemplates(): PromptTemplate[] {
  return getDatabase().prepare('SELECT * FROM llm_prompt_template ORDER BY is_builtin DESC, name').all() as PromptTemplate[]
}

export function getTemplate(uid: string): PromptTemplate | null {
  return (getDatabase().prepare('SELECT * FROM llm_prompt_template WHERE uid=?').get(uid) as PromptTemplate | undefined) ?? null
}

export function createTemplate(opts: { name: string; description?: string; purpose: PromptPurpose; systemPrompt?: string; userTemplate: string; variablesJson?: string }): string {
  const db = getDatabase()
  const tUid = generateUid()
  db.prepare(`
    INSERT INTO llm_prompt_template (uid, name, description, purpose)
    VALUES (?, ?, ?, ?)
  `).run(tUid, opts.name, opts.description ?? null, opts.purpose)
  db.prepare(`
    INSERT INTO llm_prompt_version (uid, template_uid, version, system_prompt, user_template, variables_json)
    VALUES (?, ?, 1, ?, ?, ?)
  `).run(generateUid(), tUid, opts.systemPrompt ?? null, opts.userTemplate, opts.variablesJson ?? null)
  return tUid
}

export function addTemplateVersion(templateUid: string, opts: { systemPrompt?: string; userTemplate: string; variablesJson?: string }): string {
  const db = getDatabase()
  const nextVer = ((db.prepare('SELECT MAX(version) as v FROM llm_prompt_version WHERE template_uid=?').get(templateUid) as { v: number }).v ?? 0) + 1
  const vUid = generateUid()
  db.prepare(`
    INSERT INTO llm_prompt_version (uid, template_uid, version, system_prompt, user_template, variables_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(vUid, templateUid, nextVer, opts.systemPrompt ?? null, opts.userTemplate, opts.variablesJson ?? null)
  db.prepare(`UPDATE llm_prompt_template SET updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE uid=?`).run(templateUid)
  return vUid
}

export function getLatestVersion(templateUid: string): PromptVersion | null {
  return (getDatabase().prepare(`
    SELECT * FROM llm_prompt_version WHERE template_uid=? ORDER BY version DESC LIMIT 1
  `).get(templateUid) as PromptVersion | undefined) ?? null
}

export function listVersions(templateUid: string): PromptVersion[] {
  return getDatabase().prepare('SELECT * FROM llm_prompt_version WHERE template_uid=? ORDER BY version DESC').all(templateUid) as PromptVersion[]
}

export function deleteTemplate(uid: string): void {
  getDatabase().prepare('DELETE FROM llm_prompt_template WHERE uid=? AND is_builtin=0').run(uid)
}

export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => variables[k] ?? `{{${k}}}`)
}
