/**
 * 同梱リソースパス解決の検証（P14-5、sdd_tech_stack §5.4）。
 */
import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  bundledGraphvizDot,
  bundledJava,
  bundledMecab,
  bundledPlantUmlJar,
  bundledRoot,
  bundledUnidic,
  resolveWorkerLaunch,
  type RuntimeEnv
} from './runtime-paths'
import { resolvePlantUmlConfig } from './edit/plantuml-service'
import type { SettingsService } from './settings/settings-service'

function fakeSettings(values: Record<string, unknown>): SettingsService {
  return { get: (key: string) => values[key] ?? null } as unknown as SettingsService
}

function devEnv(cwd: string): RuntimeEnv {
  return { packaged: false, resourcesPath: null, platform: 'win32', cwd }
}

function packagedEnv(resourcesPath: string): RuntimeEnv {
  return { packaged: true, resourcesPath, platform: 'win32', cwd: 'C:\\ignored' }
}

describe('bundledRoot', () => {
  it('開発時は cwd、パッケージ済みは resourcesPath を返す', () => {
    expect(bundledRoot(devEnv('C:\\repo'))).toBe('C:\\repo')
    expect(bundledRoot(packagedEnv('C:\\app\\resources'))).toBe('C:\\app\\resources')
  })

  it('packaged でも resourcesPath 未設定なら cwd へフォールバックする', () => {
    expect(bundledRoot({ packaged: true, resourcesPath: null, platform: 'win32', cwd: 'C:\\repo' })).toBe('C:\\repo')
  })
})

describe('resolveWorkerLaunch', () => {
  it('開発時は python + workers/python/main.py を返す', () => {
    const launch = resolveWorkerLaunch(devEnv('C:\\repo'))
    expect(launch.args).toEqual([join('C:\\repo', 'workers', 'python', 'main.py')])
    expect(launch.entryPath).toBe(join('C:\\repo', 'workers', 'python', 'main.py'))
  })

  it('パッケージ済みは d2d-worker.exe を直接起動する', () => {
    const launch = resolveWorkerLaunch(packagedEnv('C:\\app\\resources'))
    expect(launch.command).toBe(join('C:\\app\\resources', 'workers', 'python', 'd2d-worker.exe'))
    expect(launch.args).toEqual([])
    expect(launch.entryPath).toBe(launch.command)
  })

  it('linux では拡張子なしの d2d-worker を返す', () => {
    const launch = resolveWorkerLaunch({
      packaged: true,
      resourcesPath: '/opt/app/resources',
      platform: 'linux',
      cwd: '/ignored'
    })
    expect(launch.command).toBe(join('/opt/app/resources', 'workers', 'python', 'd2d-worker'))
  })
})

describe('同梱サードパーティの解決', () => {
  it('存在するものだけパスを返し、未同梱は null', () => {
    const root = mkdtempSync(join(tmpdir(), 'd2d-runtime-paths-'))
    try {
      const env: RuntimeEnv = { packaged: true, resourcesPath: root, platform: 'win32', cwd: 'C:\\ignored' }
      expect(bundledPlantUmlJar(env)).toBeNull()
      expect(bundledJava(env)).toBeNull()
      expect(bundledGraphvizDot(env)).toBeNull()
      expect(bundledMecab(env)).toBeNull()
      expect(bundledUnidic(env)).toBeNull()

      mkdirSync(join(root, 'third_party', 'plantuml'), { recursive: true })
      writeFileSync(join(root, 'third_party', 'plantuml', 'plantuml.jar'), '')
      mkdirSync(join(root, 'third_party', 'jre', 'bin'), { recursive: true })
      writeFileSync(join(root, 'third_party', 'jre', 'bin', 'java.exe'), '')
      mkdirSync(join(root, 'third_party', 'graphviz', 'bin'), { recursive: true })
      writeFileSync(join(root, 'third_party', 'graphviz', 'bin', 'dot.exe'), '')
      mkdirSync(join(root, 'third_party', 'mecab', 'bin'), { recursive: true })
      writeFileSync(join(root, 'third_party', 'mecab', 'bin', 'mecab.exe'), '')
      mkdirSync(join(root, 'third_party', 'mecab', 'unidic'), { recursive: true })

      expect(bundledPlantUmlJar(env)).toBe(join(root, 'third_party', 'plantuml', 'plantuml.jar'))
      expect(bundledJava(env)).toBe(join(root, 'third_party', 'jre', 'bin', 'java.exe'))
      expect(bundledGraphvizDot(env)).toBe(join(root, 'third_party', 'graphviz', 'bin', 'dot.exe'))
      expect(bundledMecab(env)).toBe(join(root, 'third_party', 'mecab', 'bin', 'mecab.exe'))
      expect(bundledUnidic(env)).toBe(join(root, 'third_party', 'mecab', 'unidic'))

      // PlantUML 設定解決: 設定が同梱より優先され、未設定時は同梱 jar / java / dot を使う
      const bundled = resolvePlantUmlConfig(fakeSettings({}), env)
      expect(bundled.jarPath).toBe(join(root, 'third_party', 'plantuml', 'plantuml.jar'))
      expect(bundled.javaPath).toBe(join(root, 'third_party', 'jre', 'bin', 'java.exe'))
      expect(bundled.dotPath).toBe(join(root, 'third_party', 'graphviz', 'bin', 'dot.exe'))
      const overridden = resolvePlantUmlConfig(
        fakeSettings({
          'plantuml.jarPath': 'C:\\tools\\plantuml.jar',
          'plantuml.javaPath': 'C:\\tools\\java.exe',
          'plantuml.dotPath': 'C:\\tools\\dot.exe'
        }),
        env
      )
      expect(overridden).toEqual({
        jarPath: 'C:\\tools\\plantuml.jar',
        javaPath: 'C:\\tools\\java.exe',
        dotPath: 'C:\\tools\\dot.exe'
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('同梱物が何もない環境では jar/dot は null、java は PATH 既定へフォールバックする', () => {
    const root = mkdtempSync(join(tmpdir(), 'd2d-runtime-paths-empty-'))
    try {
      const env: RuntimeEnv = { packaged: true, resourcesPath: root, platform: 'win32', cwd: 'C:\\ignored' }
      const config = resolvePlantUmlConfig(fakeSettings({}), env)
      expect(config).toEqual({ jarPath: null, javaPath: 'java', dotPath: null })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
