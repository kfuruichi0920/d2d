# D2D 開発状況・申し送り（STATE）

新しいセッション / 別の LLM で作業を始めるときは、まずこのファイルを読むこと。
フェーズ完了ごとに `dev-process/PROCESS.md` ステップ 7 に従って更新する。

## 現在地

- 完了: P0〜P13（クリティカルパス完走、MS6 相当まで）
- 残り: **P14**（性能・オフライン確認・残 TBD-06〜08・パッケージング・商用版）、
  **P5 の他形式抽出**（Excel / PowerPoint / PDF / Visio / テキスト系、EXT-014/015）
- テスト規模: ユニット 237 件 / pytest 10 件 / E2E 25 件（すべて成功の状態で引き渡し）

## フェーズ履歴（要点のみ）

| フェーズ             | 内容                                                                                                                                                                                      | コミット        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| P0〜P3               | 骨格 / DB スキーマ 35 表 + 台帳 / ジョブ・設定・イベント / Workbench UI                                                                                                                   | 〜P3 各コミット |
| P4/P5                | 原本取込 → Word 抽出 → ②候補 → 共通複数選択レビュー/構造プレビュー → 正本化                                                                                                               | —               |
| P6                   | LLM 基盤（4 Provider、マスキング、外部送信ブロック、preview→run 2段階）                                                                                                                   | —               |
| P7                   | プロジェクト成果物/フェーズ設定、フェーズ→成果物取込、②/③/プレビュー3ペイン統合編集                                                                                                       | —               |
| P8                   | ③→④候補生成 → 候補セットレビュー → 採用（同一 Txn・全 ROLLBACK）                                                                                                                          | —               |
| P9                   | 再帰 CTE トレース・SVG グラフ・マトリクス・整合性検査 → Problems                                                                                                                          | —               |
| P10                  | 状態遷移 / 用語集 / 表編集 / 検証編集 / PlantUML。schema 1.1.0 初適用                                                                                                                     | 81d96d1         |
| P11                  | 検索（FTS5 + MeCab トグル）※別セッションで実装・マージ                                                                                                                                    | 921a55d 等      |
| P12                  | DB to Text / SQLite dump / ZIP + manifest / 差分インポート / Git操作・履歴参照 / ストア閲覧                                                                                               | d2bc9c6         |
| P13                  | レポート出力（②③④→文書風、フィルタ、Markdown/HTML、report:// プレビュー）                                                                                                                 | 1123e29         |
| P7 追加              | 任意複数③マージ、2ペインResource Editor、所有判定による上書き／置換／保護派生                                                                                                             | aa9e815         |
| P3 追加              | 文字サイズ一括変更、可変パネル、Secondaryアコーディオン、再帰分割・タブ移動                                                                                                               | f59cadc         |
| P3 追加              | パネル表示切替、未確定Badge、Activity並べ替え・Settings下端固定・選択表示                                                                                                                 | 9af6c6d         |
| P4/P5追加            | 複数原本Job取込、抽出名称管理、Explorer Tooltip・強調折りたたみ                                                                                                                           | 7495617         |
| P3 追加              | ②/③/チャンク/Resource編集の内部ペイン可変化、チャンク表スタイル統一                                                                                                                       | a5ec368         |
| P7 追加              | ③取込編集の統合元選択・多対多based_on・個別解除・操作バー再編・全項目正本確定                                                                                                             | 1861358         |
| P3〜P8追加           | ①〜④ステージ一覧・ソート・OS原本表示・①②アーカイブ／論理削除・文書状態集約                                                                                                                | 585e959         |
| P3 追加              | ステージ選択表示・一覧キーボード操作・①〜③可変境界・Workbench外周状態共通化                                                                                                               | 6983f25         |
| P3/P7 追加           | Explorer閲覧専用化・ステージ操作集約・③重複整理・中間3モード切替                                                                                                                          | de2566f         |
| P3 追加              | SecondaryをProperties／Relations／Reviewへ整理、共通Selection・コメントtrace化                                                                                                            | 6514664         |
| P3/P8/P12追加        | 全画面検索・プレビュー表示切替・Relations遷移・Store全件閲覧・関係候補ルール検証                                                                                                          | 本コミット      |
| P4/P5追加            | 原本選択経路の操作統一・抽出データ存在時の抽出実行無効化（ユニット168件／E2E 18件）                                                                                                       | 09ab962         |
| P7追加               | 設定成果物の空③作成・未確認②取込・統合元状態修正・取込元／対応削除・階層識別                                                                                                              | 本コミット      |
| P9追加               | 汎用トレースマトリクス、複数Resource集合・関係種別・方向・セルの一括編集、転置／拡縮                                                                                                      | 本コミット      |
| P9追加               | 汎用インパクト分析、任意複数列・階層折畳・方向付きリンク・多段強調・関連項目限定表示                                                                                                      | 本コミット      |
| P9追加               | インパクト分析の列別scroll・全列リンク・Selection連携・DnD・構成保存・複数タブ化（Unit 179／E2E 18）                                                                                      | 本コミット      |
| P9追加               | 見出しドラッグによる列間隔調整・外側列の連動移動・構成保存（Unit 179／E2E 18）                                                                                                            | 本コミット      |
| P3/P7追加            | 中間成果物のShift+上下範囲選択、ウェルカム設計思想・3種Help、検索導線・全ボタンTooltip                                                                                                    | 本コミット      |
| P10追加              | セマンティック入力支援、構造化参照・正規化履歴・候補検索・辞書登録・関係検証（Unit 185／E2E 18）                                                                                          | 本コミット      |
| P10追加              | テキスト欄の色付き通常プレビュー・Enter/F2編集ダイアログ・Secondary固定順（Unit 187／E2E 18）                                                                                             | 本コミット      |
| P2追加               | プロジェクト作成時の標準5フェーズ・18成果物登録、設定可能なGit初期化（Unit 189／E2E 18）                                                                                                  | 本コミット      |
| P3追加(W1〜6)        | ショートカット上書き設定画面、Alt+Mメニュー、右クリックメニュー、Undo/Redo基盤、入力Tooltip保証、Welcome装飾のIDE調整（Unit 199／E2E 21）                                                 | 2f76e0b         |
| P3追加(W7)           | Undo接続拡大: intermediate.restore API、③削除／アーカイブ、③レビュー状態、マトリクスセル操作（Unit 199／E2E 22）                                                                          | cea12d5         |
| P3追加(W8)           | window.confirm 全廃、共通アプリ内確認ダイアログ confirmDialog（E2E制御可能・テーマ対応）（Unit 199／E2E 22）                                                                              | f79542e         |
| W9〜W12              | 戻る/進む（Alt+←→）、フォーカス系ショートカット、モーダルESC統一、動作/デバッグログPanel・日付毎ファイル・レベル設定、LLM生送受信ログ・候補再作成（schema 1.8.0、Unit 207／E2E 25）       | 本コミット      |
| P3/P12追加           | Workbench共通10配色のユーザ設定・テーマ既定復帰、Git状態／ステージ／コミット／ローカルブランチ操作、DB to Text＋SQLite dump自動同梱（Unit 209／E2E 25）                                   | 本コミット      |
| P3/P6追加            | Explorerのフォルダ／Resource別アイコン・右端タグ、画面別プロンプト選択／編集／新版保存、全LLMボタンの送信前確認（Unit 214／E2E 25）                                                       | 本コミット      |
| P3/P4/P7追加         | ExplorerをプロジェクトルートのVS Code風単一Tree化、フェーズ折畳、①／③右クリック取込、③成果物Badge整理・空統合元非表示（Unit 217／E2E 25）                                                 | 本コミット      |
| P3追加               | Explorer上下／左右キー・全展開／全折畳・統合元折畳、テーマ連動既定色、IDE検索、Pipeline分析／用語集／URIアドレス、Status簡素化（Unit 220／E2E 25）                                        | 本コミット      |
| P3/P11追加           | 上部メニューバーの旧ボタン意匠・戻る／進む／更新／ホーム・マウス履歴・可変アドレス・お気に入り、タブ移動Command、Search内グループTree・文書配下本文検索／要素ジャンプ（Unit 226／E2E 25） | 23c5878         |
| P3/P7/P9/P11/P12追加 | メニュー固定順・Title Bar簡素化・Command Palette初期候補／追従、③構成アウトライン、分析の全件集約、FTS＋全文部分一致、History順序・作業差分・Git項目差分（Unit 227／E2E 25）              | 本コミット      |
| P3/P7/P11追加        | ③structure_json復元・level準拠Tree／プレビュー／一覧scroll連動、Workbench zoom・レスポンシブボタン・共通タブ移動、Search選択scroll・メニュー幅制御（Unit 232／E2E 25）                    | 本コミット      |
| P3/P7追加            | zoom縮小余白解消、共通ボタンレスポンシブ撤回、抽出／中間限定の明示アイコン、Activity Barコンパクト化、プレビュー上下キー／一覧中央scroll（Unit 231／E2E 25）                              | 本コミット      |
| P3/P7/P10追加        | Editorタブ固定、Resource／テキスト編集のEditor統合・アドレスコピー、LLMアウトライン文脈、管理用特記事項、種別別定義、Monaco校正差分（schema 1.9.0、Unit 237／pytest 10／E2E 25）          | 本コミット      |

