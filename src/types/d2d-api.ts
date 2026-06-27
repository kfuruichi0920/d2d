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
