/** Explorer／ステージ共通の原本取込（P4-2、UI-046／UI-048）。 */
import { invoke } from './backend'

type ImportResult = { ok: boolean }
type Notify = (level: 'info' | 'warning' | 'error', message: string, detail?: string) => void

export interface SourceImportDependencies {
  selectFiles: () => Promise<string[]>
  importFile: (filePath: string) => Promise<ImportResult>
  notify: Notify
}

export async function runSourceImport(dependencies: SourceImportDependencies): Promise<number> {
  const filePaths = await dependencies.selectFiles()
  if (filePaths.length === 0) return 0
  const results = await Promise.all(filePaths.map((filePath) => dependencies.importFile(filePath)))
  const failed = results.filter((result) => !result.ok).length
  if (failed > 0) {
    dependencies.notify('error', `${failed}件の取込Jobを登録できませんでした`)
    return filePaths.length - failed
  }
  dependencies.notify('info', `${filePaths.length}件の原本取込Jobを登録しました`)
  return filePaths.length
}

export async function importSourceDocuments(notify: Notify): Promise<number> {
  return runSourceImport({
    selectFiles: () =>
      window.api.showOpenFilesDialog({
        title: '取込む原本ファイルを選択（複数選択可）',
        filters: [
          {
            name: '対象文書',
            extensions: ['docx', 'xlsx', 'pptx', 'vsdx', 'pdf', 'txt', 'md', 'csv', 'tsv', 'json', 'jsonl', 'yaml']
          }
        ]
      }),
    importFile: async (filePath) => invoke('document.import', { filePath }),
    notify
  })
}
