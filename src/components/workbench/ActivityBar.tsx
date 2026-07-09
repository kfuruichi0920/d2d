/**
 * Activity Bar（sdd_ui_design §9）。作業文脈の切替入口に限定する（操作ボタンは置かない）。
 * アイコンは Serendie Symbols を用いる（UI-028）。
 */
import {
  SerendieSymbolFolder,
  SerendieSymbolCheckCircle,
  SerendieSymbolMagnifyingGlass,
  SerendieSymbolShuffle,
  SerendieSymbolPlayCircle,
  SerendieSymbolFileText,
  SerendieSymbolHistory,
  SerendieSymbolGear
} from '@serendie/symbols'
import { useWorkbenchStore, type Activity } from '../../stores/workbench-store'

const ACTIVITIES: { id: Activity; label: string; Icon: React.ComponentType<{ width?: number; height?: number }> }[] = [
  { id: 'explorer', label: 'Explorer', Icon: SerendieSymbolFolder },
  { id: 'review', label: 'Review', Icon: SerendieSymbolCheckCircle },
  { id: 'search', label: 'Search', Icon: SerendieSymbolMagnifyingGlass },
  { id: 'trace', label: 'Trace', Icon: SerendieSymbolShuffle },
  { id: 'jobs', label: 'Jobs', Icon: SerendieSymbolPlayCircle },
  { id: 'reports', label: 'Reports', Icon: SerendieSymbolFileText },
  { id: 'history', label: 'History', Icon: SerendieSymbolHistory },
  { id: 'settings', label: 'Settings', Icon: SerendieSymbolGear }
]

export function ActivityBar(): React.JSX.Element {
  const activity = useWorkbenchStore((s) => s.activity)
  const sideBarVisible = useWorkbenchStore((s) => s.sideBarVisible)
  const setActivity = useWorkbenchStore((s) => s.setActivity)

  return (
    <div className="wb-activitybar" data-testid="activity-bar">
      {ACTIVITIES.map(({ id, label, Icon }) => (
        <button
          key={id}
          type="button"
          className={`wb-activity-btn ${activity === id && sideBarVisible ? 'active' : ''}`}
          title={label}
          data-testid={`activity-${id}`}
          onClick={() => setActivity(id)}
        >
          <Icon width={20} height={20} />
        </button>
      ))}
    </div>
  )
}
