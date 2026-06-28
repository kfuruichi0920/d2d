// T807: 依存ライブラリ一覧・ライセンス一覧出力

import fs from 'fs'
import path from 'path'

const APP_ROOT = path.join(__dirname, '..', '..', '..', '..')

export interface DependencyInfo {
  name: string
  version: string
  license: string | null
  description: string | null
  repository: string | null
}

export function listDependencies(devIncluded = false): DependencyInfo[] {
  const pkgPath = path.join(APP_ROOT, 'package.json')
  if (!fs.existsSync(pkgPath)) return []

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as {
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  const deps: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(devIncluded ? (pkg.devDependencies ?? {}) : {}),
  }

  return Object.keys(deps)
    .sort()
    .map((name) => {
      try {
        const depPkgPath = path.join(APP_ROOT, 'node_modules', name, 'package.json')
        if (!fs.existsSync(depPkgPath)) {
          return { name, version: deps[name], license: null, description: null, repository: null }
        }
        const depPkg = JSON.parse(fs.readFileSync(depPkgPath, 'utf-8')) as {
          version?: string
          license?: string | { type?: string }
          description?: string
          repository?: string | { url?: string }
        }
        const license =
          typeof depPkg.license === 'string'
            ? depPkg.license
            : (depPkg.license as { type?: string } | undefined)?.type ?? null
        const repository =
          typeof depPkg.repository === 'string'
            ? depPkg.repository
            : (depPkg.repository as { url?: string } | undefined)?.url ?? null
        return {
          name,
          version: depPkg.version ?? deps[name],
          license,
          description: depPkg.description ?? null,
          repository: repository?.replace(/^git\+/, '').replace(/\.git$/, '') ?? null,
        }
      } catch {
        return { name, version: deps[name], license: null, description: null, repository: null }
      }
    })
}

export function exportLicensesMarkdown(devIncluded = false): string {
  const deps = listDependencies(devIncluded)
  const lines = [
    `# 依存ライブラリ・ライセンス一覧`,
    ``,
    `生成日時: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}  `,
    `パッケージ数: ${deps.length}`,
    ``,
    `| パッケージ | バージョン | ライセンス | 説明 |`,
    `|-----------|-----------|-----------|------|`,
  ]
  for (const d of deps) {
    const desc = d.description?.slice(0, 60) ?? '—'
    lines.push(`| ${d.name} | ${d.version} | ${d.license ?? '不明'} | ${desc} |`)
  }
  return lines.join('\n')
}

export function exportLicensesJson(devIncluded = false): string {
  return JSON.stringify(listDependencies(devIncluded), null, 2)
}
