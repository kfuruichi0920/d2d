/** entity_type と表示コード prefix の対応（sdd_data_structure §10.1）。 */
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
  resource_reference: 'REF',
  resource_glossary: 'GLOSS',
  resource_glossary_synonym: 'GSYN',
  model_src: 'SRC',
  model_std: 'STD',
  model_req: 'REQ',
  model_cst: 'CST',
  model_func: 'FUNC',
  model_struct: 'STRUCT',
  model_beh: 'BEH',
  model_state: 'STATE',
  model_data: 'DATA',
  model_if: 'IF',
  model_verif: 'VERIF',
  model_impl: 'IMPL',
  model_mgmt: 'MGMT',
  trace_link: 'TRACE',
  llm_run_ref: 'LLM',
  prompt_template: 'PROMPT'
} as const

export type EntityType = keyof typeof ENTITY_CODE_PREFIX

/** ④設計モデルの組込物理テーブル（SRS §9.1、schema 2.0.0）。 */
export const BUILTIN_MODEL_TYPES = [
  'model_src',
  'model_std',
  'model_req',
  'model_cst',
  'model_func',
  'model_struct',
  'model_beh',
  'model_state',
  'model_data',
  'model_if',
  'model_verif',
  'model_impl',
  'model_mgmt'
] as const
export type BuiltinModelType = (typeof BUILTIN_MODEL_TYPES)[number]
export type ModelType = `model_${string}`

export const ENTITY_STATUSES = ['draft', 'review', 'approved', 'rejected', 'deleted'] as const
export type EntityStatus = (typeof ENTITY_STATUSES)[number]
