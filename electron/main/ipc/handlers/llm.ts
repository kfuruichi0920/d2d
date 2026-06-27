import { ipcMain } from 'electron'
import {
  listProviderConfigs, createProviderConfig, updateProviderConfig, deleteProviderConfig,
  runLlm, listRunLogs, getRunLogStats, type ProviderConfig,
} from '../../llm/llm-gateway'
import {
  listTemplates, getTemplate, createTemplate, addTemplateVersion,
  getLatestVersion, listVersions, deleteTemplate, renderTemplate, seedBuiltinTemplates,
} from '../../llm/prompt-manager'
import {
  listCandidates, getCandidate, reviewCandidate, deleteCandidate, getCandidateStats,
} from '../../llm/candidate-manager'
import { maskSensitiveData } from '../../llm/privacy-filter'

export function registerLlmHandlers(): void {
  // ---- Provider config ----
  ipcMain.handle('llm:listProviders', () => listProviderConfigs())
  ipcMain.handle('llm:createProvider', (_e, opts: Omit<ProviderConfig, 'uid' | 'created_at'>) => createProviderConfig(opts))
  ipcMain.handle('llm:updateProvider', (_e, uid: string, fields: Partial<ProviderConfig>) => updateProviderConfig(uid, fields))
  ipcMain.handle('llm:deleteProvider', (_e, uid: string) => deleteProviderConfig(uid))

  // ---- LLM 実行 ----
  ipcMain.handle('llm:run', async (_e, opts: Parameters<typeof runLlm>[0]) => runLlm(opts))

  // ---- ログ ----
  ipcMain.handle('llm:listLogs', (_e, limit?: number) => listRunLogs(limit))
  ipcMain.handle('llm:logStats', () => getRunLogStats())

  // ---- プロンプトテンプレート ----
  ipcMain.handle('llm:seedBuiltins', () => seedBuiltinTemplates())
  ipcMain.handle('llm:listTemplates', () => listTemplates())
  ipcMain.handle('llm:getTemplate', (_e, uid: string) => getTemplate(uid))
  ipcMain.handle('llm:createTemplate', (_e, opts: Parameters<typeof createTemplate>[0]) => createTemplate(opts))
  ipcMain.handle('llm:addTemplateVersion', (_e, templateUid: string, opts: Parameters<typeof addTemplateVersion>[1]) => addTemplateVersion(templateUid, opts))
  ipcMain.handle('llm:getLatestVersion', (_e, templateUid: string) => getLatestVersion(templateUid))
  ipcMain.handle('llm:listVersions', (_e, templateUid: string) => listVersions(templateUid))
  ipcMain.handle('llm:deleteTemplate', (_e, uid: string) => deleteTemplate(uid))
  ipcMain.handle('llm:renderTemplate', (_e, template: string, variables: Record<string, string>) => renderTemplate(template, variables))

  // ---- 候補レビュー ----
  ipcMain.handle('llm:listCandidates', (_e, opts: Parameters<typeof listCandidates>[0]) => listCandidates(opts))
  ipcMain.handle('llm:getCandidate', (_e, uid: string) => getCandidate(uid))
  ipcMain.handle('llm:reviewCandidate', (_e, uid: string, status: Parameters<typeof reviewCandidate>[1], modifiedJson?: string) => reviewCandidate(uid, status, modifiedJson))
  ipcMain.handle('llm:deleteCandidate', (_e, uid: string) => deleteCandidate(uid))
  ipcMain.handle('llm:candidateStats', () => getCandidateStats())

  // ---- プライバシーフィルタ ----
  ipcMain.handle('llm:maskPreview', (_e, text: string) => maskSensitiveData(text))
}
