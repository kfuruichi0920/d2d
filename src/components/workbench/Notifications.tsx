/** 通知トースト（sdd_ui_design §14 Notification）。詳細は Panel へ誘導する */
import { useJobsStore } from '../../stores/jobs-store'

export function Notifications(): React.JSX.Element {
  const notifications = useJobsStore((s) => s.notifications)
  const dismiss = useJobsStore((s) => s.dismissNotification)

  return (
    <div className="wb-notifications" data-testid="notifications">
      {notifications.map((n) => (
        <div key={n.id} className={`wb-notification ${n.kind}`}>
          <div>
            <div>{n.message}</div>
            {n.detail && <div style={{ color: 'var(--d2d-fg-muted)', fontSize: 11 }}>{n.detail}</div>}
          </div>
          <button type="button" className="close" onClick={() => dismiss(n.id)} aria-label="閉じる">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