## 恒久制約（違反するとビルド/実行が壊れる、または設計方針違反）

- **package.json に `"type": "module"` を入れない**。sandbox 化された preload は CommonJS 必須。
- **better-sqlite3 の ABI 切替**: vitest 前に `npm rebuild better-sqlite3`、build/E2E 前に
  `npm run rebuild:electron`。※P11 マージ以降 `rebuild:node` スクリプトは無く、
  `postinstall` が rebuild:electron を実行する（npm install 直後は Electron ABI）。
- **候補と正本の区別は entity_registry.status**（draft=候補 / approved=正本）。
- **セマンティック入力は表示文章と構造化参照を分離する**。`semantic_text` に外部原文・表示文章・入力欄ポリシー、`semantic_reference` に文字範囲・参照UID・表示方法・関係種別・承認状態、`semantic_normalization_history` に差分・承認・取消履歴を保持する。自動認識は弱い `relates_to` の候補に限定し、承認済み参照だけを関係ルール検証後に `trace_link` へ確定する。辞書候補はスコープ・版・廃止・権限を考慮し、辞書登録は承認待ちで作成する。通常時のtext／multiline欄は専用背景のプレビューと編集ボタンだけを表示し、`Enter`／`F2`または編集ボタンで全編集機能を集約したモーダルダイアログを開く。
- **抽出由来・共有正本は破壊しない**: 編集・マージ・分割・表編集は新リソース + `based_on` trace_link
  （transform_note = edit / merge / split / edit-table）で由来を残し、旧リソースを保護する。
