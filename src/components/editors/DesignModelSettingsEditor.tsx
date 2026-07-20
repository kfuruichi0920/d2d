/** ツール設定配下の設計モデル設定ページ（MODEL-019〜029、ANA-004）。 */
import { OntologySettingsSection } from '../views/OntologySettingsView'
import { AnalysisSlotSettingsSection } from '../views/AnalysisViews'

export function DesignModelSettingsEditor(): React.JSX.Element {
  return (
    <div style={{ padding: 20, maxWidth: 1200 }} data-testid="design-model-settings-editor">
      <h1 style={{ fontSize: 18, marginTop: 0 }}>設計モデル設定</h1>
      <p style={{ color: 'var(--d2d-fg-muted)' }}>ツール設定 └ 設計モデル設定</p>
      <OntologySettingsSection />
      <AnalysisSlotSettingsSection />
    </div>
  )
}
