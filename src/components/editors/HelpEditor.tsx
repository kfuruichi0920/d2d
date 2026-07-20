/** D2Dの概念を視覚的に説明する読取専用Help Resource（P3-10、UI-051/057）。 */
import { useEditorStore } from '../../stores/editor-store'

export type HelpTopic = 'workflow' | 'schema' | 'design-model' | 'addresses'

const topics: { id: HelpTopic; label: string; title: string }[] = [
  { id: 'workflow', label: '操作の流れ', title: '①原本からトレーサビリティ分析まで' },
  { id: 'schema', label: 'データスキーマ', title: 'D2Dのデータスキーマ' },
  { id: 'design-model', label: '設計モデル', title: '設計モデルの考え方' },
  { id: 'addresses', label: 'アドレス', title: 'アドレスの使い方' }
]

const modelGroups = [
  { title: '根拠と規範', items: ['SRC 一次情報', 'STD 規範情報'] },
  {
    title: '要求と設計',
    items: [
      'REQ 要求',
      'CST 制約',
      'FUNC 機能',
      'STRUCT 構造',
      'BEH 振舞',
      'STATE 状態',
      'IF インタフェース',
      'DATA データ'
    ]
  },
  { title: '確認と実現', items: ['VERIF 検証', 'MGMT 管理', 'IMPL 実装'] }
]

