import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import AdmZip from 'adm-zip'
import { getCurrentProjectRoot } from '../project/project-manager'

export interface ArchiveResult {
  archivePath: string
  sizeBytes: number
}

function timestamp(): string {
  return new Date()
    .toISOString()
    .replace(/[-:T]/g, (c) => (c === 'T' ? '_' : c))
    .slice(0, 15)
}

export function generateArchive(label?: string): ArchiveResult {
  const root = getCurrentProjectRoot()
  if (!root) throw new Error('プロジェクトが開かれていません')

  const archivesDir = join(root, 'archives')
  if (!existsSync(archivesDir)) mkdirSync(archivesDir, { recursive: true })

  const name = label ? `${label}_${timestamp()}` : `archive_${timestamp()}`
  const archivePath = join(archivesDir, `${name}.zip`)

  const zip = new AdmZip()

  // project.d2d
  const d2dFile = join(root, 'project.d2d')
  if (existsSync(d2dFile)) zip.addLocalFile(d2dFile)

  // project.db
  const dbFile = join(root, 'project.db')
  if (existsSync(dbFile)) zip.addLocalFile(dbFile)

  // exports/ (db_to_text・manifest 等)
  const exportsDir = join(root, 'exports')
  if (existsSync(exportsDir)) zip.addLocalFolder(exportsDir, 'exports')

  // blobs/originals/
  const originalsDir = join(root, 'blobs', 'originals')
  if (existsSync(originalsDir)) zip.addLocalFolder(originalsDir, 'blobs/originals')

  zip.writeZip(archivePath)

  const { statSync } = require('fs') as typeof import('fs')
  const sizeBytes = statSync(archivePath).size

  return { archivePath, sizeBytes }
}

export function listArchives(): { name: string; path: string; sizeBytes: number; createdAt: string }[] {
  const root = getCurrentProjectRoot()
  if (!root) return []

  const archivesDir = join(root, 'archives')
  if (!existsSync(archivesDir)) return []

  const { readdirSync, statSync } = require('fs') as typeof import('fs')
  return readdirSync(archivesDir)
    .filter((f) => f.endsWith('.zip'))
    .map((f) => {
      const p = join(archivesDir, f)
      const st = statSync(p)
      return { name: f, path: p, sizeBytes: st.size, createdAt: st.mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}
