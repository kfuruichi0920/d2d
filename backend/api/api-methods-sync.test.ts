/**
 * src/types/api-methods.ts の API_METHODS と backend/api/*.ts の router.register(...) の
 * 同期検証（改善対応1）。メソッドの追加・削除時に union の更新漏れ・登録漏れを検出する。
 * Renderer 側では node API を使えないため、本テストは backend 側に置く。
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_METHODS } from '../../src/types/api-methods'

const API_DIR = dirname(fileURLToPath(import.meta.url))

function registeredMethods(): string[] {
  const methods = new Set<string>()
  for (const file of readdirSync(API_DIR)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue
    const source = readFileSync(join(API_DIR, file), 'utf8')
    for (const match of source.matchAll(/\.register\(\s*'([^']+)'/g)) {
      if (match[1]) methods.add(match[1])
    }
  }
  return [...methods].sort()
}

describe('API_METHODS の同期', () => {
  it('backend/api の register 一覧と完全一致する', () => {
    const backend = registeredMethods()
    const frontend = [...API_METHODS].sort()
    expect(frontend).toEqual(backend)
  })

  it('重複エントリがない', () => {
    expect(new Set(API_METHODS).size).toBe(API_METHODS.length)
  })
})
