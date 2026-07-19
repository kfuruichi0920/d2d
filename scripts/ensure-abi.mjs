#!/usr/bin/env node
/**
 * better-sqlite3 の ABI を目的の実行環境（node / electron）へ揃える（改善対応7）。
 *   node scripts/ensure-abi.mjs node       … vitest 用（Node ABI）
 *   node scripts/ensure-abi.mjs electron   … build / E2E 用（Electron ABI）
 *   --force を付けると現在状態にかかわらず再ビルドする。
 *
 * 現在の ABI はマーカーファイル node_modules/.d2d-abi.json で管理する。
 * マーカーが目的と一致すれば何もしない（数秒かかる rebuild をスキップ）ため、
 * npm scripts の pretest / prebuild / pretest:e2e から常時呼び出せる。
 * 手動での `npm rebuild better-sqlite3` 実行はマーカーと食い違うが、
 * その場合も次回 --force か目標切替時の rebuild で回復する。
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const markerPath = join(root, 'node_modules', '.d2d-abi.json')

const target = process.argv[2]
const force = process.argv.includes('--force')
if (target !== 'node' && target !== 'electron') {
  console.error('usage: node scripts/ensure-abi.mjs <node|electron> [--force]')
  process.exit(1)
}

function installedVersion(pkg) {
  try {
    return JSON.parse(readFileSync(join(root, 'node_modules', pkg, 'package.json'), 'utf8')).version
  } catch {
    return null
  }
}

// ABI はモジュール版数と実行環境版数の組で決まる。版数が変われば rebuild し直す。
const state = {
  target,
  betterSqlite3: installedVersion('better-sqlite3'),
  electron: installedVersion('electron'),
  node: process.versions.node
}

if (!force && existsSync(markerPath)) {
  try {
    const current = JSON.parse(readFileSync(markerPath, 'utf8'))
    if (JSON.stringify(current) === JSON.stringify(state)) {
      console.log(`ABI は既に ${target} 用です（rebuild をスキップ）`)
      process.exit(0)
    }
  } catch {
    // マーカー破損時は rebuild へフォールバック
  }
}

const command = target === 'node' ? 'npm rebuild better-sqlite3' : 'npx electron-rebuild -f -w better-sqlite3'
console.log(`ABI を ${target} 用へ切替: ${command}`)
const result = spawnSync(command, { shell: true, stdio: 'inherit', cwd: root })
if (result.status !== 0) process.exit(result.status ?? 1)
writeFileSync(markerPath, JSON.stringify(state, null, 2))
