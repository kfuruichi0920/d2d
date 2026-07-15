/**
 * Activity Bar（P3-1、UI-028/043、sdd_ui_design §9）。
 * Settingsを下端へ固定し、作業ActivityはDnD順序変更と選択表示を提供する。
 */
import {
  SerendieSymbolFolder,
  SerendieSymbolMagnifyingGlass,
  SerendieSymbolShuffle,
  SerendieSymbolFileText,
  SerendieSymbolHistory,
  SerendieSymbolGear
} from '@serendie/symbols'
import { useWorkbenchStore, type Activity } from '../../stores/workbench-store'

interface ActivityDefinition {
  id: Activity
  label: string
  Icon: React.ComponentType<{ width?: number; height?: number }>
}

const ACTIVITIES: ActivityDefinition[] = [
  { id: 'explorer', label: 'Explorer', Icon: SerendieSymbolFolder },
  { id: 'search', label: 'Search', Icon: SerendieSymbolMagnifyingGlass },
  { id: 'trace', label: 'Trace', Icon: SerendieSymbolShuffle },
  { id: 'reports', label: 'Reports', Icon: SerendieSymbolFileText },
  { id: 'history', label: 'History', Icon: SerendieSymbolHistory },
  { id: 'settings', label: 'Settings', Icon: SerendieSymbolGear }
]

const DEFINITION_BY_ID = new Map(ACTIVITIES.map((definition) => [definition.id, definition]))

export function ActivityBar(): React.JSX.Element {
  const activity = useWorkbenchStore((state) => state.activity)
  const sideBarVisible = useWorkbenchStore((state) => state.sideBarVisible)
  const activityOrder = useWorkbenchStore((state) => state.activityOrder)
  const setActivity = useWorkbenchStore((state) => state.setActivity)
  const moveActivity = useWorkbenchStore((state) => state.moveActivity)
  const topActivities = activityOrder.filter((id) => id !== 'settings')

  const button = (id: Activity, draggable: boolean): React.JSX.Element | null => {
    const definition = DEFINITION_BY_ID.get(id)
    if (!definition) return null
    const { label, Icon } = definition
    return (
      <button
        key={id}
        type="button"
        className={`wb-activity-btn ${activity === id ? 'active' : ''}`}
        title={draggable ? `${label}（ドラッグで順序変更）` : label}
        data-testid={`activity-${id}`}
        data-activity-id={id}
        aria-current={activity === id ? 'page' : undefined}
        aria-pressed={activity === id && sideBarVisible}
        draggable={draggable}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('application/x-d2d-activity', id)
        }}
        onDragOver={(event) => {
          if (!draggable) return
          event.preventDefault()
          event.dataTransfer.dropEffect = 'move'
        }}
        onDrop={(event) => {
          event.preventDefault()
          const source = event.dataTransfer.getData('application/x-d2d-activity') as Activity
          if (DEFINITION_BY_ID.has(source)) moveActivity(source, id)
        }}
        onClick={() => setActivity(id)}
      >
        <Icon width={20} height={20} />
      </button>
    )
  }

  return (
    <div className="wb-activitybar" data-testid="activity-bar">
      <div className="wb-activitybar-top" data-testid="activity-order">
        {topActivities.map((id) => button(id, true))}
      </div>
      <div className="wb-activitybar-bottom">{button('settings', false)}</div>
    </div>
  )
}
