import { describe, expect, it } from 'vitest'
import { APP_VERSION } from './app-config'

describe('app-config（P3-1、UI-059）', () => {
  it('D2Dバージョンを設定ファイルからsemver形式で提供する', () => {
    expect(APP_VERSION).toBe('0.1.0')
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })
})
