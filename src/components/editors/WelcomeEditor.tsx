import { executeCommand } from '../../services/command-registry'
import { getCommandContext } from '../../services/builtin-commands'
import { useEditorStore } from '../../stores/editor-store'

const helpItems = [
  {
    uri: 'help://workflow',
    icon: '①→④',
    title: '操作の流れ',
    description: '原本から設計モデル、トレーサビリティ分析まで'
  },
  {
    uri: 'help://schema',
    icon: 'DB',
    title: 'データスキーマ',
    description: '共通台帳・Resource・関係・ファイル保管の構造'
  },
  { uri: 'help://design-model', icon: '13', title: '設計モデル', description: '13分類、関係、候補レビューの考え方' }
]

export function WelcomeEditor(): React.JSX.Element {
  const openResource = useEditorStore((state) => state.openResource)
  return (
    <main className="d2d-welcome" data-testid="welcome-editor">
      <section className="d2d-welcome-hero">
        <span className="d2d-help-eyebrow">DESIGN TO DATA</span>
        <h1>
          <span>D2D</span> — 設計・トレース作成支援ツール
        </h1>
        <p>
          D2Dは、自然言語の設計文書を段階的にデータ化し、根拠から設計・検証・実装までの
          トレーサビリティを人間レビュー前提で管理する設計支援ツールです。
        </p>
        <div className="d2d-welcome-actions">
          <button
            type="button"
            className="d2d-btn primary"
            title="既存のD2Dプロジェクトを選択して開きます"
            onClick={() => void executeCommand('project.open', undefined, getCommandContext())}
          >
            プロジェクトを開く…
          </button>
          <button
            type="button"
            className="d2d-btn"
            title="保存先を選択して新しいD2Dプロジェクトを作成します"
            onClick={() => void executeCommand('project.createInFolder', undefined, getCommandContext())}
          >
            新規プロジェクトを作成…
          </button>
        </div>
      </section>

      <section>
        <h2 className="d2d-welcome-section-title">まず全体像を知る</h2>
        <div className="d2d-help-launchers">
          {helpItems.map((item) => (
            <button
              key={item.uri}
              type="button"
              title={`${item.title}のヘルプを開きます`}
              onClick={() => openResource(item.uri, item.title)}
            >
              <span>{item.icon}</span>
              <b>{item.title}</b>
              <small>{item.description}</small>
              <i aria-hidden="true">→</i>
            </button>
          ))}
        </div>
      </section>
      <p className="d2d-welcome-shortcuts">
        Ctrl+F 画面内検索 / Ctrl+Shift+P コマンドパレット / Ctrl+1〜6 作業モード切替
      </p>
    </main>
  )
}
