/**
 * project.db 初期スキーマ（schema_version 1.0.0）。
 * DDL は sdd_data_structure.md §7「SQLite DDL案」に従う。
 * 変更時は §10.4 のマイグレーション手順に従い、backend/db/migrations.ts へ追加する。
 */
export const INITIAL_SCHEMA_VERSION = '1.0.0'

export const INITIAL_SCHEMA_SQL = `
CREATE TABLE project (
    uid TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    root_path TEXT,
    schema_version TEXT NOT NULL DEFAULT '1.0.0',
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
    entity_type TEXT NOT NULL CHECK (entity_type IN (
        'project',
        'project_artifact_setting',
        'project_artifact_relation',
        'project_dev_phase_setting',
        'batch_operation_info',
        'source_document',
        'source_location',
        'blob_resource',
        'extracted_document',
        'extracted_item',
        'intermediate_document',
        'intermediate_item',
        'chunk',
        'chunk_item',
        'resource_label',
        'resource_text',
        'resource_list',
        'resource_figure',
        'resource_table',
        'resource_formula',
        'resource_code',
        'resource_model',
        'resource_scenario',
        'resource_interface',
        'resource_state_transition',
        'resource_data_structure',
        'resource_reference',
        'resource_metadata',
        'resource_glossary',
        'resource_glossary_synonym',
        'trace_link',
        'llm_run_ref',
        'prompt_template'
    )),
    design_category TEXT CHECK (design_category IS NULL OR design_category IN (
        'SRC', 'STD', 'REQ', 'CST', 'FUNC', 'STRUCT', 'BEH',
        'STATE', 'IF', 'DATA', 'VERIF', 'MGMT', 'IMPL'
    )),
    code TEXT NOT NULL CHECK (code GLOB '*-[0-9][0-9][0-9][0-9][0-9][0-9]'),
    title TEXT,
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'rejected', 'deleted')),
    is_archived INTEGER NOT NULL DEFAULT 0 CHECK (is_archived IN (0, 1)),
    owner_uid TEXT,
    review_info_json TEXT,
    memo_json TEXT,
    created_by TEXT,
    updated_by TEXT,
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
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
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
    figure_kind TEXT CHECK (figure_kind IS NULL OR figure_kind IN ('architecture', 'flow', 'screen', 'state', 'layout', 'other')),
    width INTEGER CHECK (width IS NULL OR width > 0),
    height INTEGER CHECK (height IS NULL OR height > 0),
    ocr_texts_json TEXT,
    objects_json TEXT,
    caption_uid TEXT,
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
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE resource_formula (
    uid TEXT PRIMARY KEY,
    formula_text TEXT NOT NULL,
    formula_format TEXT CHECK (formula_format IS NULL OR formula_format IN ('latex', 'mathml', 'excel', 'plain', 'other')),
    formula_kind TEXT CHECK (formula_kind IS NULL OR formula_kind IN ('calculation', 'condition', 'constraint', 'performance', 'other')),
    variables_json TEXT,
    units_json TEXT,
    references_json TEXT,
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

CREATE TABLE resource_scenario (
    uid TEXT PRIMARY KEY,
    scenario_name TEXT,
    actors_json TEXT,
    trigger_text TEXT,
    preconditions_json TEXT,
    steps_json TEXT,
    postconditions_json TEXT,
    source_resource_uids_json TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE resource_interface (
    uid TEXT PRIMARY KEY,
    interface_name TEXT,
    interface_kind TEXT CHECK (interface_kind IS NULL OR interface_kind IN ('api', 'communication', 'file', 'db', 'screen', 'device', 'library', 'other')),
    provider TEXT,
    consumer TEXT,
    protocol TEXT,
    operations_json TEXT,
    inputs_json TEXT,
    outputs_json TEXT,
    errors_json TEXT,
    timing TEXT,
    constraints_json TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE resource_state_transition (
    uid TEXT PRIMARY KEY,
    state_machine_name TEXT,
    states_json TEXT,
    events_json TEXT,
    transitions_json TEXT,
    initial_state TEXT,
    final_states_json TEXT,
    source_resource_uids_json TEXT,
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
);

CREATE TABLE resource_data_structure (
    uid TEXT PRIMARY KEY,
    data_structure_name TEXT,
    data_structure_kind TEXT CHECK (data_structure_kind IS NULL OR data_structure_kind IN ('db_table', 'message', 'file', 'struct', 'record', 'screen_item', 'other')),
    fields_json TEXT,
    keys_json TEXT,
    relations_json TEXT,
    constraints_json TEXT,
    source_resource_uids_json TEXT,
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

CREATE TABLE resource_metadata (
    uid TEXT PRIMARY KEY,
    metadata_kind TEXT NOT NULL CHECK (metadata_kind IN ('document', 'extraction', 'quality', 'review', 'version', 'diff', 'other')),
    target_resource_uid TEXT,
    metadata_key TEXT NOT NULL,
    metadata_value TEXT,
    value_type TEXT NOT NULL DEFAULT 'string' CHECK (value_type IN ('string', 'number', 'boolean', 'date', 'json')),
    unit TEXT,
    metadata_source TEXT CHECK (metadata_source IS NULL OR metadata_source IN ('file', 'parser', 'user', 'system', 'other')),
    UNIQUE (target_resource_uid, metadata_key),
    FOREIGN KEY (uid) REFERENCES entity_registry(uid) ON DELETE CASCADE,
    FOREIGN KEY (target_resource_uid) REFERENCES entity_registry(uid) ON DELETE CASCADE
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
        'resource_scenario',
        'resource_interface',
        'resource_state_transition',
        'resource_data_structure',
        'resource_reference',
        'resource_metadata'
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
        'resource_scenario',
        'resource_interface',
        'resource_state_transition',
        'resource_data_structure',
        'resource_reference',
        'resource_metadata'
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

CREATE TABLE trace_link (
    uid TEXT PRIMARY KEY,
    from_uid TEXT NOT NULL,
    to_uid TEXT NOT NULL,
    relation_type TEXT NOT NULL CHECK (relation_type IN (
        'based_on',
        'satisfies',
        'allocated_to',
        'verifies',
        'contains',
        'decomposes',
        'implements',
        'uses',
        'calls',
        'conflicts_with',
        'relates_to'
    )),
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
    decomposition_kind TEXT CHECK (decomposition_kind IS NULL OR decomposition_kind IN ('structural', 'functional', 'behavioral', 'logical', 'refinement')),
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

CREATE TABLE relation_rule_master (
    relation_type TEXT NOT NULL,
    source_category TEXT NOT NULL,
    target_category TEXT NOT NULL,
    allowed INTEGER NOT NULL DEFAULT 1 CHECK (allowed IN (0, 1)),
    required_attr TEXT,
    description TEXT,
    PRIMARY KEY (relation_type, source_category, target_category)
);

CREATE INDEX idx_entity_registry_project ON entity_registry(project_uid);
CREATE INDEX idx_entity_registry_type ON entity_registry(entity_type);
CREATE INDEX idx_entity_registry_design_category ON entity_registry(design_category);
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
CREATE INDEX idx_resource_interface_kind ON resource_interface(interface_kind);
CREATE INDEX idx_resource_reference_source ON resource_reference(source_resource_uid);
CREATE INDEX idx_resource_reference_target ON resource_reference(target_resource_uid);
CREATE INDEX idx_resource_reference_status ON resource_reference(resolution_status);
CREATE INDEX idx_resource_metadata_target_key ON resource_metadata(target_resource_uid, metadata_key);
CREATE INDEX idx_resource_glossary_text ON resource_glossary(term_text);
CREATE INDEX idx_resource_glossary_category ON resource_glossary(category);
CREATE INDEX idx_resource_glossary_prohibited ON resource_glossary(is_prohibited);
CREATE INDEX idx_resource_glossary_llm_run ON resource_glossary(llm_run_uid);
CREATE INDEX idx_resource_glossary_synonym_glossary ON resource_glossary_synonym(glossary_uid);
CREATE INDEX idx_resource_glossary_synonym_text ON resource_glossary_synonym(synonym_text);

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
