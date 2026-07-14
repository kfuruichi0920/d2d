import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_THEME } from '../theme/theme'
import { DEFAULT_ACTIVITY_ORDER, useWorkbenchStore } from './workbench-store'

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

  it('ActivityはSettingsを下端に保ったまま並べ替える', () => {
    useWorkbenchStore.getState().moveActivity('history', 'explorer')
    expect(useWorkbenchStore.getState().activityOrder).toEqual([
      'history',
      'explorer',
      'review',
      'search',
      'trace',
      'jobs',
      'reports',
      'settings'
    ])
    useWorkbenchStore.getState().moveActivity('settings', 'explorer')
    expect(useWorkbenchStore.getState().activityOrder.at(-1)).toBe('settings')
  })
  it('Secondaryアコーディオンは複数開閉できる', () => {
    useWorkbenchStore.getState().toggleSecondarySection('evidence')
    expect(useWorkbenchStore.getState().secondaryExpanded).toEqual(['properties', 'evidence'])
    useWorkbenchStore.getState().toggleSecondarySection('properties')
    expect(useWorkbenchStore.getState().secondaryExpanded).toEqual(['evidence'])
  })
})
