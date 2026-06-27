// Renderer から参照する D2D API の型定義（Node.js 依存なし）

export interface ProjectInfo {
  uid: string
  name: string
  description: string | null
  root_path: string
  schema_version: string
  created_at: string
  updated_at: string
}

export interface CreateProjectOptions {
  name: string
  description?: string
  dirPath: string
}

export interface AppSettings {
  theme: 'konjo' | 'asagi' | 'sumire' | 'tsutsuji' | 'kurikawa'
  colorMode: 'system' | 'light' | 'dark'
  language: 'ja' | 'en'
  exportOnSave: boolean
  autoUpdateCheck: boolean
}

export interface ProjectSettings {
  defaultArtifactTypeId: string | null
  defaultDevPhaseId: string | null
  llmModel: string | null
  extractorVersion: string | null
}

export type JobStatus = 'pending' | 'running' | 'success' | 'failed' | 'cancelled'
export type BatchType = 'import' | 'extract' | 'llm' | 'export'

export interface JobRecord {
  uid: string
  project_uid: string
  batch_type: BatchType
  status: JobStatus
  settings_json: string | null
  executed_by: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
}

export interface IntermediateDocumentRow {
  uid: string
  code: string
  title: string
  status: string
  source_extracted_document_uid: string | null
  artifact_type_id: string | null
  dev_phase_id: string | null
  intermediate_status: string
  item_count: number
  generated_at: string | null
}

export interface IntermediateItemRow {
  uid: string
  intermediate_document_uid: string
  item_type: string
  resource_uid: string | null
}

export interface ChunkRow {
  uid: string
  code: string
  intermediate_document_uid: string
  token_count: number
  item_count: number
  created_at: string
}

export interface ArtifactSettingRow {
  uid: string
  project_uid: string
  artifact_name: string
  artifact_type_id: string
  sort_order: number
  is_active: number
}

export interface ArchiveResult {
  archivePath: string
  sizeBytes: number
}

export type ResourceEntityType =
  | 'resource_label' | 'resource_text' | 'resource_list' | 'resource_figure'
  | 'resource_table' | 'resource_formula' | 'resource_code' | 'resource_model'
  | 'resource_scenario' | 'resource_interface' | 'resource_state_transition'
  | 'resource_data_structure' | 'resource_reference' | 'resource_metadata'
  | 'resource_glossary' | 'resource_glossary_synonym'

export interface ResourceRow {
  uid: string
  code: string
  title: string
  status: string
  entity_type: ResourceEntityType
  created_at: string
  updated_at: string
  [key: string]: unknown
}

export type RelationType =
  | 'derived_from' | 'normalized_from' | 'based_on'
  | 'satisfies' | 'verifies' | 'depends_on' | 'refines' | 'relates_to'

export interface TraceLinkRow {
  uid: string
  from_uid: string
  to_uid: string
  relation_type: RelationType
  direction: 'forward' | 'bidirectional'
  rationale: string | null
  confidence: number | null
  from_title: string
  from_entity_type: string
  to_title: string
  to_entity_type: string
}

export interface TraceSubgraph {
  nodes: Array<{ uid: string; title: string; entity_type: string; depth: number }>
  edges: Array<{ uid: string; from_uid: string; to_uid: string; relation_type: RelationType }>
}

export interface GlossaryTermRow {
  uid: string
  code: string
  term_text: string
  normalized_text: string
  definition: string | null
  abbreviation: string | null
  language: string | null
  category: string | null
  is_prohibited: number
  confirmed_at: string | null
  synonym_count: number
}

export interface GlossarySynonymRow {
  uid: string
  glossary_uid: string
  synonym_text: string
  synonym_kind: string | null
  created_at: string
}

export interface TraceMatrixEntry {
  from_uid: string
  from_title: string
  from_type: string
  to_uid: string
  to_title: string
  to_type: string
  relation_type: RelationType
  confidence: number | null
}

export interface DbToTextResult {
  outputDir: string
  tableCount: number
  totalRows: number
  manifestPath: string
}

// ---- LLM 関連型 ----

export type LlmProvider = 'openai' | 'gemini' | 'ollama' | 'azure_openai' | 'anthropic'
export type PromptPurpose = 'extract_terms' | 'generate_trace' | 'classify' | 'summarize' | 'review' | 'custom'
export type ReviewStatus = 'pending' | 'accepted' | 'modified' | 'rejected'
export type CandidateType = 'term' | 'trace_link' | 'summary' | 'classification' | 'custom'

export interface ProviderConfig {
  uid: string
  provider: LlmProvider
  display_name: string
  model_name: string
  endpoint_url: string | null
  max_tokens: number
  temperature: number
  is_default: number
  created_at: string
}

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

export interface LlmRunLog {
  uid: string
  llm_run_ref_uid: string | null
  provider: string | null
  model_name: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  total_tokens: number | null
  estimated_cost_usd: number | null
  latency_ms: number | null
  error_message: string | null
  created_at: string
  tool_name?: string | null
}

