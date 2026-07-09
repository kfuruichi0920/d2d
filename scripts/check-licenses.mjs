/**
 * 依存ライブラリのライセンス一覧出力と GPL/AGPL 混入チェック（P0-5、NFR-040〜043）。
 *
 * - npm 依存（production）のライセンスを out/licenses.json / out/licenses.csv へ出力する
 * - 許可リスト（licenses.config.json）にないコピーレフト系ライセンスを検出したら exit 1
 * - npm 外の同梱物（PlantUML=GPL、pymupdf=AGPL、Java/Graphviz/MeCab/UniDic 等）は
 *   licenses.config.json の bundledComponents に手動登録し、一覧へ合流させる
 */
import { init } from 'license-checker-rseidelsohn'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'out')

const config = JSON.parse(readFileSync(join(root, 'licenses.config.json'), 'utf-8'))
const forbiddenPattern = new RegExp(config.forbiddenPattern, 'i')
const allowedPackages = new Set(config.allowedPackages)

const packages = await new Promise((resolve, reject) => {
  init({ start: root, production: true, excludePrivatePackages: true }, (err, pkgs) => {
    if (err) reject(err)
    else resolve(pkgs)
  })
})

const rows = Object.entries(packages).map(([name, info]) => ({
  name,
  licenses: Array.isArray(info.licenses) ? info.licenses.join(' OR ') : String(info.licenses ?? 'UNKNOWN'),
  repository: info.repository ?? '',
  source: 'npm'
}))

for (const bundled of config.bundledComponents) {
  rows.push({ ...bundled, source: 'bundled' })
}

mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'licenses.json'), JSON.stringify(rows, null, 2))
writeFileSync(
  join(outDir, 'licenses.csv'),
  [
    'name,licenses,source,repository',
    ...rows.map((r) => `"${r.name}","${r.licenses}","${r.source}","${r.repository}"`)
  ].join('\n')
)

const violations = rows.filter(
  (r) => r.source === 'npm' && forbiddenPattern.test(r.licenses) && !allowedPackages.has(r.name.replace(/@[^@]+$/, ''))
)

console.log(`ライセンス一覧を出力しました: out/licenses.json / out/licenses.csv（${rows.length} 件）`)

const bundledCopyleft = rows.filter((r) => r.source === 'bundled' && forbiddenPattern.test(r.licenses))
if (bundledCopyleft.length > 0) {
  console.log('同梱物のコピーレフト系ライセンス（決定済み・要配布条件遵守）:')
  for (const r of bundledCopyleft) console.log(`  - ${r.name}: ${r.licenses}`)
}

if (violations.length > 0) {
  console.error('未許可のコピーレフト系ライセンスを検出しました（NFR-041）:')
  for (const v of violations) console.error(`  - ${v.name}: ${v.licenses}`)
  process.exit(1)
}
console.log('npm 依存に未許可の GPL/AGPL 系ライセンスはありません')
