/**
 * レビュー状態モデル共通部品（P3-8、sdd_ui_design §7.3、EXT-022）。
 * レビュー状態はステージやビューが変わっても同一の色・表現で表示する（§2.4）。
 */

export const REVIEW_STATES = ['unconfirmed', 'confirmed', 'needsfix', 'rejected', 'candidate'] as const
export type ReviewState = (typeof REVIEW_STATES)[number]

export const REVIEW_STATE_LABELS: Record<ReviewState, string> = {
  unconfirmed: '未確認',
  confirmed: '確認済',
  needsfix: '要修正',
  rejected: '棄却',
  candidate: '候補'
}

/** entity_registry.status（draft/review/approved/rejected/deleted）との対応 */
export function reviewStateFromEntityStatus(status: string): ReviewState {
  switch (status) {
    case 'approved':
      return 'confirmed'
    case 'rejected':
      return 'rejected'
    case 'review':
      return 'needsfix'
    default:
      return 'unconfirmed'
  }
}

export function ReviewStatusBadge({ status }: { status: ReviewState }): React.JSX.Element {
  return <span className={`d2d-badge review-${status}`}>{REVIEW_STATE_LABELS[status]}</span>
}
