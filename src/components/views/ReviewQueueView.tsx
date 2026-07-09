/**
 * レビューキュー（P3-8 骨格、sdd_ui_design §7.2 / V-17）。
 * 未確認・要修正・候補待ちを横断集約する Inbox。データ供給は P5（抽出レビュー）以降で接続する。
 */
import { REVIEW_STATES, ReviewStatusBadge } from '../common/review'

export function ReviewQueueView(): React.JSX.Element {
  return (
    <div data-testid="review-queue">
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: '4px 2px' }}>
        {REVIEW_STATES.map((s) => (
          <ReviewStatusBadge key={s} status={s} />
        ))}
      </div>
      <div className="d2d-empty">
        点検待ちの項目はありません。
        <br />
        ②抽出データ・LLM 候補が生成されると、ここに横断集約されます（P5 以降）。
      </div>
    </div>
  )
}
