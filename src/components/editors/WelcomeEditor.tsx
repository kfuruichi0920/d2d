import { executeCommand } from '../../services/command-registry'
import { getCommandContext } from '../../services/builtin-commands'

export function WelcomeEditor(): React.JSX.Element {
  return (
    <div style={{ padding: 32, maxWidth: 560 }} data-testid="welcome-editor">
      <h1 style={{ fontSize: 20, marginTop: 0 }}>
        <span style={{ color: 'var(--d2d-accent)' }}>D2D</span> — 設計情報デジタル化・トレーサビリティ支援ツール
      </h1>
      <p style={{ color: 'var(--d2d-fg-muted)' }}>
        Word / Excel / PowerPoint / PDF 等の設計文書を段階的にデジタル化し、①原本 → ②抽出 → ③中間 → ④設計モデルの
        トレーサビリティを人間レビュー前提（human-in-the-loop）で管理します。
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <button
          type="button"
          className="d2d-btn primary"
          onClick={() => void executeCommand('project.open', undefined, getCommandContext())}
        >
          プロジェクトを開く…
        </button>
        <button
          type="button"
          className="d2d-btn"
          onClick={() => void executeCommand('project.createInFolder', undefined, getCommandContext())}
        >
          新規プロジェクトを作成…
        </button>
      </div>
      <p style={{ color: 'var(--d2d-fg-muted)', marginTop: 24, fontSize: 11.5 }}>
        Ctrl+Shift+P でコマンドパレット / Ctrl+1〜6 で作業モード切替（M0〜M5）
      </p>
    </div>
  )
}