- **Main は Gateway/Shell のみ**。業務ロジックは backend/（utilityProcess）に置く。
  safeStorage は Main 専用 → backend からは main-bridge（逆方向 RPC）経由。
- **API キー等の秘密情報は平文で保存・ログ出力しない**（settings-service が強制）。
- スキーマ変更は `backend/db/migrations.ts` に追記（バックアップ → DDL → 版数更新）。現在 1.9.0（Resource編集の管理用特記事項、テキスト補足対象、図メタデータ／説明、数式説明を追加）。
- ②抽出レビューの選択・状態更新・構造プレビュー・Properties は `ReviewElement` 共通契約で実装し、
  Word 固有にしない。今後の Excel / PowerPoint / PDF / Visio / テキスト系も同じ操作体系へ接続する。
- Python ワーカーは stdin/stdout とも UTF-8 ラップ必須（CP932 化け）。pytest はシステム Python
  （miniconda）で実行（PATH 先頭の venv に pip が無い）。
- Workbench の文字サイズはツール全体設定 `theme.fontSize`（10〜20px、既定13px）で管理し、通常UIとMonacoへ即時反映する。
- Workbench全体の表示倍率は50〜200%で保持し、Ctrl/Cmd+±、Ctrl/Cmd+0、Ctrl/Cmd+ホイールをブラウザと同様の拡大・縮小・リセットへ割り当てる。縮小時は表示対象の論理viewport寸法を倍率の逆数で補正し、右端・下端に未使用余白を生じさせない。
- Workbench共通カラーは `theme.customColors` で背景、サーフェス、文字、補助文字、境界、アクセント、選択、ボタン背景・文字・境界を個別上書きする。未設定または設定解除時は選択中の表示モード、カラーテーマ、system時のOSテーマから求めた既定色へ戻す。
- Git UIは状態確認、選択ファイルのステージ／解除、コミット、ローカルブランチ作成／切替、履歴・diff参照を提供する。変更ファイル名はHEAD対作業ツリーのMonaco Diffを開く。履歴は1件選択で当該履歴対最新、2件選択で選択した新旧履歴を比較し、DB to Text JSONLをテーブル／UID／code／title／entity_type／変更フィールド単位の追加・削除・変更として表示する。コミット直前にDB to TextとSQLite dumpを再生成し、`exports/db_to_text/`と`exports/sqlite_dump/`を必ずステージする。project.dbやblobを自動ステージせず、ユーザが既にステージした変更は維持する。
- Primary／Secondary／下段パネルの表示・寸法とSecondaryアコーディオン開閉はWorkbench外周状態として1組だけ保持し、作業モード／①〜④ステージを切り替えても変更しない。再帰的なEditor分割木・分割比・タブ配置はプロジェクト単位（未選択時はglobal）でlocalStorageへ保持する。各境界はポインタと矢印キーで変更でき、領域内の表示超過は必要時だけ縦横スクロールする。
- SecondaryはWorkbench全体で共通のProperties／Relations／Review／Dictionaryを独立開閉できる縦アコーディオンとする。Propertiesは共通Selectionの選択アイテム属性、Relationsは当該UIDを端点とする`trace_link`の関係種別・相対方向・相手、Reviewはコメントを表示する。コメントは`resource_text(text_role='comment')`として保存し、コメント→選択アイテムの`relates_to`を同一トランザクションで作る。EvidenceはRelationsへ、LLM Candidatesは候補Editor／下段Panelへ集約する。Editorタブは最大220pxで省略表示し、収まらない場合は複数段へ折り返す。タブは分割区分へのドラッグ＆ドロップまたはコマンドで移動する。
- Primary／Secondary／下段PanelはTitle Bar右側ボタンとCommandの双方から表示切替する。Activity Barは44px幅、各Activityは36pxのアイコンのみで表示し、名称はTooltip／アクセシブル名で提供する。Settingsを下端固定し、それ以外のDnD順序をプロジェクト単位に保存する。選択ActivityはPrimary非表示時も選択色を維持する。保存レイアウトがないプロジェクトへ切り替えた場合は、直前プロジェクトの状態を持ち越さずM0既定値へ初期化する。
- Primary ActivityはExplorer／Search／Trace／Reports／History／Settingsで構成する。Reviewは各編集画面とSecondary、Jobsは下段PanelとStatus Barに集約し、Primary Activityへ戻さない。旧永続値のreview／jobsは読込時にExplorerへ正規化する。
- 上部メニューバーは戻る／進む／更新／ホーム｜件数付きの①～④と抽出▶／統合▶／モデル化▶、分析、用語集｜可変幅Resourceアドレスバー、お気に入り｜画面内検索の固定順で表示する。変換表記は他のボタン文字より1px小さくする。Title Bar左端はD2Dだけとし、中央にCommand Palette、右端にPrimary／Secondary／Panelの操作を配置する。Workbench全体の操作ボタンを一律レスポンシブ化しない。Title BarのPrimary／Secondary／Panelはアイコンのみとし、操作が密集する抽出／中間編集だけは重複しない明示アイコン＋文字列を通常表示し、狭幅時にアイコン中心へ切り替えてTooltip／アクセシブル名を維持する。①～④・分析・用語集は境界と背景を持つ同一ボタン意匠とし、メニューバー自身は横スクロールさせず、左側ボタンを縮小せずアドレス入力だけを画面幅へ追従させる。戻る／進むはAlt+左右矢印とマウスbutton 3/4を同じResource履歴へ接続し、更新はアクティブEditorを再読込、ホームはダッシュボードを開く。お気に入りはURIと変更可能な表示名をプロジェクト単位でlocalStorageへ保存しExplorerへ表示する。
- SearchのMeCab未使用時はNFKC正規化したFTS結果と全文部分一致結果を常に併合する。FTSが1件以上返した場合もLIKE結果を省略しない。MeCab使用時は形態素解析により時間がかかる場合がある旨をSearch Activityへ表示する。
- 汎用分析の全抽出／全中間／全設計モデルは `all:extracted`／`all:intermediate`／`all:design` の集約scopeで解決し、文書別scopeの多重選択に依存しない。
- Pipeline Navigatorは `①原本-(抽出)->②抽出-(統合)->③中間-(モデル化)->④モデル`、分析、用語集、Resourceアドレスバーを固定順で表示する。選択表示はactiveなステージURIだけを基準とし、①〜④を排他的に表示する。分析は全抽出／全中間／全モデルの3列で汎用インパクト分析を開く。アドレスバーは既知URIだけを受理し、不正時は通知して遷移しない。Status Barには作業モード名とResource URIを表示しない。①〜④の一覧行は薄青背景で選択を示し、上下矢印で選択行を移動、Enter／Spaceでクリックと同じ操作を実行する。④モデルは単一クリックで開く。①〜③の一覧／プレビュー境界は共通 `ResizablePaneGroup` で変更する。
- Explorer未確定Badgeは文書状態ではなく要素単位で集計し、extracted_itemはresource_uid、intermediate_itemはitem uidに対応するentity_registry.statusがapproved／deleted以外の件数を表示する。削除済みを除く子要素が1件以上かつ全件approvedの場合だけ抽出／中間文書もapprovedとし、それ以外はdraftへ同期する。
- Explorerはプロジェクト名をルートとするVS Code風の単一Treeとし、①〜④、③のフェーズ階層、成果物配下の統合元を折りたためる。上下矢印で表示ノードを移動し、右矢印で展開、左矢印で折畳または親へ移動する。プロジェクト行に全展開／全折畳を置き、文字強調はプロジェクト行だけとする。原本・抽出・中間・設計モデル・統合元はResource種別別ファイル系アイコンを名称左へ、状態・形式・分類・件数タグを名称右へ表示する。③成果物は「成果物」Badgeを表示せず、レビュー状態・未確定数・要素数を表示し、統合元0件の代替行は表示しない。Explorerには常設の取込・名称変更・チャンク・モデル追加ボタンを置かないが、右クリックは①原本フォルダの「取込」、③中間フォルダの「中間データへ取込」、③成果物の取込先初期選択済み「取込」だけを提供し、②抽出フォルダには提供しない。Pipeline Navigatorの各ステージはEditor Areaにソート可能な一覧を開き、①は一覧上部の取込からWindows複数ファイル選択を直接開く読取専用詳細、②は独自プレビューとExplorer選択案内、③は一覧上部の取込とフェーズ－成果物階層、④はモデル一覧と追加操作を表示する。原本はファイルごとに独立した `import.source` Jobへ登録する（実行はJob Managerの直列制約を維持）。
- 抽出文書の初期 `entity_registry.title` は原本の `source_document.file_name` と同一にする。後の名称変更は抽出文書の `entity_registry.title` だけを更新し、原本名・blob・traceは変更しない。
- ①原本はPipeline NavigatorとExplorerのどちらから選択しても「OSアプリで開く」と「②抽出データの生成（抽出ジョブ実行）」を表示する。`source_document.uid`を参照する`extracted_document`が存在する場合は抽出実行を無効表示し、Backendも重複実行を拒否する。
- ①原本・②抽出・③中間の通常削除は `status='deleted'` の論理削除、Explorerだけからの一時非表示は `is_archived=1` とする。アーカイブはステージ一覧に残して復元可能とし、schema 1.5.0で `entity_registry.is_archived` と索引を追加した。同じ `dev_phase_id`／`artifact_type_id` の③が複数ある場合は、現在表示中の1件を優先し、表示中が複数なら最新1件以外を自動アーカイブする。復元時は同一成果物の他文書をアーカイブしてExplorer表示を最大1件に保つ。
- Search Activityの検索結果は検索ボタン直下へResource種別ごとの折畳Treeで表示し、10件以下を初期展開、10件超を初期折畳とする。上下キーは選択移動とEditorプレビュー、左右キーはグループ折畳／展開へ割り当て、選択結果が表示範囲外なら検索結果リストを最小量スクロールして追従する。原本／抽出文書／中間文書の検索種別は配下itemのResource本文もFTS対象とし、結果は対象文書を開いてitem UIDまたはresource UIDで該当要素を選択・スクロールする。下段PanelにSearch Resultsタブは置かない。
- Workbench内文字検索は `Ctrl/Cmd+F` の共通検索UIで提供する。文書プレビューのパーツ種別・セクション・要素ID表示は共通 `DocumentPreviewMeta` で切替・ツール全体保存し、抽出形式固有の表示判定を各Editorへ埋め込まない。
- Workbenchの全操作ボタンは個別の詳細`title`を優先し、未設定時は共通Tooltip保証でアクセシブル名から操作説明を補う。画面内検索はCtrl/Cmd+Fに加えてTitle Barの常時表示ボタンから開く。
- プロジェクト未選択時のウェルカムは、自然言語の「文書」とオントロジーへ写像した「データ」の定義を示す。操作フロー、データスキーマ、SRS 9章の設計モデルは `help://workflow`／`help://schema`／`help://design-model` の読取専用Resourceとして通常のEditorタブへ開く。
- SecondaryのProperties／Relations／Review／Dictionaryは開閉状態にかかわらずこの定義順を維持し、閉じても並べ替えない。Relationsは相手エンティティから `resource://`／`original://`／`extracted://`／`intermediate://`／`chunk://` の編集URIを解決し、クリックまたはEnter／Spaceで開く。
- ストア閲覧はCOUNTによる総件数と500件単位の追加読込で全件到達可能にし、固定件数で打ち切らない。表は行番号・縦横スクロール・薄青選択・上下キー移動を備え、選択行を共通Selectionへ通知する。
- 関係性候補の選択肢は `relation_rule_master.allowed=1` と始点／終点カテゴリから導出する。LLMが許容外の関係性を返した場合は元値を保持して警告表示し、許容関係へ修正するまで採用不可とする。
- ショートカットは Command 定義の既定値を `d2d.keybindings.overrides`（localStorage、ツール全体）で上書きする。照合・表示は必ず `resolveKeybinding()` を通し、`def.keybinding` を直接参照しない。カスタマイズUIはツール設定内（`KeybindingSettingsSection`）。エディタと下Panelの同方向タブ移動には同一キーを設定でき、最後に選択したタブ領域を判定してその領域だけを移動する。入力欄フォーカス中は Ctrl/Alt 修飾付きのみ有効で、`skipInEditable: true` の Command（edit.undo/redo）は入力欄内で無効。
- アプリケーションメニューは Title Bar 右端のハンバーガー（Alt+M、`menu.toggle`）から開く。項目は Command 定義から解決し（`AppMenu.tsx` の MENU_GROUPS）、新 Command 追加時は必要に応じてグループへ登録する。右クリックメニューは共通 `showContextMenu(event, items)`＋`ContextMenuHost`（WorkbenchShell 直下）を使い、画面独自のメニューDOMを実装しない。
- ユーザ操作の取り消しは `undo-service`（`pushUndo({label, undo, redo})`、Ctrl+Z/Ctrl+Y、最大100件）。DB正本の変更は Backend の逆操作API（`document.restore`／`extracted.restore`／`intermediate.restore`）を undo に指定して登録する。`intermediate.restore` は復元時に同一成果物の他文書をアーカイブし Explorer 表示≤1件の排他規則を維持する。プロジェクト切替・クローズで履歴は破棄する。undo 実行失敗時はエントリを破棄する（二重取消防止）。
- マトリクス編集の Undo は「正確に逆転できる操作」だけ登録する: toggle は自己逆操作として常に、add/delete は `unchanged === 0` のときのみ（既存関係を巻き込むと逆操作が正本を壊すため）。
- ボタンに加えて input／select／textarea も `GlobalButtonTooltips` が Tooltip を保証する。明示 `title`（説明＋例）を最優先し、未設定時は label／aria-label／placeholder から補完する。
- Editor の表示Resource遷移は `navigation-history` が記録し、`nav.back`／`nav.forward`（Alt+←／Alt+→）で行き来する。閉じたタブは同一URI・タイトルで開き直す。履歴はメモリのみで、プロジェクト切替時に破棄する。
- モーダルダイアログの Escape クローズは共通フック `useEscapeToClose(active, onClose)` を使う（document capture + スタックで最前面だけを閉じる）。ダイアログ要素個別の onKeyDown で Escape を実装しない。
- トースト通知はすべて自動消去（info/warning 5秒、error はその3倍の15秒）。通知は `logs-store`（動作ログ、最大500件）へ記録され、Panel Output タブの「動作ログ」で参照する。あわせて `log.append` でデバッグログファイルにも残す。
- デバッグログはプロジェクトの `logs/debug/<frontend|backend>-YYYY-MM-DD.log`（日付毎・ローカル日付）。レベルはプロジェクト設定 `logging.debugLevel`（error<warn<info<debug、既定 info）。Backend API の失敗は `router.onDispatchError` 経由で backend ログへ自動記録する（log.* 自身は除外）。プロジェクト未オープン時はファイル出力しない。
- LLM 実行は生送受信ログ（マスキング後・APIキーなし。Gemini はURLキーもマスク）を blobs/llm/ へ保存し、`llm_run_ref.raw_request_blob_uid`／`raw_response_blob_uid` から参照する。`llm.retryRun` は `process_name='design-candidates'` かつ input_ref_uid のある実行だけ同一チャンクで候補生成ジョブを再登録する。
- prettier は docs/ と tasks/ を対象外（.prettierignore）。
- 画面上のLLM実行（接続テスト、④候補生成、Resourceマージ、セマンティック用語候補、ログ再実行）は共通 `LlmRequestDialog` で用途別テンプレートを選択・実行時編集・新版保存し、`llm.preview` で送信先、モデル、マスキング後の全メッセージを表示する。明示承認後だけ `llm.runConfirmed` からジョブ登録し、選択した `prompt_template.uid` を実行ログへ保持する。
- LLM 外部送信はプロジェクト設定 `llm.externalSendAllowed`（既定 false）でブロックされる。
- 新規プロジェクトは標準5フェーズ・18成果物を登録する。同名成果物（レビュー記録／障害台帳）はフェーズ単位で独立して保持する。ツール全体設定 `project.initializeGitOnCreate` は既定trueで、作成時にbest-effortで `git init` を実行し、失敗してもプロジェクト作成は継続する。schema 1.7.0では成果物名の一意性を `(project_uid, dev_phase_id, artifact_name)` とし、移行時も成果物関係を保持する。
- Settings はツール全体設定（`settings://tool`）とプロジェクト設定（`project-settings://current`）を分離する。
  成果物・開発フェーズ・LLM外部送信可否は後者で管理する。
