/** デバッグログ出力のユニットテスト（W11）。 */
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createProject, closeProject } from '../project/project-service'
import { setProjectSetting } from '../settings/settings-service'
import { appendDebugLog, currentDebugLogLevel, debugLogFilePath, tailDebugLog, DEBUG_LOG_LEVEL_KEY } from './debug-log'

describe('デバッグログ（W11）', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'd2d-log-'))
    createProject({ rootPath: dir, name: 'log-test' })
  })

  afterEach(() => {
    closeProject()
    rmSync(dir, { recursive: true, force: true })
  })

  it('日付毎のファイルへ追記し、tail で末尾から読める', () => {
    expect(appendDebugLog('backend', 'info', 'メッセージ1')).toBe(true)
    expect(appendDebugLog('backend', 'error', 'メッセージ2', '詳細\n改行あり')).toBe(true)
    const path = debugLogFilePath('backend')
    expect(path).not.toBeNull()
    expect(existsSync(path!)).toBe(true)
    const content = readFileSync(path!, 'utf8')
    expect(content).toContain('[INFO] メッセージ1')
    expect(content).toContain('[ERROR] メッセージ2 | 詳細\\n改行あり')

    const tail = tailDebugLog('backend', 1)
    expect(tail.lines).toHaveLength(1)
    expect(tail.lines[0]).toContain('メッセージ2')
  })

  it('プロジェクト設定 logging.debugLevel でフィルタする', () => {
    expect(currentDebugLogLevel()).toBe('info')
    // 既定 info では debug は書かれない
    expect(appendDebugLog('frontend', 'debug', '出ないログ')).toBe(false)
    setProjectSetting(dir, DEBUG_LOG_LEVEL_KEY, 'debug')
    expect(currentDebugLogLevel()).toBe('debug')
    expect(appendDebugLog('frontend', 'debug', '出るログ')).toBe(true)
    setProjectSetting(dir, DEBUG_LOG_LEVEL_KEY, 'error')
    expect(appendDebugLog('frontend', 'warn', '出ない警告')).toBe(false)
    expect(appendDebugLog('frontend', 'error', '出るエラー')).toBe(true)
  })

  it('プロジェクト未オープン時はファイル出力しない', () => {
    closeProject()
    expect(debugLogFilePath('backend')).toBeNull()
    expect(appendDebugLog('backend', 'error', '書かれない')).toBe(false)
    expect(tailDebugLog('backend').lines).toEqual([])
  })
})
