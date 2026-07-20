/**
 * project.db 初期スキーマ（schema_version 2.0.0）。
 * DDL は sdd_data_structure.md §7「SQLite DDL案」に従う。
 * 変更時は §10.4 のマイグレーション手順に従い、backend/db/migrations.ts へ追加する。
 */
export const INITIAL_SCHEMA_VERSION = '2.0.0'

export const INITIAL_SCHEMA_SQL = `
CREATE TABLE project (
    uid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    root_path TEXT,
    schema_version TEXT NOT NULL DEFAULT '2.0.0',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (length(uid) >= 32)
);

CREATE TABLE project_artifact_setting (
    uid TEXT PRIMARY KEY,
    project_uid TEXT NOT NULL,
    artifact_name TEXT NOT NULL,
    artifact_type_id TEXT NOT NULL,
    dev_phase_id TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_uid, dev_phase_id, artifact_name),
    UNIQUE (uid, project_uid),
    FOREIGN KEY (project_uid) REFERENCES project(uid) ON DELETE CASCADE
);

CREATE TABLE project_artifact_relation (
    uid TEXT PRIMARY KEY,
    project_uid TEXT NOT NULL,
    parent_artifact_uid TEXT NOT NULL,
    child_artifact_uid TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_uid, parent_artifact_uid, child_artifact_uid),
    CHECK (parent_artifact_uid <> child_artifact_uid),
    FOREIGN KEY (project_uid) REFERENCES project(uid) ON DELETE CASCADE,
    FOREIGN KEY (parent_artifact_uid, project_uid) REFERENCES project_artifact_setting(uid, project_uid) ON DELETE CASCADE,
    FOREIGN KEY (child_artifact_uid, project_uid) REFERENCES project_artifact_setting(uid, project_uid) ON DELETE CASCADE
);

CREATE TABLE project_dev_phase_setting (
    uid TEXT PRIMARY KEY,
    project_uid TEXT NOT NULL,
    dev_phase_id TEXT NOT NULL,
    dev_phase_name TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (project_uid, dev_phase_id),
    FOREIGN KEY (project_uid) REFERENCES project(uid) ON DELETE CASCADE
);

CREATE TABLE batch_operation_info (
    uid TEXT PRIMARY KEY,
    project_uid TEXT NOT NULL,
    batch_type TEXT NOT NULL CHECK (batch_type IN ('import', 'extract', 'llm', 'export')),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'running', 'success', 'failed', 'partial', 'aborted')),
    settings_json TEXT,
    executed_by TEXT,
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    completed_at TEXT,
    FOREIGN KEY (project_uid) REFERENCES project(uid) ON DELETE CASCADE
);

CREATE TABLE entity_registry (
    uid TEXT PRIMARY KEY,
    project_uid TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    code TEXT NOT NULL CHECK (code GLOB '*-[0-9][0-9][0-9][0-9][0-9][0-9]'),
    title TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'deleted')),
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    owner_uid TEXT,
    review_info_json TEXT,
    memo_json TEXT,
    created_by TEXT,
    updated_by TEXT,
    administrative_notes TEXT,
    batch_operation_uid TEXT,
    source_hash TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (entity_type, code),
    FOREIGN KEY (project_uid) REFERENCES project(uid) ON DELETE CASCADE,
    FOREIGN KEY (owner_uid) REFERENCES entity_registry(uid) ON DELETE SET NULL,
    FOREIGN KEY (batch_operation_uid) REFERENCES batch_operation_info(uid) ON DELETE SET NULL
);

CREATE TABLE blob_resource (
    uid TEXT PRIMARY KEY,
    relative_path TEXT NOT NULL,
    mime_type TEXT,
    byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
    sha256 TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE source_document (
    uid TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL CHECK (file_type IN ('word', 'excel', 'powerpoint', 'visio', 'pdf', 'text', 'markdown', 'csv', 'json', 'other')),
    blob_uid TEXT,
    file_hash TEXT NOT NULL,
    version_label TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    is_current INTEGER NOT NULL DEFAULT 1 CHECK (is_current IN (0, 1)),
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (blob_uid) REFERENCES blob_resource(uid) ON DELETE SET NULL
);

CREATE TABLE source_location (
    uid TEXT PRIMARY KEY,
    source_document_uid TEXT NOT NULL,
    page_no_start INTEGER CHECK (page_no_start IS NULL OR page_no_start >= 1),
    page_no_end INTEGER CHECK (page_no_end IS NULL OR page_no_end >= page_no_start),
    sheet_name TEXT,
    cell_start TEXT,
    cell_end TEXT,
    section_path TEXT,
    bbox_json TEXT,
    note TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (source_document_uid) REFERENCES source_document(uid) ON DELETE CASCADE
);

CREATE TABLE extracted_document (
    uid TEXT PRIMARY KEY,
    source_document_uid TEXT NOT NULL,
    extraction_status TEXT NOT NULL DEFAULT 'success'
        CHECK (extraction_status IN ('running', 'success', 'failed', 'partial')),
    extractor_name TEXT,
    extractor_version TEXT,
    structure_json TEXT NOT NULL,
    raw_manifest_json TEXT,
    extracted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (source_document_uid) REFERENCES source_document(uid) ON DELETE CASCADE
);

CREATE TABLE resource_label (
    uid TEXT PRIMARY KEY,
    label_text TEXT NOT NULL,
    label_kind TEXT CHECK (label_kind IS NULL OR label_kind IN ('document', 'chapter', 'section', 'item', 'figure', 'table', 'model', 'other')),
    numbering TEXT,
    level INTEGER CHECK (level IS NULL OR level >= 0),
    style_name TEXT,
    target_resource_uid TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (target_resource_uid) REFERENCES entity_registry(uid) ON DELETE SET NULL
);

CREATE TABLE resource_text (
    uid TEXT PRIMARY KEY,
    text_body TEXT NOT NULL,
    text_role TEXT CHECK (text_role IS NULL OR text_role IN ('body', 'description', 'note', 'remark', 'footnote', 'comment', 'other')),
    language TEXT,
    sentences_json TEXT,
    context_json TEXT,
    target_resource_uid TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (target_resource_uid) REFERENCES entity_registry(uid) ON DELETE SET NULL
);

CREATE TABLE resource_list (
    uid TEXT PRIMARY KEY,
    list_kind TEXT CHECK (list_kind IS NULL OR list_kind IN ('ordered', 'unordered', 'check', 'definition', 'other')),
    item_count INTEGER DEFAULT 0 CHECK (item_count IS NULL OR item_count >= 0),
    items_json TEXT,
    max_level INTEGER CHECK (max_level IS NULL OR max_level >= 0),
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE resource_figure (
    uid TEXT PRIMARY KEY,
    image_uri TEXT NOT NULL,
    image_hash TEXT,
    figure_number TEXT,
    caption TEXT,
    figure_kind TEXT CHECK (figure_kind IS NULL OR figure_kind IN ('architecture', 'flow', 'screen', 'state', 'layout', 'other')),
    width INTEGER CHECK (width IS NULL OR width > 0),
    height INTEGER CHECK (height IS NULL OR height > 0),
    ocr_texts_json TEXT,
    objects_json TEXT,
    caption_uid TEXT,
    byte_size INTEGER CHECK (byte_size IS NULL OR byte_size >= 0),
    image_format TEXT,
    description TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (caption_uid) REFERENCES entity_registry(uid) ON DELETE SET NULL
);

CREATE TABLE resource_table (
    uid TEXT PRIMARY KEY,
    table_title TEXT,
    row_count INTEGER NOT NULL DEFAULT 0 CHECK (row_count >= 0),
    column_count INTEGER NOT NULL DEFAULT 0 CHECK (column_count >= 0),
    table_kind TEXT CHECK (table_kind IS NULL OR table_kind IN ('data', 'interface', 'state_transition', 'function_list', 'matrix', 'other')),
    header_rows_json TEXT,
    header_columns_json TEXT,
    cells_json TEXT,
    source_range TEXT,
    description TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE resource_table_cell (
    uid TEXT PRIMARY KEY, table_uid TEXT NOT NULL, row_no INTEGER NOT NULL CHECK (row_no >= 0),
    col_no INTEGER NOT NULL CHECK (col_no >= 0), cell_text TEXT NOT NULL DEFAULT '', colspan INTEGER NOT NULL DEFAULT 1 CHECK (colspan >= 1),
    is_header INTEGER NOT NULL DEFAULT 0 CHECK (is_header IN (0, 1)), UNIQUE (table_uid, row_no, col_no),
    FOREIGN KEY (table_uid) REFERENCES resource_table(uid) ON DELETE CASCADE
);
CREATE TABLE resource_formula (
    uid TEXT PRIMARY KEY,
    formula_text TEXT NOT NULL,
    formula_format TEXT CHECK (formula_format IS NULL OR formula_format IN ('latex', 'mathml', 'excel', 'plain', 'other')),
    formula_kind TEXT CHECK (formula_kind IS NULL OR formula_kind IN ('calculation', 'condition', 'constraint', 'performance', 'other')),
    variables_json TEXT,
    units_json TEXT,
    references_json TEXT,
    description TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE resource_code (
    uid TEXT PRIMARY KEY,
    code_text TEXT NOT NULL,
    language TEXT,
    code_kind TEXT CHECK (code_kind IS NULL OR code_kind IN ('source', 'pseudo', 'sql', 'config', 'command', 'idl', 'schema', 'other')),
    line_count INTEGER CHECK (line_count IS NULL OR line_count >= 0),
    symbols_json TEXT,
    syntax_tree_json TEXT,
    parse_status TEXT NOT NULL DEFAULT 'not_parsed' CHECK (parse_status IN ('not_parsed', 'success', 'failed', 'partial')),
    description TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE resource_model (
    uid TEXT PRIMARY KEY,
    model_name TEXT,
    model_kind TEXT CHECK (model_kind IS NULL OR model_kind IN ('uml', 'sysml', 'er', 'dfd', 'bpmn', 'mermaid', 'plantuml', 'other')),
    model_format TEXT CHECK (model_format IS NULL OR model_format IN ('image', 'text', 'xmi', 'json', 'other')),
    model_source TEXT,
    model_elements_json TEXT,
    model_relations_json TEXT,
    diagram_texts_json TEXT,
    parse_status TEXT NOT NULL DEFAULT 'not_parsed' CHECK (parse_status IN ('not_parsed', 'success', 'failed', 'partial')),
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);





CREATE TABLE resource_reference (
    uid TEXT PRIMARY KEY,
    reference_text TEXT NOT NULL,
    reference_kind TEXT CHECK (reference_kind IS NULL OR reference_kind IN ('document', 'section', 'figure', 'table', 'url', 'id', 'footnote', 'other')),
    source_resource_uid TEXT,
    target_resource_uid TEXT,
    target_document_uid TEXT,
    target_label_text TEXT,
    resolution_status TEXT NOT NULL DEFAULT 'unresolved' CHECK (resolution_status IN ('unresolved', 'candidate', 'resolved', 'ambiguous')),
    candidate_targets_json TEXT,
    relation_candidate TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (source_resource_uid) REFERENCES entity_registry(uid) ON DELETE SET NULL,
    FOREIGN KEY (target_resource_uid) REFERENCES entity_registry(uid) ON DELETE SET NULL,
    FOREIGN KEY (target_document_uid) REFERENCES source_document(uid) ON DELETE SET NULL
);


CREATE TABLE prompt_template (
    uid TEXT PRIMARY KEY,
    template_name TEXT NOT NULL,
    template_version TEXT NOT NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('extract', 'summarize', 'classify', 'relation', 'review', 'normalize', 'glossary', 'other')),
    template_text TEXT NOT NULL,
    variables_json TEXT,
    model_hint TEXT,
    is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (template_name, template_version),
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE llm_run_ref (
    uid TEXT PRIMARY KEY,
    tool_name TEXT,
    process_name TEXT NOT NULL,
    model_name TEXT,
    prompt_template_uid TEXT,
    input_ref_type TEXT,
    input_ref_uid TEXT,
    input_tokens INTEGER CHECK (input_tokens IS NULL OR input_tokens >= 0),
    output_tokens INTEGER CHECK (output_tokens IS NULL OR output_tokens >= 0),
    estimated_cost REAL CHECK (estimated_cost IS NULL OR estimated_cost >= 0.0),
    duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
    error_detail TEXT,
    prompt_blob_uid TEXT,
    result_blob_uid TEXT,
    raw_request_blob_uid TEXT,
    raw_response_blob_uid TEXT,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed', 'partial')),
    executed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (prompt_template_uid) REFERENCES prompt_template(uid) ON DELETE SET NULL,
    FOREIGN KEY (input_ref_uid) REFERENCES entity_registry(uid) ON DELETE SET NULL,
    FOREIGN KEY (prompt_blob_uid) REFERENCES blob_resource(uid) ON DELETE SET NULL,
    FOREIGN KEY (result_blob_uid) REFERENCES blob_resource(uid) ON DELETE SET NULL
);

CREATE TABLE resource_glossary (
    uid TEXT PRIMARY KEY,
    term_text TEXT NOT NULL,
    normalized_text TEXT NOT NULL,
    definition TEXT,
    abbreviation TEXT,
    language TEXT NOT NULL DEFAULT 'ja' CHECK (language IN ('ja', 'en', 'other')),
    category TEXT,
    is_prohibited INTEGER NOT NULL DEFAULT 0 CHECK (is_prohibited IN (0, 1)),
    llm_run_uid TEXT,
    confirmed_at TEXT,
    dictionary_scope TEXT NOT NULL DEFAULT 'project',
    version_tag TEXT NOT NULL DEFAULT '1',
    is_deprecated INTEGER NOT NULL DEFAULT 0 CHECK (is_deprecated IN (0,1)),
    access_level TEXT NOT NULL DEFAULT 'write' CHECK (access_level IN ('read','write','none')),
    UNIQUE (normalized_text, language),
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (llm_run_uid) REFERENCES llm_run_ref(uid) ON DELETE SET NULL
);

CREATE TABLE resource_glossary_synonym (
    uid TEXT PRIMARY KEY,
    glossary_uid TEXT NOT NULL,
    synonym_text TEXT NOT NULL,
    synonym_kind TEXT NOT NULL CHECK (synonym_kind IN ('synonym', 'variant', 'abbreviation')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (glossary_uid, synonym_text, synonym_kind),
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (glossary_uid) REFERENCES resource_glossary(uid) ON DELETE CASCADE
);

CREATE TABLE semantic_text (
    uid TEXT PRIMARY KEY, project_uid TEXT NOT NULL, owner_uid TEXT NOT NULL, field_name TEXT NOT NULL,
    original_text TEXT NOT NULL, display_text TEXT NOT NULL, policy_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE (owner_uid, field_name),
    FOREIGN KEY (project_uid) REFERENCES project(uid) ON DELETE CASCADE, FOREIGN KEY (owner_uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);
CREATE TABLE semantic_reference (
    uid TEXT PRIMARY KEY, semantic_text_uid TEXT NOT NULL, start_offset INTEGER NOT NULL CHECK (start_offset >= 0),
    end_offset INTEGER NOT NULL CHECK (end_offset > start_offset), surface_text TEXT NOT NULL, target_uid TEXT NOT NULL,
    target_kind TEXT NOT NULL CHECK (target_kind IN ('glossary', 'model')), display_mode TEXT NOT NULL CHECK (display_mode IN ('link', 'string', 'id', 'uid')),
    relation_type TEXT NOT NULL DEFAULT 'relates_to', status TEXT NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'rejected')),
    source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'dictionary', 'morphology', 'llm')), confidence REAL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY (semantic_text_uid) REFERENCES semantic_text(uid) ON DELETE CASCADE,
    FOREIGN KEY (target_uid) REFERENCES entity_registry(uid)
);
CREATE TABLE semantic_normalization_history (
    uid TEXT PRIMARY KEY, semantic_text_uid TEXT NOT NULL, before_text TEXT NOT NULL, after_text TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('mechanical', 'dictionary', 'llm', 'user')),
    status TEXT NOT NULL CHECK (status IN ('candidate', 'approved', 'rejected', 'reverted')), detail_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL, decided_at TEXT, FOREIGN KEY (semantic_text_uid) REFERENCES semantic_text(uid) ON DELETE CASCADE
);
CREATE TABLE extracted_item (
    uid TEXT PRIMARY KEY,
    extracted_document_uid TEXT NOT NULL,
    source_document_uid TEXT NOT NULL,
    source_location_uid TEXT,
    item_type TEXT NOT NULL CHECK (item_type IN (
        'resource_label',
        'resource_text',
        'resource_list',
        'resource_figure',
        'resource_table',
        'resource_formula',
        'resource_code',
        'resource_model',
        'resource_reference'
    )),
    resource_uid TEXT NOT NULL,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (extracted_document_uid) REFERENCES extracted_document(uid) ON DELETE CASCADE,
    FOREIGN KEY (source_document_uid) REFERENCES source_document(uid) ON DELETE CASCADE,
    FOREIGN KEY (source_location_uid) REFERENCES source_location(uid) ON DELETE SET NULL,
    FOREIGN KEY (resource_uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE intermediate_document (
    uid TEXT PRIMARY KEY,
    source_extracted_document_uid TEXT,
    artifact_type_id TEXT NOT NULL,
    dev_phase_id TEXT NOT NULL,
    intermediate_status TEXT NOT NULL DEFAULT 'draft'
        CHECK (intermediate_status IN ('draft', 'processing', 'ready', 'failed', 'partial')),
    processor_name TEXT,
    processor_version TEXT,
    structure_json TEXT NOT NULL,
    settings_json TEXT,
    generated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (source_extracted_document_uid) REFERENCES extracted_document(uid) ON DELETE SET NULL
);

CREATE TABLE intermediate_item (
    uid TEXT PRIMARY KEY,
    intermediate_document_uid TEXT NOT NULL,
    item_type TEXT NOT NULL CHECK (item_type IN (
        'resource_label',
        'resource_text',
        'resource_list',
        'resource_figure',
        'resource_table',
        'resource_formula',
        'resource_code',
        'resource_model',
        'resource_reference'
    )),
    resource_uid TEXT NOT NULL,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (intermediate_document_uid) REFERENCES intermediate_document(uid) ON DELETE CASCADE,
    FOREIGN KEY (resource_uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE chunk (
    uid TEXT PRIMARY KEY,
    intermediate_document_uid TEXT NOT NULL,
    prompt_template_uid TEXT,
    additional_prompt TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    token_count INTEGER NOT NULL DEFAULT 0 CHECK (token_count >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (intermediate_document_uid) REFERENCES intermediate_document(uid) ON DELETE CASCADE,
    FOREIGN KEY (prompt_template_uid) REFERENCES prompt_template(uid) ON DELETE SET NULL
);

CREATE TABLE chunk_item (
    uid TEXT PRIMARY KEY,
    chunk_uid TEXT NOT NULL,
    intermediate_item_uid TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (chunk_uid, intermediate_item_uid),
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (chunk_uid) REFERENCES chunk(uid) ON DELETE CASCADE,
    FOREIGN KEY (intermediate_item_uid) REFERENCES intermediate_item(uid) ON DELETE CASCADE
);

CREATE TABLE ontology_version (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1), version TEXT NOT NULL DEFAULT '0.1.0',
    confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, confirmed_by TEXT
);
CREATE TABLE ontology_model_definition (
    model_type TEXT PRIMARY KEY CHECK (model_type GLOB 'model_[a-z0-9_]*'),
    code_prefix TEXT NOT NULL UNIQUE CHECK (code_prefix GLOB '[A-Z][A-Z0-9_]*'), label TEXT NOT NULL,
    layer TEXT NOT NULL, definition TEXT NOT NULL, field_schema_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(field_schema_json) AND json_type(field_schema_json)='array'),
    is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)), is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)),
    sort_order INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE ontology_relation_definition (
    relation_type TEXT PRIMARY KEY CHECK (relation_type GLOB '[a-z][a-z0-9_]*'), label TEXT NOT NULL, definition TEXT NOT NULL,
    required_attr TEXT, is_enabled INTEGER NOT NULL DEFAULT 1 CHECK (is_enabled IN (0, 1)),
    is_builtin INTEGER NOT NULL DEFAULT 0 CHECK (is_builtin IN (0, 1)), sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE ontology_relation_allowance (
    relation_type TEXT NOT NULL, source_model_type TEXT NOT NULL, target_model_type TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0, 1)), PRIMARY KEY (relation_type, source_model_type, target_model_type),
    FOREIGN KEY (relation_type) REFERENCES ontology_relation_definition(relation_type) ON DELETE CASCADE,
    FOREIGN KEY (source_model_type) REFERENCES ontology_model_definition(model_type),
    FOREIGN KEY (target_model_type) REFERENCES ontology_model_definition(model_type)
);
CREATE TABLE model_src (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_std (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_req (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_cst (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_func (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_struct (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_action (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_state (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_data (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_if (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_verif (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_impl (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);
CREATE TABLE model_mgmt (uid TEXT PRIMARY KEY, summary TEXT NOT NULL DEFAULT '', detail_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(detail_json) AND json_type(detail_json)='object'), model_version INTEGER NOT NULL DEFAULT 1, FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE);

CREATE TABLE trace_link (
    uid TEXT PRIMARY KEY,
    from_uid TEXT NOT NULL,
    to_uid TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'forward' CHECK (direction IN ('forward', 'bidirectional')),
    rationale TEXT,
    confidence REAL CHECK (confidence IS NULL OR (confidence >= 0.0 AND confidence <= 1.0)),
    created_by TEXT CHECK (created_by IS NULL OR created_by IN ('human', 'rule', 'llm')),
    review_status TEXT DEFAULT 'draft' CHECK (review_status IS NULL OR review_status IN ('draft', 'review', 'approved', 'rejected', 'provisional')),
    basis_kind TEXT CHECK (basis_kind IS NULL OR basis_kind IN ('original', 'extracted', 'normalized', 'inferred', 'human_approved')),
    evidence_span TEXT,
    transform_note TEXT,
    allocation_kind TEXT CHECK (allocation_kind IS NULL OR allocation_kind IN ('structure', 'behavior', 'state', 'interface', 'data')),
    allocation_role TEXT CHECK (allocation_role IS NULL OR allocation_role IN ('primary', 'supporting')),
    usage_kind TEXT CHECK (usage_kind IS NULL OR usage_kind IN ('input', 'output', 'read', 'write', 'update', 'publish', 'subscribe')),
    context_uid TEXT,
    condition TEXT,
    severity TEXT,
    conflict_status TEXT CHECK (conflict_status IS NULL OR conflict_status IN ('suspected', 'confirmed', 'resolved', 'dismissed')),
    resolution_note TEXT,
    llm_run_uid TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (from_uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (to_uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (context_uid) REFERENCES entity_registry(uid) ON DELETE SET NULL,
    FOREIGN KEY (llm_run_uid) REFERENCES llm_run_ref(uid) ON DELETE SET NULL
);


CREATE INDEX idx_entity_registry_project ON entity_registry(project_uid);
CREATE INDEX idx_entity_registry_type ON entity_registry(entity_type);
CREATE INDEX idx_entity_registry_status ON entity_registry(status);
CREATE INDEX idx_entity_registry_owner ON entity_registry(owner_uid);
CREATE INDEX idx_entity_registry_updated_at ON entity_registry(updated_at);
CREATE INDEX idx_entity_registry_source_hash ON entity_registry(source_hash);

CREATE INDEX idx_batch_operation_info_project ON batch_operation_info(project_uid);
CREATE INDEX idx_project_artifact_setting_project ON project_artifact_setting(project_uid, sort_order);
CREATE INDEX idx_project_artifact_relation_parent ON project_artifact_relation(project_uid, parent_artifact_uid, sort_order);
CREATE INDEX idx_project_artifact_relation_child ON project_artifact_relation(project_uid, child_artifact_uid);
CREATE INDEX idx_project_dev_phase_setting_project ON project_dev_phase_setting(project_uid, sort_order);

CREATE INDEX idx_blob_resource_sha256 ON blob_resource(sha256);
CREATE INDEX idx_blob_resource_mime_type ON blob_resource(mime_type);

CREATE INDEX idx_source_document_file_hash ON source_document(file_hash);
CREATE INDEX idx_source_document_file_type ON source_document(file_type);
CREATE INDEX idx_source_location_document ON source_location(source_document_uid);
CREATE INDEX idx_source_location_section ON source_location(section_path);

CREATE INDEX idx_extracted_document_source ON extracted_document(source_document_uid);
CREATE INDEX idx_extracted_document_status ON extracted_document(extraction_status);
CREATE INDEX idx_extracted_item_extracted_document ON extracted_item(extracted_document_uid);
CREATE INDEX idx_extracted_item_document ON extracted_item(source_document_uid);
CREATE INDEX idx_extracted_item_location ON extracted_item(source_location_uid);
CREATE INDEX idx_extracted_item_type ON extracted_item(item_type);
CREATE INDEX idx_extracted_item_resource ON extracted_item(resource_uid);
CREATE INDEX idx_intermediate_document_source ON intermediate_document(source_extracted_document_uid);
CREATE INDEX idx_intermediate_document_artifact_type ON intermediate_document(artifact_type_id);
CREATE INDEX idx_intermediate_document_dev_phase ON intermediate_document(dev_phase_id);
CREATE INDEX idx_intermediate_document_status ON intermediate_document(intermediate_status);
CREATE INDEX idx_intermediate_item_document ON intermediate_item(intermediate_document_uid);
CREATE INDEX idx_intermediate_item_type ON intermediate_item(item_type);
CREATE INDEX idx_intermediate_item_resource ON intermediate_item(resource_uid);
CREATE INDEX idx_chunk_document ON chunk(intermediate_document_uid);
CREATE INDEX idx_chunk_prompt_template ON chunk(prompt_template_uid);
CREATE INDEX idx_chunk_token_count ON chunk(token_count);
CREATE INDEX idx_chunk_item_chunk ON chunk_item(chunk_uid, sort_order);
CREATE INDEX idx_chunk_item_intermediate_item ON chunk_item(intermediate_item_uid);

CREATE INDEX idx_resource_label_kind ON resource_label(label_kind);
CREATE INDEX idx_resource_label_target ON resource_label(target_resource_uid);
CREATE INDEX idx_resource_text_role ON resource_text(text_role);
CREATE INDEX idx_resource_table_kind ON resource_table(table_kind);
CREATE INDEX idx_resource_figure_hash ON resource_figure(image_hash);
CREATE INDEX idx_resource_code_kind ON resource_code(code_kind);
CREATE INDEX idx_resource_model_kind ON resource_model(model_kind);
CREATE INDEX idx_resource_reference_source ON resource_reference(source_resource_uid);
CREATE INDEX idx_resource_reference_target ON resource_reference(target_resource_uid);
CREATE INDEX idx_resource_reference_status ON resource_reference(resolution_status);
CREATE INDEX idx_resource_glossary_text ON resource_glossary(term_text);
CREATE INDEX idx_resource_glossary_category ON resource_glossary(category);
CREATE INDEX idx_resource_glossary_prohibited ON resource_glossary(is_prohibited);
CREATE INDEX idx_resource_glossary_llm_run ON resource_glossary(llm_run_uid);
CREATE INDEX idx_resource_glossary_synonym_glossary ON resource_glossary_synonym(glossary_uid);
CREATE INDEX idx_resource_glossary_synonym_text ON resource_glossary_synonym(synonym_text);

CREATE INDEX idx_resource_table_cell_table ON resource_table_cell(table_uid, row_no, col_no);
CREATE INDEX idx_semantic_text_owner ON semantic_text(owner_uid, field_name);
CREATE INDEX idx_semantic_reference_text ON semantic_reference(semantic_text_uid, start_offset);
CREATE INDEX idx_semantic_reference_target ON semantic_reference(target_uid, status, updated_at);
CREATE INDEX idx_semantic_history_text ON semantic_normalization_history(semantic_text_uid, created_at);
CREATE INDEX idx_ontology_model_enabled ON ontology_model_definition(is_enabled, sort_order);
CREATE INDEX idx_ontology_relation_enabled ON ontology_relation_definition(is_enabled, sort_order);

CREATE INDEX idx_trace_link_pair_type ON trace_link(from_uid, to_uid, relation_type);
CREATE INDEX idx_trace_link_from_type ON trace_link(from_uid, relation_type);
CREATE INDEX idx_trace_link_to_type ON trace_link(to_uid, relation_type);
CREATE INDEX idx_trace_link_relation_type ON trace_link(relation_type);
CREATE INDEX idx_trace_link_review_status ON trace_link(review_status);
CREATE INDEX idx_trace_link_context ON trace_link(context_uid);

CREATE INDEX idx_llm_run_input ON llm_run_ref(input_ref_uid);
CREATE INDEX idx_llm_run_status ON llm_run_ref(status);
CREATE INDEX idx_llm_run_prompt_template ON llm_run_ref(prompt_template_uid);

CREATE VIRTUAL TABLE fts_entity_text USING fts5(
    uid UNINDEXED,
    entity_type UNINDEXED,
    code UNINDEXED,
    title,
    search_text,
    tokenize = 'unicode61'
);
`