- ③中間データの統合元正本は文書間 `based_on`。`structure_json.sources` は表示順、
  `source_extracted_document_uid` は旧データ互換用で新規データでは NULL とする。
- ③編集の移動は連続した intermediate_item 選択のみ許可し、Ctrlによる歯抜け選択は拒否する。
- 成果物は `project_artifact_setting.dev_phase_id` で開発フェーズ配下に所属する。schema 1.2.0で追加。
  成果物・フェーズの「削除」は関連③中間データを含む物理削除であり、確認後も復旧不能。
- 統合元対応の正本は `intermediate_item.uid → extracted_item.uid` のアイテム単位 `based_on`。多対多とし、紐付済み統合元も選択・別成果物行への再利用を許可する。取込編集の状態列は `extracted_item.resource_uid` 側の抽出レビュー状態を表示する。「削除」は選択した extracted_item を終点とする当該中間文書配下のアイテムリンクだけを削除し、成果物行・Resource・抽出データ・文書単位リンクは保持する。`structure_json.elements[].intermediate_item_uid` を持つ新形式データは明示解除後に互換補完を再実行しない。編集・マージ・分割後も元 extracted_item へのリンクを維持する。
- ②プレビューと③の3ペインは必要時だけ縦横スクロールを表示し、3ペイン選択は対応要素を相互強調する。
- ②抽出と③中間のプレビューは右寄せした「文書プレビュー」／`structure_json`ボタンで切り替える。`structure_json`はアウトラインへ置換せず、DBのJSON文字列をBackendで解析した元のキー・値Treeとして表示する。③成果物一覧はitemの表示順とlevelから、直前にある最寄りの低level要素を親とするアウトラインTreeへ切替でき、折畳状態は文書プレビューの表示要素にも連動する。プレビューは上下矢印で前後項目へ選択・フォーカスを移動できる。プレビューで項目を選択した場合は成果物一覧の選択に加え、明示的なscroll版数更新時だけ対象行を一覧中央へスクロールする。表側の通常クリックでは中央scrollを発火させず、ダブルクリック対象が途中で入れ替わらないようにする。
- Explorer の③成果物は有効状態かつ `artifact.dev_phase_id === phase.dev_phase_id` の設定を②取込前から表示し、未所属成果物は表示しない。フェーズと成果物は種別ラベル・境界・背景で区別し、成果物選択時に対応する③がなければ統合元なしの空③を作成して編集画面を開く。
- ③成果物の状態サイクルは `draft → approved → review → rejected → draft`。成果物ペインの上下矢印はデータ順を変更せず、選択行の前後移動とフォーカス追従に割り当てる。
- チャンクは成果物単位で管理し、確認済み intermediate_item と多対多で対応する。対応正本は chunk → intermediate_item のアイテム単位 based_on。チャンク固有の追加プロンプトは chunk.additional_prompt に保持し、LLM候補生成時に本文へ追加する。
- チャンク編集の成果物ペインは状態・ID・種別・内容・小節・選択を表示し、中間編集と同じ階層/種別表現にする。チャンクは表形式で、追加プロンプトはチャンク行選択後の上部「編集」から変更する。プレビューは見出し階層・表・図を表示する。チャンクはsort_order順に表示し、新規作成は末尾、上下移動ではIDを変更しない。
- 中間データ取込編集・単独編集・チャンク編集の成果物一覧は、クリックした行をアンカーとしてShift+上下矢印で現在表示順の連続範囲を拡張・縮小する。チャンクは未確認行を飛ばし、確認済み行だけを範囲へ含める。
- ②抽出・③中間・チャンク編集の選択行は `--d2d-selection-bg` の薄青背景、`based_on` 対応行は warning 22% mix の黄色背景で統一する。チャンク表も共通の罫線・角丸を使い、太い選択枠を独自実装しない。
- ②抽出（2ペイン）、③取込（3ペイン）／単独（2ペイン）、チャンク（3ペイン）、Resource編集（2ペイン）の内部境界は共通 `ResizablePaneGroup` を使用する。隣接ペインの合計比率と最小120pxを守り、ポインタドラッグと矢印キーの両方で変更する。チャンク表は横罫線のみとし、状態Badgeは折り返さない。
- Explorer の②抽出データ行に③への統合ボタンを置かず、③ステージ一覧上部の `取込` から、取込先成果物を排他的に1件、レビュー状態を問わない②を複数選択する。既存成果物を選ぶと `structure_json.sources` の関係を初期チェックへ復元し、保存時は文書単位 `based_on` と同期する。③ステージは成果物配下に取込元②を表示し、未使用の取込元を同画面から削除できる。統合済み要素の由来となる②は、対応する成果物要素を削除するまで取込元から外せない。チャンク操作は中間文書Editor上部のモード切替から開く。
- 中間文書エディタは同一Resource内で「中間データ取込編集画面」（統合元／成果物／プレビューの3ペイン）、「中間データ単独編集画面」（成果物／プレビューの2ペイン）、「チャンク編集画面」（成果物／チャンク／プレビューの3ペイン）を切り替える。ヘッダーは文書の自由名称ではなくプロジェクト成果物名を表示する。成果物要素の追加・複製・削除・編集は取込／単独画面共通で、ダブルクリックまたはSpace／Enterから編集を開く。
- 中間要素の追加・複製は新Resourceを作成する。複製は元Resourceへ `transform_note=duplicate` の `based_on` を保持し、②由来のアイテム単位トレースも引き継ぐ。基本種別編集は paragraph／heading／list_item／caption を対象とする。
- Resource編集は4.6の14種を定義駆動で共通化し、`resource://<uid>` からも開ける。保存直前にDBで所有・参照状況を判定する。③で新規作成され現在の `intermediate_item` だけが参照するResourceは、同種なら同じUIDへ上書きし、異種なら現在要素を新Resourceへ差し替えて旧Resourceを物理削除する。抽出由来、共有、入力トレース、他Resource、LLM実行記録から参照されるResourceは保護し、新Resource + 元Resourceへの `based_on (edit-resource)` とする。
- 中間要素の一覧マージはCtrl/Shiftの非連続を含む2件以上を文書表示順で処理し、先頭位置・階層へ集約する。同一Resource種別は同種の候補へ、異種は可読な `resource_text` へ変換し、全元Resourceへの `based_on (merge)` と全 `extracted_item` 由来を維持する。
- 中間要素から開くResource Editorは左を抽出由来（読取専用）または画面追加Resource（編集可能）、右を保存候補とする。通常/LLMマージは右フォームを更新するだけで、明示保存まではDBを変更しない。LLMマージは既存Provider・外部送信可否・マスキングを経由し、保存時は `llm_run_uid` と `llm-merge` を由来へ記録する。
- Editorタブはタブ上のピン操作またはコンテキストメニューで固定／解除し、固定状態をプロジェクト別レイアウトへ保存する。Resource編集と各テキスト欄の編集はモーダルからEditor Areaへ統合でき、Resourceアドレスをコピーできる。
- Resource EditorのLLM入力には中間文書の親子関係・アウトライン位置と入出力フィールド定義を自動付加する。`entity_registry.administrative_notes` は管理専用で、設計情報・Markdown・LLM設計候補へ送らない。廃止列は既存DB互換のため物理保持しても、編集定義・新規保存・LLM入出力から除外する。
- セマンティック編集は左にMonaco Markdown編集／用語候補／用語候補(LLM)、右に複数行プレビュー／構造化データ／校正・正規化(LLM)差分を置く。入力補完はCtrl+Spaceとし、LLM子ダイアログ表示中のEscapeは最前面の子だけを閉じる。MonacoはElectronのIME・Playwright入力互換性のため`editContext: false`を指定する。
- リストResourceの`items_json`は物理列名を互換維持しつつMarkdownリストを保持する。旧JSON配列も読取互換とする。図は抽出時に幅・高さ・バイトサイズ・画像形式を保持して画像と説明を表示し、数式はTeX（MathJax）本文と説明を扱う。図／数式からの派生Resourceは新規追加または既存参照し、関係を`trace_link`へ保存する。

