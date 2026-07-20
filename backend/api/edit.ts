/**
 * 編集機能 API（P10: 状態遷移・用語集・表編集・検証詳細・PlantUML モデル）。
 */
import type { ApiRouter } from './router'
import { BackendError } from './errors'
import type { SettingsService } from '../settings/settings-service'
import { requireProject } from '../project/project-service'
import {
  analyzeStateMachine,
  createStateMachine,
  getStateMachine,
  simulateStateMachine,
  updateStateMachine,
  type StateTransition
} from '../edit/state-machine-service'
import {
  addSynonym,
  addTerm,
  detectVariants,
  extractTermCandidates,
  linkTermToElement,
  listTerms,
  normalizeTerm,
  setTermStatus
} from '../edit/glossary-service'
import { editIntermediateTable, getTableCells } from '../edit/table-service'
import { renderPlantUml, resolvePlantUmlConfig, type ModelIdMapping } from '../edit/plantuml-service'
import { createDesignElement } from '../design/design-service'
import { eventBus } from '../events/event-bus'

function asRecord(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new BackendError('validation', 'パラメータオブジェクトが必要です', String(params))
  }
  return params as Record<string, unknown>
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key]
  if (typeof value !== 'string' || value.length === 0) {
    throw new BackendError('validation', `${key} は必須の文字列です`, '')
  }
  return value
}

export function registerEditApi(router: ApiRouter, settings: SettingsService): void {
  // ---- 状態遷移（P10-4、EDIT-030〜035） ----

  router.register('state.create', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return createStateMachine(db, info.projectUid, requireString(p, 'name'))
  })

  router.register('state.get', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const machine = getStateMachine(db, requireString(p, 'uid'))
    return { ...machine, problems: analyzeStateMachine(machine) }
  })

  router.register('state.update', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const uid = requireString(p, 'uid')
    updateStateMachine(db, uid, {
      states: (p.states as string[]) ?? [],
      events: (p.events as string[]) ?? [],
      transitions: (p.transitions as StateTransition[]) ?? [],
      initialState: requireString(p, 'initialState'),
      finalStates: (p.finalStates as string[]) ?? []
    })
    const machine = getStateMachine(db, uid)
    return { ...machine, problems: analyzeStateMachine(machine) }
  })

  router.register('state.simulate', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    const machine = getStateMachine(db, requireString(p, 'uid'))
    return simulateStateMachine(machine, Array.isArray(p.events) ? (p.events as string[]) : [])
  })

  // ---- 用語集（P10-6、EDIT-050〜056） ----

  router.register('glossary.list', (params) => {
    const p = asRecord(params ?? {})
    const { db, info } = requireProject()
    return listTerms(db, info.projectUid, { approvedOnly: p.approvedOnly === true })
  })

  router.register('glossary.addTerm', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const created = addTerm(db, info.projectUid, {
      term: requireString(p, 'term'),
      definition: p.definition === undefined ? undefined : String(p.definition),
      abbreviation: p.abbreviation === undefined ? undefined : String(p.abbreviation),
      category: p.category === undefined ? undefined : String(p.category),
      prohibited: p.prohibited === true,
      approved: p.approved === true
    })
    eventBus.emit('glossary.updated', { uid: created.uid })
    return created
  })

  router.register('glossary.addSynonym', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return addSynonym(
      db,
      info.projectUid,
      requireString(p, 'glossaryUid'),
      requireString(p, 'synonymText'),
      (p.kind as 'synonym' | 'variant' | 'abbreviation') ?? 'synonym'
    )
  })

  router.register('glossary.setStatus', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    setTermStatus(
      db,
      requireString(p, 'uid'),
      requireString(p, 'status') as 'draft' | 'approved' | 'rejected' | 'deleted'
    )
    eventBus.emit('glossary.updated', { uid: String(p.uid) })
    return { updated: true }
  })

  router.register('glossary.linkElement', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    return linkTermToElement(db, info.projectUid, requireString(p, 'termUid'), requireString(p, 'elementUid'))
  })

  /** 選択テキストからの用語候補抽出（EDIT-051/055。ルールベース） */
  router.register('glossary.extractCandidates', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const existing = new Set(listTerms(db, info.projectUid).map((t) => t.normalized_text))
    for (const term of listTerms(db, info.projectUid)) {
      for (const synonym of term.synonyms) existing.add(normalizeTerm(synonym.synonym_text))
    }
    return { candidates: extractTermCandidates(requireString(p, 'text'), existing) }
  })

  router.register('glossary.detectVariants', () => {
    const { db, info } = requireProject()
    return detectVariants(db, info.projectUid)
  })

  // ---- 表編集（P10-2、EDIT-022〜025） ----

  router.register('table.getCells', (params) => {
    const p = asRecord(params)
    const { db } = requireProject()
    return getTableCells(db, requireString(p, 'tableUid'))
  })

  router.register('table.editIntermediateTable', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const cells = p.cells as string[][]
    if (!Array.isArray(cells)) {
      throw new BackendError('validation', 'cells は二次元配列で指定してください', '')
    }
    return editIntermediateTable(db, info.projectUid, requireString(p, 'uid'), requireString(p, 'elementId'), cells)
  })

  // ---- PlantUML モデル（P10-3、FORM-001/002） ----

  router.register('model.render', async (params) => {
    const p = asRecord(params)
    requireProject()
    const svg = await renderPlantUml(resolvePlantUmlConfig(settings), requireString(p, 'text'))
    return { svg }
  })

  router.register('model.getConfig', () => {
    requireProject()
    const config = resolvePlantUmlConfig(settings)
    return { ...config, configured: config.jarPath !== null }
  })

  /** モデル表記 + 要素ID対応表を model_struct として保存（FORM-002）。 */
  router.register('model.save', (params) => {
    const p = asRecord(params)
    const { db, info } = requireProject()
    const name = requireString(p, 'name')
    const text = requireString(p, 'text')
    const mappings = Array.isArray(p.mappings) ? (p.mappings as ModelIdMapping[]) : []
    const element = createDesignElement(db, info.projectUid, {
      modelType: 'model_struct',
      title: name,
      summary: name,
      detail: {
        structure_kind: 'software',
        model_notation: 'plantuml',
        model_source: text,
        element_mappings: mappings
      },
      createdBy: 'user'
    })
    eventBus.emit('design_model.updated', { kind: 'model-saved', uid: element.uid })
    return element
  })
}
