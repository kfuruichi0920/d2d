/**
 * 機能管理（P2-5、CORE-001、sdd_function_architecture §3）。
 * 各機能を機能単位で登録し、機能種別・API プレフィックス・対応 schema_version を管理する。
 * schema_version 整合確認はプロジェクト open 時に利用する。
 */

export type FeatureKind = 'platform' | 'common' | 'individual'

export interface FeatureDefinition {
  /** 機能識別名（例: 'project', 'job', 'settings'） */
  name: string
  /** 表示名 */
  displayName: string
  /** 基盤機能 / 共通機能 / 個別機能（sdd_function_architecture §2） */
  kind: FeatureKind
  /** この機能が提供する API メソッドのプレフィックス */
  apiPrefixes: string[]
  /** 対応する project.db schema_version 範囲（semver の major が一致すれば互換とする） */
  supportedSchemaMajor: number
}

const features = new Map<string, FeatureDefinition>()

export function registerFeature(def: FeatureDefinition): void {
  if (features.has(def.name)) {
    throw new Error(`Feature already registered: ${def.name}`)
  }
  features.set(def.name, def)
}

export function listFeatures(): FeatureDefinition[] {
  return [...features.values()]
}

/** schema_version（x.x.x）に対して非対応の機能名一覧を返す */
export function incompatibleFeatures(schemaVersion: string): string[] {
  const major = Number(schemaVersion.split('.')[0] ?? 0)
  return [...features.values()].filter((f) => f.supportedSchemaMajor !== major).map((f) => f.name)
}

/** P2 時点の基盤機能を登録する */
export function registerBuiltinFeatures(): void {
  const builtin: FeatureDefinition[] = [
    {
      name: 'app',
      displayName: 'アプリ状態',
      kind: 'platform',
      apiPrefixes: ['app.'],
      supportedSchemaMajor: 1
    },
    {
      name: 'project',
      displayName: 'プロジェクト管理',
      kind: 'platform',
      apiPrefixes: ['project.'],
      supportedSchemaMajor: 1
    },
    {
      name: 'settings',
      displayName: '設定管理',
      kind: 'platform',
      apiPrefixes: ['settings.'],
      supportedSchemaMajor: 1
    },
    {
      name: 'job',
      displayName: 'ジョブ管理',
      kind: 'platform',
      apiPrefixes: ['job.'],
      supportedSchemaMajor: 1
    },
    {
      name: 'feature',
      displayName: '機能管理',
      kind: 'platform',
      apiPrefixes: ['feature.'],
      supportedSchemaMajor: 1
    },
    {
      name: 'worker',
      displayName: '外部ワーカー基盤',
      kind: 'platform',
      apiPrefixes: ['worker.'],
      supportedSchemaMajor: 1
    }
  ]
  for (const def of builtin) {
    if (!features.has(def.name)) {
      features.set(def.name, def)
    }
  }
}