- 汎用トレースマトリクスの軸は、設計分類、②抽出文書、③中間文書、Resource種別のスコープを複数選択してResource集合を構成する。③中間文書は`intermediate_item`を束ねる表示スコープであり、文書自体をセル要素として扱わない。
- マトリクス編集の正本は`trace_link`とし、行→列／列→行の方向を保持する。単一セルのトグルと、複数セル・行・列への追加／削除は同じBackend操作APIを通し、複数対象は1トランザクションで検証・更新する。
- マトリクスからの関係削除は`trace_link.status='deleted'`の論理削除とし、追加時は`relation_rule_master`の始点／終点カテゴリ規則を検証する。表示は複数関係種別を同時に色・記号で識別し、転置は表示軸だけを交換して保存済みfrom/toを変更しない。
- 大きなマトリクスは表領域だけをスクロールし、行・列見出しをsticky表示する。アクティブセルの十字強調、関係を持つ見出しの強調、ResourceプロパティTooltip、60〜160%の表示倍率を共通Editorで提供する。
- 汎用インパクト分析は固有URI `trace://list-link/<view-id>`で開き、設計分類、②抽出文書、③中間文書、Resource種別のスコープを各列へ複数配置する。列は最大8、1列1000項目、表示中の全列組合せリンクは全体5000件を上限とし、上限到達を画面へ明示する。トレースマトリクスも`trace://matrix/<row>/<col>/<view-id>`で開き、両EditorはTrace Side Barから同種の別タブを複数作成できる。
- インパクト分析は選択項目を起点に、表示中の全列組合せの`trace_link`を双方向BFSで辿って全列の到達項目とリンクを強調する。関連項目限定表示では起点列の全項目を維持し、他列を到達項目とその祖先だけへ絞る。DB正本は変更しない。
- ②・③の階層は`structure_json.elements`の文書順・見出しlevel・list levelから派生し、折畳中の子リンクは最寄りの表示中祖先へ集約する。項目・リンクは台帳プロパティTooltipを表示する。
- インパクト分析の各列は独立縦スクロールとし、列scroll／横viewport scrollに追従するリンク再計測を`requestAnimationFrame`で1フレームへ集約する。表示領域と160px overscan内に端点を持つリンクだけをSVG描画し、画面外端点は各列の表示端へクランプする。リンク表示OFF時は再計測とSVG描画を停止する。
- インパクト分析の項目クリック／上下キー／Shift+上下キーはWorkbench共通Selectionへアクティブ項目を通知する。列順・列スコープ・列間隔・関係種別・リンク表示状態の名前付き構成は`d2d.trace-impact.configurations.<project-key>`のlocalStorageへ複数保存し、正本DBへは保存しない。列順は見出しDnDで変更する。見出しの間隔ハンドルは直前列との間隔を24〜320pxで調整し、その列以降の外側列を同じ差分だけ連動移動する。

