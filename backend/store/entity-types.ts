/**
 * entity_type と表示コード prefix の対応（sdd_data_structure §10.1）。
 */

export const ENTITY_CODE_PREFIX = {
  project: 'PRJ',
  batch_operation_info: 'BATCH',
  source_document: 'DOC',
  source_location: 'LOC',
  blob_resource: 'BLOB',
  extracted_document: 'EXDOC',
  extracted_item: 'EXT',
  intermediate_document: 'IMDOC',
  intermediate_item: 'IMITEM',
  chunk: 'CHUNK',
  chunk_item: 'CHITEM',
  resource_label: 'LABEL',
  resource_text: 'TEXT',
  resource_list: 'LIST',
  resource_figure: 'FIG',
  resource_table: 'RTBL',
  resource_formula: 'FORM',
  resource_code: 'CODE',
  resource_model: 'MODEL',
  resource_scenario: 'SCN',
  resource_interface: 'IF',
  resource_state_transition: 'STM',
  resource_data_structure: 'DATA',
  resource_reference: 'REF',
  resource_metadata: 'META',
  resource_glossary: 'GLOSS',
  resource_glossary_synonym: 'GSYN',
  trace_link: 'TRACE',
  llm_run_ref: 'LLM',
  prompt_template: 'PROMPT'
} as const

export type EntityType = keyof typeof ENTITY_CODE_PREFIX

/** 設計13分類（SRS §9.1）。④昇格済みリソースは分類を code prefix として採番できる（§10.1） */
export const DESIGN_CATEGORIES = [
  'SRC',
  'STD',
  'REQ',
  'CST',
  'FUNC',
  'STRUCT',
  'BEH',
  'STATE',
  'IF',
  'DATA',
  'VERIF',
  'MGMT',
  'IMPL'
] as const

export type DesignCategory = (typeof DESIGN_CATEGORIES)[number]

export const ENTITY_STATUSES = ['draft', 'review', 'approved', 'rejected', 'deleted'] as const
export type EntityStatus = (typeof ENTITY_STATUSES)[number]