export function HelpEditor({ topic }: { topic: HelpTopic }): React.JSX.Element {
  const openResource = useEditorStore((state) => state.openResource)
  const current = topics.find((item) => item.id === topic) ?? topics[0]!
  return (
    <article className="d2d-help" data-testid={`help-${topic}`}>
      <header className="d2d-help-header">
        <div>
          <span className="d2d-help-eyebrow">D2D HELP</span>
          <h1>{current.title}</h1>
        </div>
        <nav aria-label="ヘルプ項目">
          {topics.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`d2d-btn ${item.id === topic ? 'primary' : ''}`}
              title={`${item.title}を開きます`}
              onClick={() => openResource(`help://${item.id}`, item.title)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </header>
      {topic === 'workflow' ? (
        <WorkflowHelp />
      ) : topic === 'schema' ? (
        <SchemaHelp />
      ) : topic === 'design-model' ? (
        <DesignModelHelp />
      ) : (
        <AddressHelp />
      )}
    </article>
  )
}

function WorkflowHelp(): React.JSX.Element {
  const stages = [
    { no: '①', name: '原本', input: 'Word / Excel / PDF 等', action: '無改変で保管', output: '由来の起点' },
    { no: '②', name: '抽出データ', input: '文書の内容', action: '構造と要素を抽出', output: '確認可能な要素' },
    {
      no: '③',
      name: '中間データ',
      input: '確認した抽出要素',
      action: '成果物へ統合・編集',
      output: '意味のある設計記述'
    },
    {
      no: '④',
      name: '設計モデル',
      input: '中間データとチャンク',
      action: '設計要素・関係を候補化',
      output: 'レビュー済みモデル'
    }
  ]
  return (
    <>
      <p className="d2d-help-lead">
        文書を一気にモデルへ変換せず、各段階で人が根拠と意味を確認します。正本を壊さず、新しいResourceと
        <code>based_on</code>を積み重ねるのが基本です。
      </p>
      <div className="d2d-flow" aria-label="①原本から④設計モデルまでの流れ">
        {stages.map((stage, index) => (
          <div className="d2d-flow-step" key={stage.no}>
            <div className="d2d-flow-card">
              <span className="d2d-stage-number">{stage.no}</span>
              <h2>{stage.name}</h2>
              <small>{stage.input}</small>
              <strong>{stage.action}</strong>
              <span>{stage.output}</span>
            </div>
            {index < stages.length - 1 && (
              <span className="d2d-flow-arrow" aria-hidden="true">
                →
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="d2d-review-lane">
        <b>Human-in-the-loop</b>
        <span>抽出確認</span>
        <span>統合確認</span>
        <span>候補レビュー</span>
      </div>
      <section className="d2d-analysis-card">
        <div>
          <span className="d2d-stage-number">分析</span>
          <h2>トレーサビリティ</h2>
        </div>
        <p>要求の根拠、機能への割当、検証の対応、変更影響を、マトリクス・関係グラフ・階層リンクでたどります。</p>
        <div className="d2d-analysis-pills">
          <span>根拠をたどる</span>
          <span>未接続を検出</span>
          <span>変更影響を確認</span>
        </div>
      </section>
    </>
  )
}

function SchemaHelp(): React.JSX.Element {
  return (
    <>
      <p className="d2d-help-lead">
        すべてのデータを共通台帳で識別し、内容と関係を分けて保持します。ファイル本体と検索・編集用データにも明確な役割があります。
      </p>
      <div className="d2d-schema">
        <section className="d2d-schema-box registry">
          <b>共通台帳</b>
          <h2>entity_registry</h2>
          <p>uid / code / type / title / status</p>
        </section>
        <div className="d2d-schema-connectors" aria-hidden="true">
          ↓　　↓　　↓
        </div>
        <div className="d2d-schema-columns">
          <section className="d2d-schema-box">
            <b>文書層</b>
            <h3>source_document</h3>
            <p>原本、抽出文書、位置、版</p>
          </section>
          <section className="d2d-schema-box">
            <b>意味内容層</b>
            <h3>resource_*</h3>
            <p>text / table / model / interface / state …</p>
          </section>
          <section className="d2d-schema-box">
            <b>関係層</b>
            <h3>trace_link</h3>
            <p>起点・終点・関係種別・根拠</p>
          </section>
        </div>
        <div className="d2d-schema-storage">
          <section>
            <b>project.db</b>
            <span>構造・属性・レビュー・関係</span>
          </section>
          <section>
            <b>blobs/</b>
            <span>原本や画像を無改変で保管</span>
          </section>
        </div>
      </div>
      <aside className="d2d-help-note">
        <b>オントロジー（意味構造）</b>
        とは、単なる文章の並びではなく「これは要求」「これは機能」「この検証が要求を確かめる」のように、種類と関係を明示したデータです。
      </aside>
    </>
  )
}

function DesignModelHelp(): React.JSX.Element {
  return (
    <>
      <p className="d2d-help-lead">
        ④設計モデルは、13分類の「設計要素」と、要素同士を結ぶ「関係」を分離して管理します。LLMの出力は候補であり、人が採用するまで確定情報ではありません。
      </p>
      <div className="d2d-model-groups">
        {modelGroups.map((group) => (
          <section key={group.title}>
            <h2>{group.title}</h2>
            <div>
              {group.items.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="d2d-relation-map">
        <section>
          <b>根拠</b>
          <code>based_on</code>
          <p>SRCは主に根拠の接続先</p>
        </section>
        <section>
          <b>設計</b>
          <code>satisfies / allocated_to / contains / decomposes</code>
          <p>要求を満たし、責務を割り当て、構造化する</p>
        </section>
        <section>
          <b>検証・実装</b>
          <code>verifies / implements / uses / calls</code>
          <p>確認方法と実現物まで接続する</p>
        </section>
      </div>
      <div className="d2d-review-gate">
        <span>LLM候補</span>
        <span aria-hidden="true">→</span>
        <b>
          人間レビュー
          <br />
          採用・修正・棄却
        </b>
        <span aria-hidden="true">→</span>
        <span>確定した設計モデル</span>
      </div>
      <div className="d2d-owner-compare">
        <section>
          <code>owner_uid</code>
          <b>所有者・管理主体</b>
          <p>状態、IF、データ等のライフサイクル責任</p>
        </section>
        <section>
          <code>allocated_to</code>
          <b>要求・制約・機能の割当</b>
          <p>どの構造要素が責務を担うかという関係</p>
        </section>
      </div>
    </>
  )
}

function AddressHelp(): React.JSX.Element {
  const formats = [
    ['original://<uid>', '原本を開く'],
    ['extracted://<uid>', '抽出データ編集を開く'],
    ['intermediate://<uid>', '中間データ編集を開く'],
    ['chunk://<中間データuid>', '中間成果物のチャンク編集を開く'],
    ['candidate://<LLM実行uid>', '設計候補セットを開く'],
    ['design://<uid>', '設計モデルを開く'],
    ['resource://<uid>', '共通Resource Editorを開く']
  ]
  return (
    <>
      <p className="d2d-help-lead">
        上部のアドレスバーへResource URIを入力してEnterを押します。UIDを省略した
        <code>resource://</code>等では、該当する全リンクの一覧を表示します。
      </p>
      <table className="d2d-table" data-testid="address-help-formats">
        <thead>
          <tr>
            <th>書式</th>
            <th>用途</th>
          </tr>
        </thead>
        <tbody>
          {formats.map(([format, purpose]) => (
            <tr key={format}>
              <td>
                <code>{format}</code>
              </td>
              <td>{purpose}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <aside className="d2d-help-note">
        <b>空タブ</b>
        タブ列の「＋」または <code>Ctrl+T</code> で追加できます。ショートカットはツール設定から変更できます。
      </aside>
    </>
  )
}