## E2E（Playwright）の注意

- E2E開始時はElectron userDataに前回実行のレイアウトが残り得るため、`d2d.workbench.*`／`d2d.editors.*`／`d2d.keybindings.*` のlocalStorageだけを削除してRendererを再読込する。設定Backendやプロジェクト正本は削除しない。
- プロジェクト作成の既定Git初期化を検証する前に、永続化された project.initializeGitOnCreate を削除してテスト開始条件を固定する。
- `e2e/app.spec.ts` は**逐次実行・状態共有**（beforeAll で 1 プロジェクト作成、afterAll で
  app.close 後に削除。開いている project.db を rmSync すると EBUSY）。
- Electron Rendererの `window.prompt()` は入力ダイアログとして利用できない。`window.confirm()` もネイティブダイアログとなり Playwright の dialog イベントで確実に制御できず出っぱなしになる。名称変更・破壊的操作の確認はテーマ対応のアプリ内ダイアログ（確認は共通 `confirmDialog()` + `ConfirmDialogHost`、`confirm-ok`／`confirm-cancel` testid）を使い、E2E はボタンクリックで操作する。
- Activity Bar のボタンは**再クリックでサイドバーが閉じる**トグル。クリック前に
  `isVisible().catch(() => false)` で条件分岐する（既存テストのパターンを踏襲）。
