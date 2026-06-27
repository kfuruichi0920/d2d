// Main process 側の IPC 型定義
// Renderer 共有型は src/types/d2d-api.ts で定義し、ここから再エクスポートする
export type {
  D2DApi,
  ProjectInfo,
  CreateProjectOptions,
  AppSettings,
  ProjectSettings,
  JobRecord,
  JobStatus,
  BatchType
} from '../../../src/types/d2d-api'
