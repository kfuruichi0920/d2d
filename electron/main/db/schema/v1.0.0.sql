-- D2D project.db schema v1.0.0
-- 単一 SQLite DB。全テーブルをこのファイルで定義する。
-- 実行前に PRAGMA foreign_keys = ON が有効になっていること。

-- ============================================================
-- プロジェクト管理
-- ============================================================

CREATE TABLE IF NOT EXISTS project (
  uid            TEXT NOT NULL PRIMARY KEY,
  name           TEXT NOT NULL,
  description    TEXT,
  root_path      TEXT,
  schema_version TEXT NOT NULL DEFAULT '1.0.0',
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS project_artifact_setting (
  uid              TEXT    NOT NULL PRIMARY KEY,
  project_uid      TEXT    NOT NULL REFERENCES project(uid),
  artifact_name    TEXT    NOT NULL CHECK(artifact_name != ''),
  artifact_type_id TEXT    NOT NULL CHECK(artifact_type_id != ''),
  sort_order       INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  is_active        INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at       TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(project_uid, artifact_name)
);

CREATE TABLE IF NOT EXISTS project_artifact_relation (
  uid                  TEXT    NOT NULL PRIMARY KEY,
  project_uid          TEXT    NOT NULL REFERENCES project(uid),
  parent_artifact_uid  TEXT    NOT NULL REFERENCES project_artifact_setting(uid),
  child_artifact_uid   TEXT    NOT NULL REFERENCES project_artifact_setting(uid),
  sort_order           INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  is_active            INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at           TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK(parent_artifact_uid != child_artifact_uid),
  UNIQUE(project_uid, parent_artifact_uid, child_artifact_uid)
);

CREATE TABLE IF NOT EXISTS project_dev_phase_setting (
  uid            TEXT    NOT NULL PRIMARY KEY,
  project_uid    TEXT    NOT NULL REFERENCES project(uid),
  dev_phase_id   TEXT    NOT NULL CHECK(dev_phase_id != ''),
  dev_phase_name TEXT    NOT NULL CHECK(dev_phase_name != ''),
  sort_order     INTEGER NOT NULL DEFAULT 0 CHECK(sort_order >= 0),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK(is_active IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(project_uid, dev_phase_id)
);

-- ============================================================
-- 取込管理
-- ============================================================

CREATE TABLE IF NOT EXISTS batch_operation_info (
  uid            TEXT NOT NULL PRIMARY KEY,
  project_uid    TEXT NOT NULL REFERENCES project(uid),
  batch_type     TEXT NOT NULL CHECK(batch_type IN ('import', 'extract', 'llm', 'export')),
  status         TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'running', 'success', 'failed', 'cancelled')),
  settings_json  TEXT,
  executed_by    TEXT,
  started_at     TEXT,
  completed_at   TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ============================================================
-- 共通台帳
-- CHECK の entity_type 許容値はDB-to-Text用途も含めて全物理テーブル名を列挙する
-- project・project_artifact_* は設計リソースではないが列挙に含める（§10.1）
-- ============================================================

CREATE TABLE IF NOT EXISTS entity_registry (
  uid                  TEXT NOT NULL PRIMARY KEY,
  project_uid          TEXT NOT NULL REFERENCES project(uid),
  entity_type          TEXT NOT NULL CHECK(entity_type IN (
    'source_document', 'source_location', 'blob_resource',
    'extracted_document', 'extracted_item',
    'intermediate_document', 'intermediate_item',
    'chunk', 'chunk_item',
    'resource_label', 'resource_text', 'resource_list',
    'resource_figure', 'resource_table', 'resource_formula',
    'resource_code', 'resource_model', 'resource_scenario',
    'resource_interface', 'resource_state_transition',
    'resource_data_structure', 'resource_reference',
    'resource_metadata', 'resource_glossary', 'resource_glossary_synonym',
    'trace_link', 'llm_run_ref', 'batch_operation_info',
    'project', 'project_artifact_setting', 'project_artifact_relation',
    'project_dev_phase_setting'
  )),
  code                 TEXT NOT NULL,
  title                TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft', 'review', 'approved', 'rejected', 'deleted')),
  review_info_json     TEXT,
  memo_json            TEXT,
  created_by           TEXT,
  updated_by           TEXT,
  batch_operation_uid  TEXT REFERENCES batch_operation_info(uid),
  source_hash          TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(entity_type, code)
);

-- ============================================================
-- 原本・blob参照
-- ============================================================

CREATE TABLE IF NOT EXISTS blob_resource (
  uid           TEXT    NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  relative_path TEXT    NOT NULL,
  mime_type     TEXT,
  byte_size     INTEGER NOT NULL DEFAULT 0 CHECK(byte_size >= 0),
  sha256        TEXT,
  description   TEXT
);

CREATE TABLE IF NOT EXISTS source_document (
  uid           TEXT    NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  file_name     TEXT    NOT NULL,
  file_type     TEXT    NOT NULL,
  blob_uid      TEXT    REFERENCES blob_resource(uid),
  file_hash     TEXT,
  version_label TEXT,
  imported_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  is_current    INTEGER NOT NULL DEFAULT 1 CHECK(is_current IN (0, 1))
);

CREATE TABLE IF NOT EXISTS source_location (
  uid                  TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  source_document_uid  TEXT NOT NULL REFERENCES source_document(uid),
  page_no_start        INTEGER,
  page_no_end          INTEGER,
  sheet_name           TEXT,
  cell_start           TEXT,
  cell_end             TEXT,
  section_path         TEXT,
  bbox_json            TEXT,
  note                 TEXT
);

-- ============================================================
-- 抽出データ
-- ============================================================

CREATE TABLE IF NOT EXISTS extracted_document (
  uid                  TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  source_document_uid  TEXT NOT NULL REFERENCES source_document(uid),
  extraction_status    TEXT NOT NULL DEFAULT 'pending'
    CHECK(extraction_status IN ('pending', 'running', 'success', 'failed', 'partial')),
  extractor_name       TEXT,
  extractor_version    TEXT,
  structure_json       TEXT,
  raw_manifest_json    TEXT,
  extracted_at         TEXT
);

CREATE TABLE IF NOT EXISTS extracted_item (
  uid                    TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  extracted_document_uid TEXT NOT NULL REFERENCES extracted_document(uid),
  source_document_uid    TEXT NOT NULL REFERENCES source_document(uid),
  source_location_uid    TEXT REFERENCES source_location(uid),
  item_type              TEXT NOT NULL,
  resource_uid           TEXT REFERENCES entity_registry(uid)
);

-- ============================================================
-- 中間データ
-- ============================================================

CREATE TABLE IF NOT EXISTS intermediate_document (
  uid                           TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  source_extracted_document_uid TEXT REFERENCES extracted_document(uid),
  artifact_type_id              TEXT,
  dev_phase_id                  TEXT,
  intermediate_status           TEXT NOT NULL DEFAULT 'pending'
    CHECK(intermediate_status IN ('pending', 'running', 'success', 'failed', 'partial')),
  processor_name                TEXT,
  processor_version             TEXT,
  structure_json                TEXT,
  settings_json                 TEXT,
  generated_at                  TEXT
);

CREATE TABLE IF NOT EXISTS intermediate_item (
  uid                       TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  intermediate_document_uid TEXT NOT NULL REFERENCES intermediate_document(uid),
  item_type                 TEXT NOT NULL,
  resource_uid              TEXT REFERENCES entity_registry(uid)
);

CREATE TABLE IF NOT EXISTS chunk (
  uid                       TEXT    NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  intermediate_document_uid TEXT    NOT NULL REFERENCES intermediate_document(uid),
  token_count               INTEGER NOT NULL DEFAULT 0 CHECK(token_count >= 0),
  created_at                TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE TABLE IF NOT EXISTS chunk_item (
  uid                   TEXT    NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  chunk_uid             TEXT    NOT NULL REFERENCES chunk(uid),
  intermediate_item_uid TEXT    NOT NULL REFERENCES intermediate_item(uid),
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(chunk_uid, intermediate_item_uid)
);

-- ============================================================
-- 設計リソース（16種）
-- ============================================================

CREATE TABLE IF NOT EXISTS resource_label (
  uid                  TEXT    NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  label_text           TEXT    NOT NULL,
  label_kind           TEXT    CHECK(label_kind IN ('document','chapter','section','item','figure','table','model','other')),
  numbering            TEXT,
  level                INTEGER CHECK(level >= 0),
  style_name           TEXT,
  target_resource_uid  TEXT    REFERENCES entity_registry(uid)
);

CREATE TABLE IF NOT EXISTS resource_text (
  uid             TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  text_body       TEXT NOT NULL,
  text_role       TEXT CHECK(text_role IN ('body','description','note','remark','footnote','comment','other')),
  language        TEXT,
  sentences_json  TEXT,
  context_json    TEXT
);

CREATE TABLE IF NOT EXISTS resource_list (
  uid         TEXT    NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  list_kind   TEXT    CHECK(list_kind IN ('ordered','unordered','check','definition','other')),
  item_count  INTEGER NOT NULL DEFAULT 0 CHECK(item_count >= 0),
  items_json  TEXT,
  max_level   INTEGER CHECK(max_level >= 0)
);

CREATE TABLE IF NOT EXISTS resource_figure (
  uid              TEXT    NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  image_uri        TEXT    NOT NULL,
  image_hash       TEXT,
  figure_kind      TEXT    CHECK(figure_kind IN ('architecture','flow','screen','state','layout','other')),
  width            INTEGER CHECK(width > 0),
  height           INTEGER CHECK(height > 0),
  ocr_texts_json   TEXT,
  objects_json     TEXT,
  caption_uid      TEXT    REFERENCES entity_registry(uid)
);

CREATE TABLE IF NOT EXISTS resource_table (
  uid                   TEXT    NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  table_title           TEXT,
  row_count             INTEGER NOT NULL DEFAULT 0 CHECK(row_count >= 0),
  column_count          INTEGER NOT NULL DEFAULT 0 CHECK(column_count >= 0),
  table_kind            TEXT    CHECK(table_kind IN ('data','interface','state_transition','function_list','matrix','other')),
  header_rows_json      TEXT,
  header_columns_json   TEXT,
  cells_json            TEXT,
  source_range          TEXT
);

CREATE TABLE IF NOT EXISTS resource_formula (
  uid              TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  formula_text     TEXT NOT NULL,
  formula_format   TEXT CHECK(formula_format IN ('latex','mathml','excel','plain','other')),
  formula_kind     TEXT CHECK(formula_kind IN ('calculation','condition','constraint','performance','other')),
  variables_json   TEXT,
  units_json       TEXT,
  references_json  TEXT
);

CREATE TABLE IF NOT EXISTS resource_code (
  uid               TEXT    NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  code_text         TEXT    NOT NULL,
  language          TEXT,
  code_kind         TEXT    CHECK(code_kind IN ('source','pseudo','sql','config','command','idl','schema','other')),
  line_count        INTEGER CHECK(line_count >= 0),
  symbols_json      TEXT,
  syntax_tree_json  TEXT,
  parse_status      TEXT    NOT NULL DEFAULT 'not_parsed'
    CHECK(parse_status IN ('not_parsed','success','failed','partial'))
);

CREATE TABLE IF NOT EXISTS resource_model (
  uid                    TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  model_name             TEXT,
  model_kind             TEXT CHECK(model_kind IN ('uml','sysml','er','dfd','bpmn','mermaid','plantuml','other')),
  model_format           TEXT CHECK(model_format IN ('image','text','xmi','json','other')),
  model_source           TEXT,
  model_elements_json    TEXT,
  model_relations_json   TEXT,
  diagram_texts_json     TEXT,
  parse_status           TEXT NOT NULL DEFAULT 'not_parsed'
    CHECK(parse_status IN ('not_parsed','success','failed','partial'))
);

CREATE TABLE IF NOT EXISTS resource_scenario (
  uid                       TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  scenario_name             TEXT,
  actors_json               TEXT,
  trigger_text              TEXT,
  preconditions_json        TEXT,
  steps_json                TEXT,
  postconditions_json       TEXT,
  source_resource_uids_json TEXT
);

CREATE TABLE IF NOT EXISTS resource_interface (
  uid               TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  interface_name    TEXT,
  interface_kind    TEXT CHECK(interface_kind IN ('api','communication','file','db','screen','device','library','other')),
  provider          TEXT,
  consumer          TEXT,
  protocol          TEXT,
  operations_json   TEXT,
  inputs_json       TEXT,
  outputs_json      TEXT,
  errors_json       TEXT,
  timing            TEXT,
  constraints_json  TEXT
);

CREATE TABLE IF NOT EXISTS resource_state_transition (
  uid                       TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  state_machine_name        TEXT,
  states_json               TEXT,
  events_json               TEXT,
  transitions_json          TEXT,
  initial_state             TEXT,
  final_states_json         TEXT,
  source_resource_uids_json TEXT
);

CREATE TABLE IF NOT EXISTS resource_data_structure (
  uid                       TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  data_structure_name       TEXT,
  data_structure_kind       TEXT CHECK(data_structure_kind IN ('db_table','message','file','struct','record','screen_item','other')),
  fields_json               TEXT,
  keys_json                 TEXT,
  relations_json            TEXT,
  constraints_json          TEXT,
  source_resource_uids_json TEXT
);

CREATE TABLE IF NOT EXISTS resource_reference (
  uid                     TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  reference_text          TEXT NOT NULL,
  reference_kind          TEXT CHECK(reference_kind IN ('document','section','figure','table','url','id','footnote','other')),
  source_resource_uid     TEXT REFERENCES entity_registry(uid),
  target_resource_uid     TEXT REFERENCES entity_registry(uid),
  target_document_uid     TEXT REFERENCES source_document(uid),
  target_label_text       TEXT,
  resolution_status       TEXT NOT NULL DEFAULT 'unresolved'
    CHECK(resolution_status IN ('unresolved','candidate','resolved','ambiguous')),
  candidate_targets_json  TEXT,
  relation_candidate      TEXT
);

CREATE TABLE IF NOT EXISTS resource_metadata (
  uid                  TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  metadata_kind        TEXT NOT NULL
    CHECK(metadata_kind IN ('document','extraction','quality','review','version','diff','other')),
  target_resource_uid  TEXT REFERENCES entity_registry(uid),
  metadata_key         TEXT NOT NULL,
  metadata_value       TEXT,
  value_type           TEXT NOT NULL DEFAULT 'string'
    CHECK(value_type IN ('string','number','boolean','date','json')),
  unit                 TEXT,
  metadata_source      TEXT CHECK(metadata_source IN ('file','parser','user','system','other'))
);

-- ============================================================
-- LLM実行参照（resource_glossary の前に定義）
-- ============================================================

CREATE TABLE IF NOT EXISTS llm_run_ref (
  uid              TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  tool_name        TEXT,
  process_name     TEXT,
  model_name       TEXT,
  input_ref_type   TEXT,
  input_ref_uid    TEXT REFERENCES entity_registry(uid),
  prompt_blob_uid  TEXT REFERENCES blob_resource(uid),
  result_blob_uid  TEXT REFERENCES blob_resource(uid),
  status           TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending', 'running', 'success', 'failed', 'partial')),
  executed_at      TEXT
);

-- ============================================================
-- 用語集
-- ============================================================

CREATE TABLE IF NOT EXISTS resource_glossary (
  uid              TEXT    NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  term_text        TEXT    NOT NULL,
  normalized_text  TEXT    NOT NULL,
  definition       TEXT,
  abbreviation     TEXT,
  language         TEXT,
  category         TEXT,
  is_prohibited    INTEGER NOT NULL DEFAULT 0 CHECK(is_prohibited IN (0, 1)),
  llm_run_uid      TEXT    REFERENCES llm_run_ref(uid),
  confirmed_at     TEXT,
  UNIQUE(normalized_text, language)
);

CREATE TABLE IF NOT EXISTS resource_glossary_synonym (
  uid           TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  glossary_uid  TEXT NOT NULL REFERENCES resource_glossary(uid),
  synonym_text  TEXT NOT NULL,
  synonym_kind  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE(glossary_uid, synonym_text, synonym_kind)
);

-- ============================================================
-- トレース関係
-- ============================================================

CREATE TABLE IF NOT EXISTS trace_link (
  uid            TEXT NOT NULL PRIMARY KEY REFERENCES entity_registry(uid),
  from_uid       TEXT NOT NULL REFERENCES entity_registry(uid),
  to_uid         TEXT NOT NULL REFERENCES entity_registry(uid),
  relation_type  TEXT NOT NULL
    CHECK(relation_type IN (
      'derived_from', 'normalized_from', 'based_on',
      'satisfies', 'verifies', 'depends_on', 'refines', 'relates_to'
    )),
  direction      TEXT NOT NULL DEFAULT 'forward'
    CHECK(direction IN ('forward', 'bidirectional')),
  rationale      TEXT,
  confidence     REAL CHECK(confidence BETWEEN 0.0 AND 1.0),
  created_by     TEXT,
  llm_run_uid    TEXT REFERENCES llm_run_ref(uid),
  UNIQUE(from_uid, to_uid, relation_type)
);

-- ============================================================
-- インデックス（初期必須 + 初期推奨）
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS uq_entity_registry_type_code
  ON entity_registry(entity_type, code);
CREATE INDEX IF NOT EXISTS idx_entity_registry_project
  ON entity_registry(project_uid);
CREATE INDEX IF NOT EXISTS idx_entity_registry_type
  ON entity_registry(entity_type);
CREATE INDEX IF NOT EXISTS idx_entity_registry_status
  ON entity_registry(status);
CREATE INDEX IF NOT EXISTS idx_entity_registry_updated_at
  ON entity_registry(updated_at);
CREATE INDEX IF NOT EXISTS idx_entity_registry_source_hash
  ON entity_registry(source_hash);

CREATE INDEX IF NOT EXISTS idx_batch_operation_info_project
  ON batch_operation_info(project_uid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_artifact_setting_name
  ON project_artifact_setting(project_uid, artifact_name);
CREATE INDEX IF NOT EXISTS idx_project_artifact_setting_project
  ON project_artifact_setting(project_uid, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_artifact_relation_pair
  ON project_artifact_relation(project_uid, parent_artifact_uid, child_artifact_uid);
CREATE INDEX IF NOT EXISTS idx_project_artifact_relation_parent
  ON project_artifact_relation(project_uid, parent_artifact_uid, sort_order);
CREATE INDEX IF NOT EXISTS idx_project_artifact_relation_child
  ON project_artifact_relation(project_uid, child_artifact_uid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_project_dev_phase_setting_id
  ON project_dev_phase_setting(project_uid, dev_phase_id);
CREATE INDEX IF NOT EXISTS idx_project_dev_phase_setting_project
  ON project_dev_phase_setting(project_uid, sort_order);

CREATE INDEX IF NOT EXISTS idx_blob_resource_sha256
  ON blob_resource(sha256);
CREATE INDEX IF NOT EXISTS idx_source_document_file_hash
  ON source_document(file_hash);
CREATE INDEX IF NOT EXISTS idx_source_document_file_type
  ON source_document(file_type);
CREATE INDEX IF NOT EXISTS idx_source_location_document
  ON source_location(source_document_uid);

CREATE INDEX IF NOT EXISTS idx_extracted_document_source
  ON extracted_document(source_document_uid);
CREATE INDEX IF NOT EXISTS idx_extracted_document_status
  ON extracted_document(extraction_status);
CREATE INDEX IF NOT EXISTS idx_extracted_item_extracted_document
  ON extracted_item(extracted_document_uid);
CREATE INDEX IF NOT EXISTS idx_extracted_item_document
  ON extracted_item(source_document_uid);
CREATE INDEX IF NOT EXISTS idx_extracted_item_type
  ON extracted_item(item_type);
CREATE INDEX IF NOT EXISTS idx_extracted_item_resource
  ON extracted_item(resource_uid);

CREATE INDEX IF NOT EXISTS idx_intermediate_document_source
  ON intermediate_document(source_extracted_document_uid);
CREATE INDEX IF NOT EXISTS idx_intermediate_document_artifact_type
  ON intermediate_document(artifact_type_id);
CREATE INDEX IF NOT EXISTS idx_intermediate_document_dev_phase
  ON intermediate_document(dev_phase_id);
CREATE INDEX IF NOT EXISTS idx_intermediate_document_status
  ON intermediate_document(intermediate_status);
CREATE INDEX IF NOT EXISTS idx_intermediate_item_document
  ON intermediate_item(intermediate_document_uid);
CREATE INDEX IF NOT EXISTS idx_intermediate_item_type
  ON intermediate_item(item_type);
CREATE INDEX IF NOT EXISTS idx_intermediate_item_resource
  ON intermediate_item(resource_uid);

CREATE INDEX IF NOT EXISTS idx_chunk_document
  ON chunk(intermediate_document_uid);
CREATE UNIQUE INDEX IF NOT EXISTS uq_chunk_item_pair
  ON chunk_item(chunk_uid, intermediate_item_uid);
CREATE INDEX IF NOT EXISTS idx_chunk_item_chunk
  ON chunk_item(chunk_uid, sort_order);

CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_glossary_normalized_language
  ON resource_glossary(normalized_text, language);
CREATE INDEX IF NOT EXISTS idx_resource_glossary_text
  ON resource_glossary(term_text);
CREATE INDEX IF NOT EXISTS idx_resource_glossary_prohibited
  ON resource_glossary(is_prohibited);

CREATE UNIQUE INDEX IF NOT EXISTS uq_resource_glossary_synonym_text_kind
  ON resource_glossary_synonym(glossary_uid, synonym_text, synonym_kind);
CREATE INDEX IF NOT EXISTS idx_resource_glossary_synonym_glossary
  ON resource_glossary_synonym(glossary_uid);

CREATE UNIQUE INDEX IF NOT EXISTS uq_trace_link_pair_type
  ON trace_link(from_uid, to_uid, relation_type);
CREATE INDEX IF NOT EXISTS idx_trace_link_from_type
  ON trace_link(from_uid, relation_type);
CREATE INDEX IF NOT EXISTS idx_trace_link_to_type
  ON trace_link(to_uid, relation_type);
CREATE INDEX IF NOT EXISTS idx_trace_link_relation_type
  ON trace_link(relation_type);

CREATE INDEX IF NOT EXISTS idx_llm_run_input
  ON llm_run_ref(input_ref_uid);