export interface LlmRunLogStats {
  total_runs: number
  total_tokens: number | null
  total_cost_usd: number | null
  avg_latency_ms: number | null
  error_count: number
}

export interface CandidateRow {
  uid: string
  llm_run_ref_uid: string | null
  target_uid: string | null
  candidate_type: CandidateType
  content_json: string
  review_status: ReviewStatus
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

export interface LlmRunResult {
  llmRunRefUid: string
  content: string
  promptTokens: number
  completionTokens: number
  totalTokens: number
  latencyMs: number
  estimatedCostUsd: number
  masked: boolean
}

export interface MaskPreviewResult {
  masked: string
  maskCount: number
  changes: string[]
}

export interface D2DApi {
  project: {
    open: (filePath: string) => Promise<ProjectInfo>
    create: (opts: CreateProjectOptions) => Promise<string>
    getCurrent: () => Promise<ProjectInfo | null>
    close: () => Promise<void>
  }
  store: {
    query: (sql: string, params?: unknown[]) => Promise<unknown[]>
    execute: (
      sql: string,
      params?: unknown[]
    ) => Promise<{ changes: number; lastInsertRowid: number | bigint }>
  }
  jobs: {
    list: () => Promise<JobRecord[]>
    getLog: (jobId: string) => Promise<string>
    retry: (jobId: string) => Promise<void>
    cancel: (jobId: string) => Promise<void>
  }
  settings: {
    getApp: () => Promise<AppSettings>
    setApp: (settings: Partial<AppSettings>) => Promise<AppSettings>
    getProject: () => Promise<ProjectSettings>
    setProject: (settings: Partial<ProjectSettings>) => Promise<ProjectSettings>
    getApiKey: (service: string, account: string) => Promise<string | null>
    setApiKey: (service: string, account: string, key: string) => Promise<void>
    deleteApiKey: (service: string, account: string) => Promise<void>
  }
  import: {
    document: (filePath: string) => Promise<ImportedDocument>
    openDialog: () => Promise<string[]>
    listDocuments: () => Promise<SourceDocumentRow[]>
    getDocument: (uid: string) => Promise<SourceDocumentRow | null>
  }
  extract: {
    document: (sourceDocumentUid: string) => Promise<{ extractedDocumentUid: string }>
    status: (extractedDocumentUid: string) => Promise<{ status: string; itemCount: number }>
  }
  intermediate: {
    create: (opts: { sourceExtractedDocumentUid?: string; title?: string }) => Promise<string>
    list: () => Promise<IntermediateDocumentRow[]>
    get: (uid: string) => Promise<IntermediateDocumentRow | null>
    listItems: (uid: string) => Promise<IntermediateItemRow[]>
    promoteFromExtracted: (extractedDocumentUid: string, intermediateDocumentUid: string) => Promise<number>
    listChunks: (uid: string) => Promise<ChunkRow[]>
    createChunk: (intermediateDocumentUid: string, itemUids: string[], tokenCount?: number) => Promise<string>
    deleteChunk: (uid: string) => Promise<void>
  }
  artifacts: {
    listSettings: () => Promise<ArtifactSettingRow[]>
    createSetting: (name: string, typeId: string, sortOrder?: number) => Promise<string>
    deleteSetting: (uid: string) => Promise<void>
    generateArchive: (label?: string) => Promise<ArchiveResult>
    listArchives: () => Promise<{ name: string; path: string; sizeBytes: number; createdAt: string }[]>
  }
  trace: {
    subgraph: (rootUid: string, opts?: { maxDepth?: number; direction?: 'forward' | 'backward' | 'both'; relationTypes?: RelationType[]; entityTypes?: string[] }) => Promise<TraceSubgraph>
    impacted: (uid: string, maxDepth?: number) => Promise<Array<{ uid: string; title: string; entity_type: string; depth: number }>>
    roots: (uid: string, maxDepth?: number) => Promise<Array<{ uid: string; title: string; entity_type: string; depth: number }>>
    matrix: (fromTypes?: string[], toTypes?: string[], relationTypes?: RelationType[]) => Promise<TraceMatrixEntry[]>
    stats: () => Promise<Array<{ relation_type: string; count: number }>>
    exportJson: (rootUid: string, maxDepth?: number) => Promise<string>
    exportMatrixJson: (fromTypes?: string[], toTypes?: string[], relationTypes?: RelationType[]) => Promise<string>
    exportMatrixCsv: (fromTypes?: string[], toTypes?: string[], relationTypes?: RelationType[]) => Promise<string>
    exportMatrixMarkdown: (fromTypes?: string[], toTypes?: string[], relationTypes?: RelationType[]) => Promise<string>
    exportSubgraphMarkdown: (rootUid: string, maxDepth?: number) => Promise<string>
    dbToText: () => Promise<DbToTextResult>
    sqliteDump: () => Promise<{ schemaPath: string; dataPath: string }>
  }
  design: {
    listResources: (entityType: ResourceEntityType, limit?: number) => Promise<ResourceRow[]>
    getResource: (uid: string) => Promise<ResourceRow | null>
    deleteResource: (uid: string) => Promise<void>
    updateStatus: (uid: string, status: 'active' | 'archived' | 'deleted') => Promise<void>
    updateField: (uid: string, entityType: ResourceEntityType, fields: Record<string, unknown>) => Promise<void>
    createLabel: (opts: Record<string, unknown>) => Promise<string>
    createText: (opts: Record<string, unknown>) => Promise<string>
    createList: (opts: Record<string, unknown>) => Promise<string>
    createTable: (opts: Record<string, unknown>) => Promise<string>
    createCode: (opts: Record<string, unknown>) => Promise<string>
    createModel: (opts: Record<string, unknown>) => Promise<string>
    createScenario: (opts: Record<string, unknown>) => Promise<string>
    createInterface: (opts: Record<string, unknown>) => Promise<string>
    createStateTransition: (opts: Record<string, unknown>) => Promise<string>
    createDataStructure: (opts: Record<string, unknown>) => Promise<string>
    createTraceLink: (fromUid: string, toUid: string, relationType: RelationType, opts?: Record<string, unknown>) => Promise<string>
    listTraceLinks: (uid: string, direction?: 'from' | 'to' | 'both') => Promise<TraceLinkRow[]>
    deleteTraceLink: (uid: string) => Promise<void>
    getTraceSubgraph: (rootUid: string, maxDepth?: number, relationTypes?: RelationType[]) => Promise<TraceSubgraph>
    createGlossaryTerm: (opts: { termText: string; definition?: string; abbreviation?: string; language?: string; category?: string; isProhibited?: boolean }) => Promise<string>
    listGlossaryTerms: (opts?: { language?: string; category?: string; search?: string; isProhibited?: boolean; limit?: number }) => Promise<GlossaryTermRow[]>
    getGlossaryTerm: (uid: string) => Promise<GlossaryTermRow | null>
    updateGlossaryTerm: (uid: string, updates: Record<string, unknown>) => Promise<void>
    deleteGlossaryTerm: (uid: string) => Promise<void>
    confirmGlossaryTerm: (uid: string) => Promise<void>
    addSynonym: (glossaryUid: string, synonymText: string, synonymKind?: string) => Promise<string>
    listSynonyms: (glossaryUid: string) => Promise<GlossarySynonymRow[]>
    deleteSynonym: (uid: string) => Promise<void>
  }
  llm: {
    listProviders: () => Promise<ProviderConfig[]>
    createProvider: (opts: Omit<ProviderConfig, 'uid' | 'created_at'>) => Promise<string>
    updateProvider: (uid: string, fields: Partial<ProviderConfig>) => Promise<void>
    deleteProvider: (uid: string) => Promise<void>
    run: (opts: { messages: Array<{ role: string; content: string }>; providerConfigUid?: string; inputRefUid?: string; toolName?: string; maskSensitive?: boolean }) => Promise<LlmRunResult>
    listLogs: (limit?: number) => Promise<LlmRunLog[]>
    logStats: () => Promise<LlmRunLogStats>
    seedBuiltins: () => Promise<void>
    listTemplates: () => Promise<PromptTemplate[]>
    getTemplate: (uid: string) => Promise<PromptTemplate | null>
    createTemplate: (opts: { name: string; description?: string; purpose: PromptPurpose; systemPrompt?: string; userTemplate: string; variablesJson?: string }) => Promise<string>
    addTemplateVersion: (templateUid: string, opts: { systemPrompt?: string; userTemplate: string; variablesJson?: string }) => Promise<string>
    getLatestVersion: (templateUid: string) => Promise<PromptVersion | null>
    listVersions: (templateUid: string) => Promise<PromptVersion[]>
    deleteTemplate: (uid: string) => Promise<void>
    renderTemplate: (template: string, variables: Record<string, string>) => Promise<string>
    listCandidates: (opts: { status?: ReviewStatus; candidateType?: CandidateType; limit?: number }) => Promise<CandidateRow[]>
    getCandidate: (uid: string) => Promise<CandidateRow | null>
    reviewCandidate: (uid: string, status: ReviewStatus, modifiedJson?: string) => Promise<void>
    deleteCandidate: (uid: string) => Promise<void>
    candidateStats: () => Promise<{ pending: number; accepted: number; rejected: number; modified: number }>
    maskPreview: (text: string) => Promise<MaskPreviewResult>
  }
  events: {
    on: (channel: string, listener: (...args: unknown[]) => void) => () => void
  }
}

export interface ImportedDocument {
  sourceDocumentUid: string
  blobUid: string
  fileName: string
  fileType: string
  fileHash: string
  blobPath: string
}

export interface SourceDocumentRow {
  uid: string
  file_name: string
  file_type: string
  file_hash: string
  imported_at: string
  code: string
  status: string
  title: string
}
