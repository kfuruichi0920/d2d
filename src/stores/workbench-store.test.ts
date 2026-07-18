import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_THEME, getThemeDefaultWorkbenchColors, getWorkbenchColorVariables } from '../theme/theme'
import { isSemanticEditShortcut } from '../components/common/SemanticTextInput'
import { composePromptMessages } from '../components/common/LlmRequestDialog'
import { DEFAULT_ACTIVITY_ORDER, SECONDARY_SECTION_ORDER, useWorkbenchStore } from './workbench-store'

function reset(): void {
  useWorkbenchStore.setState({
    workMode: 'M0',
    activity: 'explorer',
    sideBarVisible: true,
    secondaryVisible: true,
    secondaryTab: 'properties',
    secondaryExpanded: ['properties'],
    panelVisible: true,
    panelTab: 'jobs',
    primarySize: 260,
    secondarySize: 280,
    panelSize: 200,
    theme: DEFAULT_THEME,
    activityOrder: [...DEFAULT_ACTIVITY_ORDER],
    persistKey: 'test'
  })
}

describe('workbench-store（P3-1、UI-038/040）', () => {
  beforeEach(reset)

  it('Workbench共通カラーは設定済みパーツだけをCSS変数へ変換する（UI-052）', () => {
    expect(
      getWorkbenchColorVariables({
        workbenchBackground: '#102030',
        buttonBackground: '#405060'
      })
    ).toEqual({
      '--d2d-bg': '#102030',
      '--d2d-button-bg': '#405060'
    })
  })

  it('Workbench共通カラーの既定値は表示テーマへ追従する（UI-052）', () => {
    const dark = getThemeDefaultWorkbenchColors({ ...DEFAULT_THEME, displayMode: 'dark' }, '#123456')
    const light = getThemeDefaultWorkbenchColors({ ...DEFAULT_THEME, displayMode: 'light' }, '#654321')
    expect(dark.workbenchBackground).toBe('#1b1d21')
    expect(light.workbenchBackground).toBe('#f5f6f8')
    expect(dark.foreground).not.toBe(light.foreground)
    expect(light.accent).toBe('#654321')
  })
  it('外周パネル寸法を許容範囲へ制限する', () => {
    useWorkbenchStore.getState().setPrimarySize(900)
    useWorkbenchStore.getState().setSecondarySize(20)
    useWorkbenchStore.getState().setPanelSize(350)
    expect(useWorkbenchStore.getState()).toMatchObject({
      primarySize: 600,
      secondarySize: 180,
      panelSize: 350
    })
  })

  it('作業モードを切り替えてもWorkbench外周パネル状態を維持する（UI-041）', () => {
    useWorkbenchStore.getState().setPrimarySize(420)
    useWorkbenchStore.getState().setSecondarySize(360)
    useWorkbenchStore.getState().setPanelSize(310)
    useWorkbenchStore.getState().switchMode('M3')

    expect(useWorkbenchStore.getState()).toMatchObject({
      workMode: 'M3',
      sideBarVisible: true,
      secondaryVisible: true,
      panelVisible: true,
      primarySize: 420,
      secondarySize: 360,
      panelSize: 310
    })
  })

  it('ActivityはSettingsを下端に保ったまま並べ替える', () => {
    useWorkbenchStore.getState().moveActivity('history', 'explorer')
    expect(useWorkbenchStore.getState().activityOrder).toEqual([
      'history',
      'explorer',
      'search',
      'trace',
      'reports',
      'settings'
    ])
    useWorkbenchStore.getState().moveActivity('settings', 'explorer')
    expect(useWorkbenchStore.getState().activityOrder.at(-1)).toBe('settings')
  })
  it('Secondaryアコーディオンは複数開閉できる', () => {
    useWorkbenchStore.getState().toggleSecondarySection('relations')
    expect(useWorkbenchStore.getState().secondaryExpanded).toEqual(['properties', 'relations'])
    useWorkbenchStore.getState().toggleSecondarySection('properties')
    expect(useWorkbenchStore.getState().secondaryExpanded).toEqual(['relations'])
  })
  it('Secondaryアコーディオンは開閉しても固定表示順の契約を変更しない（EDIT-073）', () => {
    const order = [...SECONDARY_SECTION_ORDER]
    useWorkbenchStore.getState().toggleSecondarySection('relations')
    useWorkbenchStore.getState().toggleSecondarySection('dictionary')
    expect(SECONDARY_SECTION_ORDER).toEqual(order)
    expect(SECONDARY_SECTION_ORDER).toEqual(['properties', 'relations', 'review', 'dictionary'])
  })

  it('セマンティックプレビューはEnterまたはF2だけを編集ショートカットとして扱う（EDIT-072）', () => {
    expect(isSemanticEditShortcut('Enter')).toBe(true)
    expect(isSemanticEditShortcut('F2')).toBe(true)
    expect(isSemanticEditShortcut('Space')).toBe(false)
  })
})
describe('LLM共通送信確認（P6-3/P6-4、LLM-024/040）', () => {
  it('編集したプロンプトでsystemメッセージだけを差し替える', () => {
    expect(
      composePromptMessages(
        [
          { role: 'system', content: '既定' },
          { role: 'user', content: '対象本文' }
        ],
        '画面別プロンプト'
      )
    ).toEqual([
      { role: 'system', content: '画面別プロンプト' },
      { role: 'user', content: '対象本文' }
    ])
  })

  it('{{body}}へ対象本文を展開して送信内容を構成する', () => {
    expect(
      composePromptMessages(
        [
          { role: 'system', content: '既定' },
          { role: 'user', content: '対象本文' }
        ],
        '次を分析してください:\n{{body}}'
      )
    ).toEqual([{ role: 'user', content: '次を分析してください:\n対象本文' }])
  })
})
