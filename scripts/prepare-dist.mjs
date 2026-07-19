#!/usr/bin/env node
/**
 * 配布前の同梱物検査（P14-5、sdd_tech_stack §5.4）。
 *   node scripts/prepare-dist.mjs            … 検査して結果を表示（ワーカー欠落は exit 1）
 *   node scripts/prepare-dist.mjs --allow-missing-worker
 *                                            … ワーカー未ビルドでも続行（機能制限版の検証用）
 *
 * 必須: out/（electron-vite ビルド）、workers/python/dist/d2d-worker/（PyInstaller 出力）
 * 任意: third_party/ 配下の PlantUML・JRE・Graphviz・MeCab（欠けても該当機能だけ無効）
 */
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const allowMissingWorker = process.argv.includes('--allow-missing-worker')
const exe = process.platform === 'win32' ? '.exe' : ''

let failed = false
function check(label, path, { required = false, note = '' } = {}) {
  const ok = existsSync(join(root, path))
  const mark = ok ? 'OK ' : required ? 'NG ' : '-- '
  console.log(` ${mark} ${label}: ${path}${!ok && note ? `（${note}）` : ''}`)
  if (!ok && required) failed = true
  return ok
}

console.log('=== D2D 配布前検査（P14-5） ===')
check('アプリビルド', 'out/main/index.js', { required: true, note: 'npm run build を実行してください' })
check('Python ワーカー', `workers/python/dist/d2d-worker/d2d-worker${exe}`, {
  required: !allowMissingWorker,
  note: 'npm run package:worker を実行してください（要 PyInstaller）'
})
check('PlantUML jar', 'third_party/plantuml/plantuml.jar', { note: 'モデル図レンダリングが無効になります' })
check('Java ランタイム', `third_party/jre/bin/java${exe}`, { note: 'PATH 上の java へフォールバックします' })
check('Graphviz dot', `third_party/graphviz/bin/dot${exe}`, { note: '一部の PlantUML 図種が使えません' })
check('MeCab', `third_party/mecab/bin/mecab${exe}`, { note: '検索は unicode トークナイザへフォールバックします' })
check('UniDic 辞書', 'third_party/mecab/unidic', { note: 'MeCab の既定辞書設定が必要になります' })

if (failed) {
  console.error('\n>>> NG: 必須の同梱物が不足しています。上記の注記に従って準備してください。')
  process.exit(1)
}
console.log('\n>>> OK: 配布物を生成できます（任意コンポーネントの -- は機能制限付きで続行）。')