- `<input>` の値は textContent に出ない → `toHaveValue` を使う。
- パネルは `status-jobs` クリックで強制オープンしてからタブ切替。
- 前のテストがデータを書き換えることがある（例: P6 テストが③本文を置換）。
  後続テストで参照する文言は実際に残る文言を選ぶ。
- チャンク編集を開き直した場合、チャンク選択は復元しない。候補生成など選択必須操作のE2Eは、対象チャンク行を明示選択してから実行する。

## 残課題（正直リスト）

- Git UIのremote操作（fetch／pull／push）、merge／rebase、競合解消は未対応。現時点の基本操作はローカルRepository内に限定する。

- P14 一式（性能 NFR-001〜005 実測、オフライン確認、TBD-06〜08、
  Java/Graphviz/PlantUML/MeCab 同梱パッケージング P14-5、pymupdf 商用版 P14-6）
- P5 他形式抽出: Excel / PowerPoint / PDF / Visio / テキスト系（P5-7〜14）、
  Word 拡張（脚注・コメント・変更履歴・テキストボックス・数式）
- Undo/Redo（NFR-012）接続済み: ②レビュー状態・②名称変更・①②③アーカイブ・①②③論理削除（restore API）・
  ③レビュー状態・マトリクスセル操作（toggle常時、add/deleteは完全逆転時のみ）・用語状態変更。
  未接続: ③要素の追加・編集・複製・削除・マージ・分割（新Resource作成／structure_json位置の復元が必要）、
  ③表示順・階層変更（端でのクランプにより逆操作が不正確になり得るため見送り）、チャンク操作、
  取込元の更新（updateSources）、セマンティック参照の承認・取消、設定変更。
