#!/usr/bin/env node
/**
 * D2D 品質ゲート（PROCESS.md ステップ 4/5 の 1 コマンド化）。
 *   node dev-process/verify.mjs         … 静的チェック + ユニットテスト
 *   node dev-process/verify.mjs --e2e   … 上記 + ビルド + Playwright E2E（ABI 切替込み）
 * 依存なし（Node 標準のみ）。すべて成功で exit 0、失敗があれば exit 1。
 */
import { spawnSync } from 'node:child_process'

const e2e = process.argv.includes('--e2e')
const results = []

function run(label, command) {
  process.stdout.write(`\n=== ${label}: ${command}\n`)
  const started = Date.now()
  const r = spawnSync(command, { shell: true, stdio: 'inherit' })
  const ok = r.status === 0
  results.push({ label, ok, seconds: Math.round((Date.now() - started) / 1000) })
  return ok
}

let failed = false
const steps = [
  ['ABI: Node（vitest 用）', 'node scripts/ensure-abi.mjs node'],
  ['型検査', 'npm run typecheck'],
  ['Lint', 'npm run lint'],
  ['フォーマット検査', 'npm run format:check'],
  ['ユニットテスト', 'npm test']
]
for (const [label, command] of steps) {
  if (!run(label, command)) {
    failed = true
    break // 静的チェック/ユニットの失敗は即打ち切り（先に直す）
  }
}

if (!failed && e2e) {
  const e2eSteps = [
    ['ABI: Electron', 'node scripts/ensure-abi.mjs electron'],
    ['ビルド', 'npm run build'],
    ['E2E（Playwright）', 'npx playwright test']
  ]
  for (const [label, command] of e2eSteps) {
    if (!run(label, command)) {
      failed = true
      break
    }
  }
  // 次の vitest 実行に備えて必ず Node ABI へ戻す（E2E 失敗時も）
  run('ABI: Node へ復帰', 'node scripts/ensure-abi.mjs node')
}

console.log('\n================ 品質ゲート結果 ================')
for (const r of results) {
  console.log(` ${r.ok ? 'PASS' : 'FAIL'}  ${r.label} (${r.seconds}s)`)
}
console.log(failed ? '\n>>> FAIL: 修正して再実行してください。' : '\n>>> ALL PASS')
process.exit(failed ? 1 : 0)
