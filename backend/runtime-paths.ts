/**
 * 同梱リソースのパス解決（P14-5、APP-001/002、FORM-001、sdd_tech_stack §5.4）。
 * パッケージ済みアプリでは electron-builder の extraResources が
 * `resources/workers/python/` と `resources/third_party/` へ同梱物を配置する。
 * Backend（utilityProcess）は Electron API を持たないため、Main が起動時に
 * D2D_PACKAGED / D2D_RESOURCES_PATH を環境変数で引き渡す（backend-process.ts）。
 * 開発時はリポジトリ直下の `third_party/` を同じレイアウトで参照する。
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface RuntimeEnv {
  packaged: boolean
  resourcesPath: string | null
  platform: NodeJS.Platform
  cwd: string
}

export function currentRuntimeEnv(): RuntimeEnv {
  return {
    packaged: process.env.D2D_PACKAGED === '1',
    resourcesPath: process.env.D2D_RESOURCES_PATH || null,
    platform: process.platform,
    cwd: process.cwd()
  }
}

/** 同梱リソースのルート。パッケージ済みは resources/、開発時はリポジトリ直下 */
export function bundledRoot(env: RuntimeEnv = currentRuntimeEnv()): string {
  if (env.packaged && env.resourcesPath) return env.resourcesPath
  return env.cwd
}

function exeName(base: string, env: RuntimeEnv): string {
  return env.platform === 'win32' ? `${base}.exe` : base
}

/** 存在する場合だけパスを返す（未同梱の任意コンポーネントは null） */
function ifExists(path: string): string | null {
  return existsSync(path) ? path : null
}

/**
 * Python ワーカーの起動方法。
 * packaged: PyInstaller 製 d2d-worker(.exe) を直接起動（Python 不要、sdd_tech_stack §5.2）
 * dev: python workers/python/main.py（D2D_PYTHON で上書き可）
 */
export interface WorkerLaunch {
  command: string
  args: string[]
  /** 存在確認に使うエントリパス */
  entryPath: string
}

export function resolveWorkerLaunch(env: RuntimeEnv = currentRuntimeEnv()): WorkerLaunch {
  if (env.packaged) {
    const exe = join(bundledRoot(env), 'workers', 'python', exeName('d2d-worker', env))
    return { command: exe, args: [], entryPath: exe }
  }
  const entry = join(env.cwd, 'workers', 'python', 'main.py')
  const python = process.env.D2D_PYTHON || (env.platform === 'win32' ? 'python' : 'python3')
  return { command: python, args: [entry], entryPath: entry }
}

/** 同梱 PlantUML jar（third_party/plantuml/plantuml.jar）。未同梱なら null */
export function bundledPlantUmlJar(env: RuntimeEnv = currentRuntimeEnv()): string | null {
  return ifExists(join(bundledRoot(env), 'third_party', 'plantuml', 'plantuml.jar'))
}

/** 同梱 Java ランタイム（third_party/jre/bin/java）。未同梱なら null */
export function bundledJava(env: RuntimeEnv = currentRuntimeEnv()): string | null {
  return ifExists(join(bundledRoot(env), 'third_party', 'jre', 'bin', exeName('java', env)))
}

/** 同梱 Graphviz dot（third_party/graphviz/bin/dot）。未同梱なら null */
export function bundledGraphvizDot(env: RuntimeEnv = currentRuntimeEnv()): string | null {
  return ifExists(join(bundledRoot(env), 'third_party', 'graphviz', 'bin', exeName('dot', env)))
}

/** 同梱 MeCab 実行ファイル（third_party/mecab/bin/mecab）。未同梱なら null */
export function bundledMecab(env: RuntimeEnv = currentRuntimeEnv()): string | null {
  return ifExists(join(bundledRoot(env), 'third_party', 'mecab', 'bin', exeName('mecab', env)))
}

/** 同梱 UniDic 辞書ディレクトリ（third_party/mecab/unidic）。未同梱なら null */
export function bundledUnidic(env: RuntimeEnv = currentRuntimeEnv()): string | null {
  return ifExists(join(bundledRoot(env), 'third_party', 'mecab', 'unidic'))
}
export interface RuntimeCapabilityStatus {
  plantUml: { enabled: boolean; source: 'configured' | 'bundled' | 'unavailable' }
  mecab: { enabled: boolean; source: 'configured' | 'bundled' | 'unavailable' }
}

export interface RuntimeSettingsReader {
  get(key: string): unknown
}

/** Status Bar用の実行機能可否（P3-5、UI-009）。設定値を同梱物より優先する。 */
export function resolveRuntimeCapabilityStatus(
  settings: RuntimeSettingsReader,
  env: RuntimeEnv = currentRuntimeEnv()
): RuntimeCapabilityStatus {
  const configuredPlantUml = settings.get('plantuml.jarPath')
  const plantUmlPath =
    typeof configuredPlantUml === 'string' && configuredPlantUml.trim()
      ? configuredPlantUml.trim()
      : bundledPlantUmlJar(env)
  const configuredMecab = settings.get('search.mecabPath')
  const mecabPath =
    typeof configuredMecab === 'string' && configuredMecab.trim() ? configuredMecab.trim() : bundledMecab(env)
  return {
    plantUml: {
      enabled: Boolean(plantUmlPath && existsSync(plantUmlPath)),
      source:
        typeof configuredPlantUml === 'string' && configuredPlantUml.trim()
          ? 'configured'
          : plantUmlPath
            ? 'bundled'
            : 'unavailable'
    },
    mecab: {
      enabled: Boolean(mecabPath && existsSync(mecabPath)),
      source:
        typeof configuredMecab === 'string' && configuredMecab.trim()
          ? 'configured'
          : mecabPath
            ? 'bundled'
            : 'unavailable'
    }
  }
}