- コンテキストメニューはEditorタブ・Explorer行・Jobs一覧のみ。ステージ一覧行・マトリクスセル等は未接続（共通 `showContextMenu` へ追加するだけ）。
- ツールチップの「説明＋例」の明示 `title` はSettings／Glossary等の代表画面のみ。他画面は自動補完文（label由来）が表示される。
- LLMログからの候補再作成は design-candidates（④候補生成）のみ。intermediate.textCandidate 等の他処理種別・
  プロンプト編集付き再実行は未対応。エラートーストの自動消去時間（15秒）はE2E未検証（時間都合、実装は notify の setTimeout）。
- 動作ログはRendererメモリのみで再起動後は消える（永続側はデバッグログファイルが担う）。デバッグログの
  ローテーション（古い日付ファイルの自動削除）は未実装。
- resource_table_cell の entity_registry CHECK 制約追加（テーブル再構築が必要 → 将来 2.0.0）
- アーカイブ差分の左右テキストは Backend プロセス内保持（再起動後は差分インポート再実行）
- Word 抽出の LLM 補助（EXT の一部）、GC 系 Golden Case の拡充
- 編集画面内部のペイン比率はEditorを開いている間だけ保持し、閉じる／再起動後の復元は未実装。
- Resource EditorのJSONカラムは構造化テキスト編集。表セルは既存のセルグリッド編集も併用し、図の画像実体差替えは画像URI編集として扱う。
- 同種の複雑Resource（表、図、モデル等）の通常マージは、JSON配列は連結、JSONオブジェクトはキー統合、競合するenum/数値等は先頭値を採用して警告する。意味的な再構成が必要な場合はLLMマージまたは右フォームでの手動修正が必要。
