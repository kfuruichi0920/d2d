/**
 * PlantUML レンダリング（P10-3、FORM-001/002、EDIT-021）。
 * TBD-02 決定: GPL 版 PlantUML を利用し、Java ランタイム・Graphviz は P14-5 で同梱する。
 * 開発中は設定（plantuml.jarPath / plantuml.javaPath）で外部の jar / java を指定する。
 * jar 未設定・Java 未検出時は明確なエラー契約を返す（レンダリング以外の編集は可能）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { BackendError } from '../api/errors'
import type { SettingsService } from '../settings/settings-service'

export interface PlantUmlConfig {
  jarPath: string | null
  javaPath: string
}

export function resolvePlantUmlConfig(settings: SettingsService): PlantUmlConfig {
  const jarPath = settings.get('plantuml.jarPath')
  const javaPath = settings.get('plantuml.javaPath')
  return {
    jarPath: typeof jarPath === 'string' && jarPath ? jarPath : null,
    javaPath: typeof javaPath === 'string' && javaPath ? javaPath : 'java'
  }
}

/** PlantUML テキストを SVG へレンダリングする（java -jar plantuml.jar -pipe -tsvg） */
export function renderPlantUml(config: PlantUmlConfig, umlText: string, timeoutMs = 30_000): Promise<string> {
  if (!config.jarPath) {
    return Promise.reject(
      new BackendError(
        'validation',
        'PlantUML jar が未設定です',
        '設定 plantuml.jarPath に plantuml.jar のパスを指定してください（同梱は P14-5 で対応。TBD-02）'
      )
    )
  }
  if (!existsSync(config.jarPath)) {
    return Promise.reject(new BackendError('io', 'PlantUML jar が見つかりません', config.jarPath))
  }

  return new Promise<string>((resolve, reject) => {
    const child = spawn(
      config.javaPath,
      ['-Djava.awt.headless=true', '-jar', config.jarPath!, '-pipe', '-tsvg', '-charset', 'UTF-8'],
      {
        stdio: ['pipe', 'pipe', 'pipe']
      }
    )
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new BackendError('worker', 'PlantUML レンダリングがタイムアウトしました', `timeout=${timeoutMs}ms`, true))
    }, timeoutMs)

    child.on('error', (err) => {
      clearTimeout(timer)
      reject(
        new BackendError(
          'worker',
          'Java を起動できません',
          `${err.message}（設定 plantuml.javaPath を確認してください）`,
          false
        )
      )
    })
    child.stdout.on('data', (buf: Buffer) => (stdout += buf.toString('utf-8')))
    child.stderr.on('data', (buf: Buffer) => (stderr += buf.toString('utf-8')))
    child.on('close', (code) => {
      clearTimeout(timer)
      if (stdout.includes('<svg')) {
        resolve(stdout)
      } else {
        reject(
          new BackendError('worker', `PlantUML レンダリングに失敗しました (exit=${code})`, stderr.slice(0, 1000), false)
        )
      }
    })
    child.stdin.write(umlText, 'utf-8')
    child.stdin.end()
  })
}

/**
 * 要素 ID 対応表（FORM-002）: PlantUML/SysMLv2 のモデル表記とは別に、
 * モデル内要素名 ↔ 設計要素 uid の対応を model_elements_json に保持する。
 */
export interface ModelIdMapping {
  model_element: string
  design_uid: string | null
  design_code: string | null
}
