# D2D 開発状況・申し送り（STATE）

新しいセッション / 別の LLM で作業を始めるときは、まずこのファイルを読むこと。
フェーズ完了ごとに `dev-process/PROCESS.md` ステップ 7 に従って更新する。

## 現在地

- 完了: P0〜P13（クリティカルパス完走、MS6 相当まで）
- 残り: **P14**（性能・オフライン確認・残 TBD-06〜08・パッケージング・商用版）、
  **P5 の他形式抽出**（PowerPoint / PDF / Visio / テキスト系、EXT-014/015）
- 現在の改修: schema 2.4.0。振舞モデルを `model_beh` / `BEH` へ変更し、関係必須属性未入力時の仮値・`creating`（作成中）、候補採用時の生成元チャンク `based_on`、設定駆動の関係アイコンとトレースマトリクス必須属性編集を反映した。さらに、根拠Resource間の `based_on` 許可、関係種別の全選択ON/OFF、トレース開始スコープと操作名を整理した。2026-07-20 にMCPサーバ機能（MCP-001〜008。ローカルStreamable HTTPサーバ、設計情報クエリ6種、ツール設定・Status Bar表示）、MCPアクセスログ（MCP-009/010。下部パネル「MCPログ」）、設計分析機能（ANA-001〜006。推論規則DSL・影響分析・経路検索・スロット10種・過程付きレポート）を追加し、正規ゲートを完走しALL PASSを確認済み。2026-07-21 にDSL拡張（ANA-007。属性フィルタ・否定・集合演算・関係属性WHERE）、分析グラフ表示（ANA-008、analysis://）とHTMLレポート（ANA-009）、分析スロットのMCP公開とMCP向け説明のLLM自動生成（MCP-011/012）、評価用サンプルプロジェクト「温度監視装置」（EVAL-001）と評価ハーネス（EVAL-002/003。LLM変換精度・影響分析精度の自動実行とレポート出力）を追加し、正規ゲート（typecheck / lint / format / ユニット300件 / build / E2E 32件）ALL PASSを確認済み。 同日、P5-19A〜CとしてExcel `.xlsx` のOOXML物理抽出、抽出グループ候補の手動レビュー、選択範囲限定LLM支援、確定候補から既存②抽出データへの変換を追加し、schema 2.3.0へ更新した。正規ゲート（typecheck / lint / format / ユニット304件 / build / E2E 33件）ALL PASSを確認済み。 同日、P5-19D/Eとしてシート別候補UI、疎セルプレビューと編集可能な種別別オーバレイ、任意矩形LLMグルーピング、DrawingML画像・図形・コネクタ・グループの抽出と図プレビュー、同名Excel再取込差分・一意候補UID継承を追加し、schema 2.4.0へ更新した。採用候補だけを②へ変換する。正規ゲート（typecheck / lint / format / ユニット306件 / build / E2E 33件）ALL PASSを確認済み。 2026-07-22 にExcel候補操作を改善し、候補生成／確認ボタンの分離と確定後の `stage://source` 再表示、採用／不採用の2値化・全件初期採用、text優先の保守的種別判定、②生成時の全候補差分基準保存、右詳細ペインの可変高文字列表示、スクロール追従・Ctrl+矢印・範囲クランプ付きマウス選択を追加した。正規ゲート（typecheck / lint / format / ユニット306件 / build / E2E 33件）ALL PASSを確認済み。 同日、LLM支援改善（design-candidates応答からLLM再実行なしでcandidate://を再構成する「候補を開く」導線、candidate://一覧への作成時刻・ステータス列、LLMログ・ジョブ一覧への実行時刻表示。ジョブ一覧の時刻欠落はjob.updatedイベントにcreatedAt/startedAt/completedAtが含まれていなかったバックエンドの不備で、job-manager.tsを修正して解消）とHelp画面刷新（操作フロー・データスキーマ・設計モデルへSVG図解を追加、設計モデルページに「SW設計オントロジー（3次元関係空間）」のインタラクティブな関係図をオントロジー設定から動的生成）を実施した。正規ゲート（typecheck / lint / format / ユニット306件 / build / E2E 33件）ALL PASSを確認済み。

## フェーズ履歴（要点のみ）

| フェーズ                   | 内容                                                                                                                                                                                                                                                                                                                         | コミット        |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| P0〜P3                     | 骨格 / DB スキーマ 35 表 + 台帳 / ジョブ・設定・イベント / Workbench UI                                                                                                                                                                                                                                                      | 〜P3 各コミット |
| P4/P5                      | 原本取込 → Word 抽出 → ②候補 → 共通複数選択レビュー/構造プレビュー → 正本化                                                                                                                                                                                                                                                  | —               |
| P5-19A〜E                  | Excel .xlsx のOOXML物理抽出、シート別候補オーバレイレビュー、候補／任意範囲LLM支援、DrawingML図・装飾、再取込差分・UID継承、採用候補だけの②変換（schema 2.4.0、Unit 306／E2E 33）                                                                                                                                            | （本コミット）  |
| P5-19 UI・保存改善         | 生成／確認操作分離、確定後の候補再表示、採用／不採用2値、text優先分類、②生成時の全候補差分基準保存、右詳細の可変高、Ctrl+矢印・scroll追従・安全なマウス範囲選択（Unit 306／pytest 2／E2E 33）                                                                                                                                | （本コミット）  |
| LLM支援+Help刷新           | candidate://再構成導線（LLM再実行なし）・一覧の時刻/ステータス列、LLM・ジョブ一覧の時刻表示（job.updatedへcreatedAt等追加）、Help3画面へSVG図解・設計モデル概念図（オントロジー動的生成・ホバー強調）（Unit 306／E2E 33）                                                                                                    | 5140b23         |
| P6                         | LLM 基盤（4 Provider、マスキング、外部送信ブロック、preview→run 2段階）                                                                                                                                                                                                                                                      | —               |
| P7                         | プロジェクト成果物/フェーズ設定、フェーズ→成果物取込、②/③/プレビュー3ペイン統合編集                                                                                                                                                                                                                                          | —               |
| P8                         | ③→④候補生成 → 候補セットレビュー → 採用（同一 Txn・全 ROLLBACK）                                                                                                                                                                                                                                                             | —               |
| P9                         | 再帰 CTE トレース・SVG グラフ・マトリクス・整合性検査 → Problems                                                                                                                                                                                                                                                             | —               |
| P10                        | 状態遷移 / 用語集 / 表編集 / 検証編集 / PlantUML。schema 1.1.0 初適用                                                                                                                                                                                                                                                        | 81d96d1         |
| P11                        | 検索（FTS5 + MeCab トグル）※別セッションで実装・マージ                                                                                                                                                                                                                                                                       | 921a55d 等      |
| P12                        | DB to Text / SQLite dump / ZIP + manifest / 差分インポート / Git操作・履歴参照 / ストア閲覧                                                                                                                                                                                                                                  | d2bc9c6         |
| P13                        | レポート出力（②③④→文書風、フィルタ、Markdown/HTML、report:// プレビュー）                                                                                                                                                                                                                                                    | 1123e29         |
| P7 追加                    | 任意複数③マージ、2ペインResource Editor、所有判定による上書き／置換／保護派生                                                                                                                                                                                                                                                | aa9e815         |
| P3 追加                    | 文字サイズ一括変更、可変パネル、Secondaryアコーディオン、再帰分割・タブ移動                                                                                                                                                                                                                                                  | f59cadc         |
| P3 追加                    | パネル表示切替、未確定Badge、Activity並べ替え・Settings下端固定・選択表示                                                                                                                                                                                                                                                    | 9af6c6d         |
| P4/P5追加                  | 複数原本Job取込、抽出名称管理、Explorer Tooltip・強調折りたたみ                                                                                                                                                                                                                                                              | 7495617         |
| P3 追加                    | ②/③/チャンク/Resource編集の内部ペイン可変化、チャンク表スタイル統一                                                                                                                                                                                                                                                          | a5ec368         |
| P7 追加                    | ③取込編集の統合元選択・多対多based_on・個別解除・操作バー再編・全項目正本確定                                                                                                                                                                                                                                                | 1861358         |
| P3〜P8追加                 | ①〜④ステージ一覧・ソート・OS原本表示・①②アーカイブ／論理削除・文書状態集約                                                                                                                                                                                                                                                   | 585e959         |
| P3 追加                    | ステージ選択表示・一覧キーボード操作・①〜③可変境界・Workbench外周状態共通化                                                                                                                                                                                                                                                  | 6983f25         |
| P3/P7 追加                 | Explorer閲覧専用化・ステージ操作集約・③重複整理・中間3モード切替                                                                                                                                                                                                                                                             | de2566f         |
| P3 追加                    | SecondaryをProperties／Relations／Reviewへ整理、共通Selection・コメントtrace化                                                                                                                                                                                                                                               | 6514664         |
| P3/P8/P12追加              | 全画面検索・プレビュー表示切替・Relations遷移・Store全件閲覧・関係候補ルール検証                                                                                                                                                                                                                                             | 82487e1         |
| P4/P5追加                  | 原本選択経路の操作統一・抽出データ存在時の抽出実行無効化（ユニット168件／E2E 18件）                                                                                                                                                                                                                                          | 09ab962         |
| P7追加                     | 設定成果物の空③作成・未確認②取込・統合元状態修正・取込元／対応削除・階層識別                                                                                                                                                                                                                                                 | 45f2010         |
| P9追加                     | 汎用トレースマトリクス、複数Resource集合・関係種別・方向・セルの一括編集、転置／拡縮                                                                                                                                                                                                                                         | 96c29fd         |
| P9追加                     | 汎用インパクト分析、任意複数列・階層折畳・方向付きリンク・多段強調・関連項目限定表示                                                                                                                                                                                                                                         | ae81d32         |
| P9追加                     | インパクト分析の列別scroll・全列リンク・Selection連携・DnD・構成保存・複数タブ化（Unit 179／E2E 18）                                                                                                                                                                                                                         | 9a39942         |
| P9追加                     | 見出しドラッグによる列間隔調整・外側列の連動移動・構成保存（Unit 179／E2E 18）                                                                                                                                                                                                                                               | 23f4572         |
| P3/P7追加                  | 中間成果物のShift+上下範囲選択、ウェルカム設計思想・3種Help、検索導線・全ボタンTooltip                                                                                                                                                                                                                                       | 168cb54         |
| P10追加                    | セマンティック入力支援、構造化参照・正規化履歴・候補検索・辞書登録・関係検証（Unit 185／E2E 18）                                                                                                                                                                                                                             | 25e8679         |
| P10追加                    | テキスト欄の色付き通常プレビュー・Enter/F2編集ダイアログ・Secondary固定順（Unit 187／E2E 18）                                                                                                                                                                                                                                | c23a1ad         |
| P2追加                     | プロジェクト作成時の標準5フェーズ・18成果物登録、設定可能なGit初期化（Unit 189／E2E 18）                                                                                                                                                                                                                                     | 089b0ce         |
| P3追加(W1〜6)              | ショートカット上書き設定画面、Alt+Mメニュー、右クリックメニュー、Undo/Redo基盤、入力Tooltip保証、Welcome装飾のIDE調整（Unit 199／E2E 21）                                                                                                                                                                                    | 2f76e0b         |
| P3追加(W7)                 | Undo接続拡大: intermediate.restore API、③削除／アーカイブ、③レビュー状態、マトリクスセル操作（Unit 199／E2E 22）                                                                                                                                                                                                             | cea12d5         |
| P3追加(W8)                 | window.confirm 全廃、共通アプリ内確認ダイアログ confirmDialog（E2E制御可能・テーマ対応）（Unit 199／E2E 22）                                                                                                                                                                                                                 | f79542e         |
| W9〜W12                    | 戻る/進む（Alt+←→）、フォーカス系ショートカット、モーダルESC統一、動作/デバッグログPanel・日付毎ファイル・レベル設定、LLM生送受信ログ・候補再作成（schema 1.8.0、Unit 207／E2E 25）                                                                                                                                          | 26b9355         |
| P3/P12追加                 | Workbench共通10配色のユーザ設定・テーマ既定復帰、Git状態／ステージ／コミット／ローカルブランチ操作、DB to Text＋SQLite dump自動同梱（Unit 209／E2E 25）                                                                                                                                                                      | a4d9c35         |
| P3/P6追加                  | Explorerのフォルダ／Resource別アイコン・右端タグ、画面別プロンプト選択／編集／新版保存、全LLMボタンの送信前確認（Unit 214／E2E 25）                                                                                                                                                                                          | b4163cf         |
| P3/P4/P7追加               | ExplorerをプロジェクトルートのVS Code風単一Tree化、フェーズ折畳、①／③右クリック取込、③成果物Badge整理・空統合元非表示（Unit 217／E2E 25）                                                                                                                                                                                    | 65137af         |
| P3追加                     | Explorer上下／左右キー・全展開／全折畳・統合元折畳、テーマ連動既定色、IDE検索、Pipeline分析／用語集／URIアドレス、Status簡素化（Unit 220／E2E 25）                                                                                                                                                                           | 0be994c         |
| P3/P11追加                 | 上部メニューバーの旧ボタン意匠・戻る／進む／更新／ホーム・マウス履歴・可変アドレス・お気に入り、タブ移動Command、Search内グループTree・文書配下本文検索／要素ジャンプ（Unit 226／E2E 25）                                                                                                                                    | 23c5878         |
| P3/P7/P9/P11/P12追加       | メニュー固定順・Title Bar簡素化・Command Palette初期候補／追従、③構成アウトライン、分析の全件集約、FTS＋全文部分一致、History順序・作業差分・Git項目差分（Unit 227／E2E 25）                                                                                                                                                 | 6d7218d         |
| P3/P7/P11追加              | ③structure_json復元・level準拠Tree／プレビュー／一覧scroll連動、Workbench zoom・レスポンシブボタン・共通タブ移動、Search選択scroll・メニュー幅制御（Unit 232／E2E 25）                                                                                                                                                       | 077973b         |
| P3/P7追加                  | zoom縮小余白解消、共通ボタンレスポンシブ撤回、抽出／中間限定の明示アイコン、Activity Barコンパクト化、プレビュー上下キー／一覧中央scroll（Unit 231／E2E 25）                                                                                                                                                                 | 4842c57         |
| P3/P7/P10追加              | Editorタブ固定、Resource／テキスト編集のEditor統合・アドレスコピー、LLMアウトライン文脈、管理用特記事項、種別別定義、Monaco校正差分（schema 1.9.0、Unit 237／pytest 10／E2E 25）                                                                                                                                             | a58f945         |
| P7/P8/P10追加              | セマンティック非選択プレビュー／選択時直接編集・Editor統合撤回、チャンク由来based_on、図／表／コードの説明・派生Resource・画像LLM入力、表セルUI（schema 1.10.0、Unit 241／E2E 25）                                                                                                                                           | a81d431         |
| P5-17                      | Word高度抽出: リスト定義、Run書式、DrawingML/VML図形・グループ・コネクタ、Story・校閲、Part/Relationship・Raw XML・未対応レポート・安全上限（Unit 242／pytest 16／E2E 25）                                                                                                                                                   | 893e14a         |
| P5-18                      | Word抽出情報プレビュー: Run書式、リスト、図形・グループ・コネクタ、Story・フィールド、コメント・変更履歴を保存情報に基づいて表示（Unit 246／pytest 16／E2E 25）                                                                                                                                                              | 27bdb3a         |
| 保守改善                   | API型安全化（メソッドunion＋契約マップ＋同期テスト）、集計取得コアレス化、テーマ読込のgetAll集約、再読込時レイアウト復元、ABI切替自動化、STATE.md仕様移管（Unit 250／E2E 27）                                                                                                                                                | 65d9713         |
| P14-5                      | パッケージング・配布: runtime-paths同梱解決、PyInstaller spec、electron-builder（NSIS+extraResources）、prepare-dist検査、PlantUML/MeCab同梱既定化（Unit 257／E2E 27）                                                                                                                                                       | d090ba0         |
| UI点検対応                 | Editorタブ種別アイコン・ピンhover化、件数バッジ・トグル・空状態の意匠統一、Panelタブ日本語化、Status Bar整理（Unit 257／E2E 27）                                                                                                                                                                                             | 8cf4730         |
| UI点検対応(2)              | Secondary見出し日本語化（プロパティ／関係／レビュー／辞書）、Explorer③未取込成果物のバッジ整理（「未取込」タグのみ表示）（Unit 257／E2E 27）                                                                                                                                                                                 | 4b8f944         |
| P7追加                     | 中間編集の行操作を右クリックメニューへ集約（複数選択対応・単一限定操作の無効化・操作バー廃止・見出し＋追加のみ残置）（Unit 257／E2E 27）                                                                                                                                                                                     | 4704f0f         |
| P7追加                     | チャンク編集の行操作を右クリックメニューへ集約（作成／更新は複数選択対応、ヘッダは④候補生成のみ残置）、E2E右クリックのResizeHandleヒット競合を回避（Unit 257／E2E 27）                                                                                                                                                       | 4c2a036         |
| docs整理                   | 全設計文書へ実装準拠ヘッダと【未適用】【未検証】【一部適用】マークを導入。SRS 18行マーキング、ディレクトリ構成の実態反映、スキーマ版数履歴の追加（Unit 257／E2E 27）                                                                                                                                                         | bafd9ee         |
| P3/P9追加                  | ②③ステージ右クリック編集、チャンク分析スコープ、空タブ・アドレスHelp／全UID一覧（Unit 260／pytest 16／E2E 27）                                                                                                                                                                                                               | 2dd6040         |
| P3/P9追加                  | インパクトSVG端点補正、Alt+G／F5、アクティブGroup表示、Status Bar実行環境状態（Unit 262／pytest 16／E2E 27）                                                                                                                                                                                                                 | afcb054         |
| P3追加                     | Status Barアイコン／設定遷移、Alt+D、Ctrl+1〜9 Group選択、Title Bar版数表示（Unit 264／pytest 16／E2E 27）                                                                                                                                                                                                                   | —               |
| P8オントロジー再設計       | schema 2.0.0。②③Resourceを9種へ整理し、④を13個のmodel_*へ分離。オントロジー定義・関係許容マトリクス・版管理、個別モデルEditor、Settings管理、動的Helpを追加                                                                                                                                                                  | —               |
| P8候補・モデルUI改善       | schema 2.1.0。候補編集保持／一時保存、分類別一時ID、④一覧の選択・明示編集・関係登録、独立した設計モデル設定とGUI属性編集を追加（Unit 270／E2E 28）                                                                                                                                                                           | —               |
| P8/P9関係チューニング      | schema 2.2.0。`model_beh`、関係の作成中状態、候補→チャンクのbased_on、関係アイコン設定、設定駆動マトリクス必須属性編集を追加（Unit 272／E2E 28）                                                                                                                                                                             | —               |
| P9トレース編集改善         | 根拠Resource間のbased_on許可（model同士のみ禁止）、関係種別の全選択ON/OFF、操作名短縮、Activity Barの全設計モデル初期化、分析の4リスト初期化（Unit 274／E2E 28）                                                                                                                                                             | —               |
| MCPサーバ機能              | MCP-001〜008。ローカルMCPサーバ（Streamable HTTP・127.0.0.1・依存追加なし）、設計要素一覧／種別情報／検索（スコア上位・AND/OR・既定20件）／詳細（複数UID）／上流・下流トレースの6ツール、ツール設定「MCPサーバ設定」、Status Bar起動状態（Unit 283／E2E 29）                                                                 | 984e8f6         |
| MCPログ＋設計分析          | MCP-009/010: アクセスログ（メモリ500件＋logs/mcp/JSONL、Panel「MCPログ」）。ANA-001〜006: 推論規則DSL（FROM/TRAVERSE/FILTER/PATH）、影響分析・経路検索の決定論的実行、設計モデル設定のクエリ規則10スロット、Trace分析サイドバー、過程付きMarkdownレポート（Unit 291／E2E 31）                                                | 5a90f9e         |
| DSL拡張＋MCP公開＋評価基盤 | ANA-007: FILTER [NOT] TYPE/STATUS/ATTR・SET集合演算・WHERE関係属性。ANA-008/009: analysis://グラフ・HTMLレポート。MCP-011/012: analysis_slot_Nツール動的公開・MCP説明LLM生成。EVAL-001〜003: サンプル「温度監視装置」（正解モデル43件・関係57件・変更3ケース）投入、評価①②の自動実行・指標算出・レポート（Unit 300／E2E 32） | 379da61         |

## 恒久制約（違反するとビルド/実行が壊れる、または設計方針違反）

実装で確定した **UI・操作仕様** は `docs/sdd_ui_design.md`「付録A」へ移管した（2026-07-19）。
UI仕様を変更・追加した場合は付録Aを更新し、本節にはビルド・データ整合性・セキュリティ系の
制約だけを残す。

- **package.json に `"type": "module"` を入れない**。sandbox 化された preload は CommonJS 必須。
- **better-sqlite3 の ABI 切替は `scripts/ensure-abi.mjs` が自動管理**。`npm test`（pretest）が
  Node ABI、`npm run build`（prebuild）と `npm run test:e2e` が Electron ABI へ必要時だけ切替える
  （マーカー `node_modules/.d2d-abi.json` で判定、一致時はスキップ）。`npm run rebuild:electron` は
  強制再ビルド。`postinstall` が rebuild:electron を実行する（npm install 直後は Electron ABI）。
  `npx playwright test` を直接叩く場合だけ事前に `node scripts/ensure-abi.mjs electron` が必要。
- **同梱リソースの解決は `backend/runtime-paths.ts` を経由する**（P14-5）。Main が
  `D2D_PACKAGED` / `D2D_RESOURCES_PATH` を Backend へ渡し、パッケージ済みは `resources/`、
  開発時はリポジトリ直下の同一レイアウト（`third_party/`、`workers/python/dist/`）を参照する。
  設定（plantuml.jarPath/javaPath/dotPath、search.mecabPath/dictionaryPath）が同梱より優先。
  ワーカー・PlantUML・MeCab のパスをサービス内へ直書きしない。配置規約は `third_party/README.md`、
  配布は `npm run package:worker` → `npm run dist`（検査は `scripts/prepare-dist.mjs`）。
- **Renderer の Backend API 呼び出しは `src/types/api-methods.ts` の union で制約する**。
  backend/api へメソッドを追加・削除したら API_METHODS も更新する
  （`backend/api/api-methods-sync.test.ts` が register 一覧との同期を検証）。
  params／result の型契約は `src/types/api-contract.ts` へ漸進的に追加する。
- Backend イベント起点のパイプライン集計は `project-store.requestStatsRefresh()`（300ms集約）を
  使い、イベントハンドラから `refreshStats()` を直接連打しない。
- **④設計モデルは `model_*` を正本とする**。②③は9種類の `resource_*`、④は13個の初期 `model_*` を使用し、`entity_registry.design_category` は設けない。モデル・関係の定義、有効状態、追加、許容組合せはオントロジー設定テーブルを正とする。1.xプロジェクトは移行せず再作成する。
- **候補と正本の区別は entity_registry.status**（draft=候補 / approved=正本）。
- **関係必須属性が未入力の候補採用・手動登録は仮値 + `trace_link.review_status='creating'`（作成中）で保存する**。DB保存層の必須属性検査は維持し、UI/API境界でだけ仮値を補う。候補採用では各設計モデルから候補生成を要求したチャンクへ `based_on` を必ず付与する。
- **LLM候補の編集状態は二層で保持する**。タブ間移動中はRendererメモリに保持し、タブを閉じるかF5で破棄する。明示的な一時保存は llm_candidate_draft にLLM実行ごと1件だけ保持し、タブ再表示時は原本を初期表示して「一時保存を再開」で復元する。採用時はDBの現在採番から正式code／uidを割り当て、一時IDを正本へ保存しない。
- **セマンティック入力は表示文章と構造化参照を分離する**。`semantic_text` に外部原文・表示文章・入力欄ポリシー、`semantic_reference` に文字範囲・参照UID・表示方法・関係種別・承認状態、`semantic_normalization_history` に差分・承認・取消履歴を保持する。自動認識は弱い `relates_to` の候補に限定し、承認済み参照だけを関係ルール検証後に `trace_link` へ確定する。辞書候補はスコープ・版・廃止・権限を考慮し、辞書登録は承認待ちで作成する。通常時のtext／multiline欄は非選択時に専用背景のプレビュー、選択時に直接編集欄を表示し、`F2`または編集ボタンで全編集機能を集約したモーダルダイアログを開く。セマンティック編集はEditor Areaへ統合しない。
- **抽出由来・共有正本は破壊しない**: 編集・マージ・分割・表編集は新リソース + `based_on` trace_link
  （transform_note = edit / merge / split / edit-table）で由来を残し、旧リソースを保護する。
- **Main は Gateway/Shell のみ**。業務ロジックは backend/（utilityProcess）に置く。
  safeStorage は Main 専用 → backend からは main-bridge（逆方向 RPC）経由。
- **API キー等の秘密情報は平文で保存・ログ出力しない**（settings-service が強制）。
- スキーマ変更は `backend/db/migrations.ts` に追記（バックアップ → DDL → 版数更新）。現在 2.4.0（2.2.0の13個の `model_*`、`model_beh`、関係の作成中状態・設定駆動アイコン、LLM候補一時保存、`excel_extraction_draft`、Excel再取込差分列を追加。2.2以前からの後方互換なし、旧PJは再作成）。
- ②抽出レビューの選択・状態更新・構造プレビュー・Properties は `ReviewElement` 共通契約で実装し、
  Word 固有にしない。今後の Excel / PowerPoint / PDF / Visio / テキスト系も同じ操作体系へ接続する。
- **Excel抽出は候補確定まで②正本と分離する**。`extract.excel` はマクロを実行せずOOXMLを直接読み、物理モデルとルール候補を `excel_extraction_draft` に保持する。既存候補LLMへ送るのは選択候補と周辺2セル、任意範囲LLMへ送るのはユーザー指定矩形内だけとし、Backendでも範囲外提案を拒否する。DrawingML画像・図形・コネクタ・グループはPart／Relationship／未解決状態を保持する。同名Excel再取込は一意な一致・移動だけに候補UID・採否・表見出し設定を継承し、曖昧一致は自動継承しない。確定時は明示的に採用した候補だけを `storeExtractionResult` 経由で既存②へ変換する。
- Word高度抽出の正本は `extracted_document.structure_json` 全体と `blobs/extracted/job-*/raw_xml/`。`storeExtractionResult` は `metadata`／`elements` だけを再構成せず、ワーカーのトップレベル（statistics、stories、comments、revisions、package、unsupported_elements、review_hints）を保持した上で `elements[].resource_uid` だけを付加する。
- Word文書プレビューは `structure_json.elements` だけでなく `stories`／`comments`／`revisions` を参照する。Run直接書式は保存値をCSSへ投影し、図形は図形情報カードで確認可能にするが、Wordレイアウトエンジン依存の物理ページ割付・折返し・完全な図形座標は推測再現しない。
- Python ワーカーは stdin/stdout とも UTF-8 ラップ必須（CP932 化け）。pytest はシステム Python
  （miniconda）で実行（PATH 先頭の venv に pip が無い）。
- 抽出文書の初期 `entity_registry.title` は原本の `source_document.file_name` と同一にする。後の名称変更は抽出文書の `entity_registry.title` だけを更新し、原本名・blob・traceは変更しない。
- ①原本・②抽出・③中間の通常削除は `status='deleted'` の論理削除、Explorerだけからの一時非表示は `is_archived=1` とする。アーカイブはステージ一覧に残して復元可能とし、schema 1.5.0で `entity_registry.is_archived` と索引を追加した。同じ `dev_phase_id`／`artifact_type_id` の③が複数ある場合は、現在表示中の1件を優先し、表示中が複数なら最新1件以外を自動アーカイブする。復元時は同一成果物の他文書をアーカイブしてExplorer表示を最大1件に保つ。
- 関係性候補の選択肢は 有効な `ontology_relation_definition` と `ontology_relation_allowance.allowed=1` の起点／終点 `model_*`から導出する。LLMが許容外の関係性を返した場合は元値を保持して警告表示し、許容関係へ修正するまで採用不可とする。
- ユーザ操作の取り消しは `undo-service`（`pushUndo({label, undo, redo})`、Ctrl+Z/Ctrl+Y、最大100件）。DB正本の変更は Backend の逆操作API（`document.restore`／`extracted.restore`／`intermediate.restore`）を undo に指定して登録する。`intermediate.restore` は復元時に同一成果物の他文書をアーカイブし Explorer 表示≤1件の排他規則を維持する。プロジェクト切替・クローズで履歴は破棄する。undo 実行失敗時はエントリを破棄する（二重取消防止）。
- マトリクス編集の Undo は「正確に逆転できる操作」だけ登録する: toggle は自己逆操作として常に、add/delete は `unchanged === 0` のときのみ（既存関係を巻き込むと逆操作が正本を壊すため）。
- デバッグログはプロジェクトの `logs/debug/<frontend|backend>-YYYY-MM-DD.log`（日付毎・ローカル日付）。レベルはプロジェクト設定 `logging.debugLevel`（error<warn<info<debug、既定 info）。Backend API の失敗は `router.onDispatchError` 経由で backend ログへ自動記録する（log.* 自身は除外）。プロジェクト未オープン時はファイル出力しない。
- Status BarのGit同期状態はネットワーク通信を行わず、ローカルupstream参照に対するahead／behindを表示する。PlantUML／MeCabの有効状態は、設定優先・同梱fallbackで解決した実体パスの存在により判定する。PlantUML／MeCab／LLM Providerはツール設定、外部LLM／Debugレベルはプロジェクト設定へ遷移する。
- `Ctrl+1`〜`Ctrl+9`は分割ツリーの画面順Editor Group選択に予約し、作業モードCommandは既定キーを持たない。D2D表示版数は`d2d.config.json.appVersion`、schema版数は開いているproject.dbの`project.schema_version`を正とする。
- インパクト分析のリンク座標はDOMのCSS pixel値を用いるため、SVG viewBoxをcanvasの実寸へ同期する。既定のSVG内部座標へ戻すと下方ほど端点がずれる。
- LLM 実行は生送受信ログ（マスキング後・APIキーなし。Gemini はURLキーもマスク）を blobs/llm/ へ保存し、`llm_run_ref.raw_request_blob_uid`／`raw_response_blob_uid` から参照する。`llm.retryRun` は `process_name='design-candidates'` かつ input_ref_uid のある実行だけ同一チャンクで候補生成ジョブを再登録する。
- prettier は docs/ と tasks/ を対象外（.prettierignore）。
- **docs/ の設計文書は実装準拠で維持する**（2026-07-20 整理済み）。各文書の冒頭に実装準拠状態の注記があり、
  未実装の記述は【未適用】、未確認・未実測は【未検証】、部分実装は【一部適用】を付す。実装で仕様を変えたら
  該当文書のマークと本文を同時に更新する。スキーマの正本は `backend/db/schema/initial-schema.ts` と `backend/db/migrations.ts`（sdd_data_structure に
  版数履歴あり）、UI確定仕様の正本は sdd_ui_design 付録A。
- LLM 外部送信はプロジェクト設定 `llm.externalSendAllowed`（既定 false）でブロックされる。
- **MCPサーバは読み取り専用・127.0.0.1バインドのみ**（MCP-001）。プロトコルは自前実装のStreamable HTTP（JSON-RPC 2.0、POST /mcp のみ。SSEストリーム・認証なし）で、外部SDK依存を追加しない。設定はツール全体設定 `mcp.enabled`（既定false）／`mcp.port`（既定39400）、状態変更は `mcp.applySettings` API経由でサーバ起動／停止と同時に行う。ツール実行はcurrentProject()由来のDBを都度参照し、プロジェクト未オープン時は `isError` のツール結果を返す（プロトコルエラーにしない）。MCP検索はMeCabを使わないUnicode検索固定（クエリ毎のmecab spawn回避）。アクセスログ（MCP-009）はJSON-RPCリクエスト単位でメモリリング500件＋プロジェクトの `logs/mcp/access-YYYY-MM-DD.jsonl` へ記録し、引数は200文字要約のみ・応答本文は記録しない。
- **設計分析（ANA-001〜006）は読み取り専用・決定論的**。クエリ規則DSLは行ベース（`FROM TYPE` / `TRAVERSE 関係 UP|DOWN|BOTH DEPTH n` / `FILTER TYPE|STATUS` / `PATH 関係 MAXDEPTH n LIMIT m`、`#`コメント）で、保存・実行前に構文とオントロジー関係定義の照合を行う。スロット10種の正本はプロジェクト設定 `analysis.querySlots`（スキーマ変更なし）で、未設定プロジェクトは既定2件（影響範囲下流3段・経路検索）を返す。PATHは起点・終点必須、FROMなしTRAVERSEは起点必須。実行上限は集合2000要素・深さ10・経路200件で、超過は truncated を立てて打ち切る。レポートは `exports/reports/analysis_*.md|html` へ保存し既存の report:// プレビュー・Reports一覧へ相乗りする。DSL拡張（ANA-007）: `FILTER [NOT] TYPE|STATUS|ATTR k=v|k~v`（ATTRはtitle/code/status/summary＋model detailキー）、`SET SAVE|LOAD|UNION|INTERSECT|EXCEPT 名前`（未SAVE参照は静的エラー）、TRAVERSE/PATH の `WHERE 関係属性条件`（対象8属性はEDGE_ATTR_KEYS）。分析結果はレポートと同名の .json（reportFileName付き）を併存保存し、`analysis://<json>` グラフエディタが analysis.getResult で読む。
- **分析スロットのMCP公開（MCP-011/012）**: DSL定義済みスロットは `analysis_slot_<n>` としてMCP tools/list へ動的公開する（説明は slot.mcpDescription 優先、無ければ名称+DSL要約。起点/終点の要否は parseAnalysisDsl から導出）。説明文はLLM操作 `analysis-mcp-description`（llm.prepareRequest/runConfirmed、送信前確認あり）で自動生成できる。
- **評価基盤（EVAL-001〜003）は既存プロジェクトへのシード方式**。`eval.seedSample` が docx原本（backend/eval/sample-docx.ts のTS製OOXML）→②（ワーカー不要で構造JSON直接保存）→③→チャンク7件→正解④モデル43件・関係（approved）を投入し、チャンク↔セクション対応を `eval.sampleChunkSections`、要素キー↔UIDを `eval.sampleElementUids`（プロジェクト設定）へ保存する。期待値の正本は backend/eval/sample-design.ts（変更3ケースの期待影響集合は関係定義と整合するよう手計算済みで、評価②はF1=1.0になることをユニットテストが保証）。評価①は runConversionEval に CandidateGenerator を注入する構造（本番=runLlm、テスト=決定論スタブ）。タイトル照合は NFKC正規化後の完全一致または包含。
- 新規プロジェクトは標準5フェーズ・18成果物を登録する。同名成果物（レビュー記録／障害台帳）はフェーズ単位で独立して保持する。ツール全体設定 `project.initializeGitOnCreate` は既定trueで、作成時にbest-effortで `git init` を実行し、失敗してもプロジェクト作成は継続する。schema 1.7.0では成果物名の一意性を `(project_uid, dev_phase_id, artifact_name)` とし、移行時も成果物関係を保持する。
- Settings はツール全体設定（`settings://tool`）とプロジェクト設定（`project-settings://current`）を分離する。
  成果物・開発フェーズ・LLM外部送信可否は後者で管理する。
- ③中間データの統合元正本は文書間 `based_on`。`structure_json.sources` は表示順、
  `source_extracted_document_uid` は旧データ互換用で新規データでは NULL とする。
- 成果物は `project_artifact_setting.dev_phase_id` で開発フェーズ配下に所属する。schema 1.2.0で追加。
  成果物・フェーズの「削除」は関連③中間データを含む物理削除であり、確認後も復旧不能。
- 統合元対応の正本は `intermediate_item.uid → extracted_item.uid` のアイテム単位 `based_on`。多対多とし、紐付済み統合元も選択・別成果物行への再利用を許可する。取込編集の状態列は `extracted_item.resource_uid` 側の抽出レビュー状態を表示する。「削除」は選択した extracted_item を終点とする当該中間文書配下のアイテムリンクだけを削除し、成果物行・Resource・抽出データ・文書単位リンクは保持する。`structure_json.elements[].intermediate_item_uid` を持つ新形式データは明示解除後に互換補完を再実行しない。編集・マージ・分割後も元 extracted_item へのリンクを維持する。
- ③成果物の状態サイクルは `draft → approved → review → rejected → draft`。成果物ペインの上下矢印はデータ順を変更せず、選択行の前後移動とフォーカス追従に割り当てる。
- チャンクは成果物単位で管理し、確認済み intermediate_item と多対多で対応する。対応正本は chunk → intermediate_item のアイテム単位 based_on。チャンク固有の追加プロンプトは chunk.additional_prompt に保持し、LLM候補生成時に本文へ追加する。
- 中間要素の追加・複製は新Resourceを作成する。複製は元Resourceへ `transform_note=duplicate` の `based_on` を保持し、②由来のアイテム単位トレースも引き継ぐ。基本種別編集は paragraph／heading／list_item／caption を対象とする。
- Resource編集は②③で使用する9種を定義駆動で共通化し、`resource://<uid>` からも開ける。保存直前にDBで所有・参照状況を判定する。③で新規作成され現在の `intermediate_item` だけが参照するResourceは、同種なら同じUIDへ上書きし、異種なら現在要素を新Resourceへ差し替えて旧Resourceを物理削除する。抽出由来、共有、入力トレース、他Resource、LLM実行記録から参照されるResourceは保護し、新Resource + 元Resourceへの `based_on (edit-resource)` とする。
- 中間要素の一覧マージはCtrl/Shiftの非連続を含む2件以上を文書表示順で処理し、先頭位置・階層へ集約する。同一Resource種別は同種の候補へ、異種は可読な `resource_text` へ変換し、全元Resourceへの `based_on (merge)` と全 `extracted_item` 由来を維持する。
- Resource EditorのLLM入力には中間文書の親子関係・アウトライン位置と入出力フィールド定義を自動付加する。`entity_registry.administrative_notes` は管理専用で、設計情報・Markdown・LLM設計候補へ送らない。schema 2.0.0で廃止したResource 5種と列は物理保持せず、編集定義・新規保存・LLM入出力からも除外する。
- リストResourceの`items_json`は物理列名を互換維持しつつMarkdownリストを保持する。旧JSON配列も読取互換とする。図は抽出時に幅・高さ・バイトサイズ・画像形式を保持して画像と説明を表示し、数式はTeX（MathJax）本文と説明を扱う。図／表／数式／コードからの派生Resourceは新規追加または既存参照し、関係を`trace_link`へ保存する。図／表／数式／コードの説明は対象値・アウトライン文脈をLLMへ渡し、図では画像もProvider別形式で添付する。表はスプレッドシートUIで各セルをセマンティック編集し、`resource_table_cell`を同期して同じ座標のUIDを維持する。
- マトリクス編集の正本は`trace_link`とし、行→列／列→行の方向を保持する。単一セルのトグルと、複数セル・行・列への追加／削除は同じBackend操作APIを通し、複数対象は1トランザクションで検証・更新する。
- マトリクスからの関係削除は`trace_link.status='deleted'`の論理削除とし、追加時は`ontology_relation_definition` / `ontology_relation_allowance` の起点／終点 `model_*` 規則を検証する。表示は複数関係種別を同時に色・記号で識別し、転置は表示軸だけを交換して保存済みfrom/toを変更しない。

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
- 右クリックE2Eの注意: 行のbounding box中央がWorkbench境界のResizeHandleと重なると、
  mousedown/upはセルへ届いても**contextmenuイベントだけがハンドル側をターゲットにする**ことがあり、
  メニューが開かない。行全体ではなくセル（`row.locator('td').nth(1)`等）を右クリックする。
- 中間編集の統合元・成果物の行操作（追加・削除・複製・統合・移動・階層）は上部ボタンではなく
  行の右クリックメニュー（`ctx-source-*`／`ctx-element-*`／`ctx-merge-*`／`ctx-move-*`／`ctx-hierarchy-*`）
  から実行する。E2E は `row.click({ button: 'right' })` → メニュー testid クリックのパターンを使う。
- チャンク編集を開き直した場合、チャンク選択は復元しない。候補生成など選択必須操作のE2Eは、対象チャンク行を明示選択してから実行する。
- トレースマトリクスE2Eは、開始時に既存Editorタブを全て閉じる。複数タブ動作を確認した後は1タブを閉じ、タブ折返しによる縦方向の表示領域減少でマトリクスセルが画面外になることを防ぐ。
- マトリクス先頭セルはsticky見出しと重なり、Playwrightの通常クリックが見出しに遮られることがある。
  セル操作は対象セルへclickイベントを直接dispatchし、Ctrl+Z等のWorkbenchショートカット前はEditor領域へフォーカスを戻す。
- MCPサーバのHTTPテストは、サーバ再起動をまたぐとNode fetch（undici）がkeep-alive済み接続を再利用してECONNRESETになる。ユニットテストはテスト毎に別ポートを使い、E2Eはテスト冒頭で `mcp.applySettings {enabled:false}` を実行して前回実行の永続設定（userDataのsettings.json）による起動状態を初期化する。
- **E2Eで1件失敗するとPlaywrightがworkerを再起動し、新workerのbeforeAllはアプリを再起動するがプロジェクトは開かれないため、後続テストが「プロジェクト未選択」で連鎖失敗する**。連続大量失敗を見たら、まず各runの「最初の1件」だけを原因として調べること（Backendクラッシュと誤認しない。electron.launchのprocess stdout/stderr捕捉で切り分けできる）。
- オントロジー設定E2E（P8オントロジー再設計）が `allocated_to` を無効化したままにするため、後続テストで allocated_to 関係を作成する場合は事前に `ontology.saveRelation` で再有効化する（評価E2Eが実施例）。
- コマンドパレットは fill 直後の Enter が候補確定前に空振りすることがある。`.wb-palette-item.selected` の文言を待ってから Enter する。
- PipelineStageEditor の mutate は Undo登録（pushUndo）を一覧・集計再取得の前に行う。再取得後に登録すると、E2EのCtrl+Zが登録前に届いて別エントリ（用語状態変更等）を取り消すflakyになる。
- ヘルプの「ヘルプ: 操作フロー」等のコマンドパレット表示ラベルは builtin-commands.ts の title と完全一致させる（例: 「操作の流れ」ではなく「操作フロー」）。表記ゆれで palette 検索がヒットしない。
- Backend が Renderer 側 store（jobs-store 等）へ渡す `*.updated` イベントは、フロントエンドがそのイベントペイロードだけで状態をマージする設計（`job.list` 等の再取得は行わない）ため、表示に必要なフィールドは全てイベントペイロードに含める。新しい列を追加する際は「フィールドがDBに存在する」だけでなく「イベントペイロードに含まれているか」を必ず確認する（job.updated に createdAt 等が漏れていた実例あり）。

## 残課題（正直リスト）

- Git UIのremote操作（fetch／pull／push）、merge／rebase、競合解消は未対応。現時点の基本操作はローカルRepository内に限定する。

- P14 残り（性能 NFR-001〜005 実測 P14-1、オフライン確認 P14-2、ログ・障害解析 P14-3、
  TBD-06〜08・ライセンス確定 P14-4、pymupdf 商用版 P14-6）
- P14-5 の残作業: 仕組み（electron-builder / PyInstaller spec / prepare-dist / runtime-paths）は実装済み。
  未実施は (1) PyInstaller 導入と d2d-worker.exe の実ビルド（PATH 先頭の Python に pip が無く未導入）、
  (2) third_party への実バイナリ配置（PlantUML jar・JRE・Graphviz・MeCab+UniDic）と同梱動作の実機確認、
  (3) NSIS インストーラの実生成（--dir の win-unpacked までは確認済み）、(4) アプリアイコン・コード署名、
  (5) asar 内 node_modules のサイズ最適化（tsx/tsup 等の間接依存が unpacked に入る）。
- P5 他形式抽出: PowerPoint / PDF / Visio / テキスト系（P5-8〜14）
- Word高度抽出の残り: SmartArt、チャート、OLE、OMML、複雑なコンテンツコントロールの意味モデル化、スタイル／テーマ継承後の有効書式、コメント返信・解決状態、改訂の変更前後ビュー、コネクタnative ID→抽出UID解決、全図形属性・グループ座標変換、ZIP圧縮率・OSレベル時間／メモリ制限・マルウェアスキャン。現時点ではPart inventory、Raw XML、未対応要素レポートで保持・可視化する。
- Undo/Redo（NFR-012）接続済み: ②レビュー状態・②名称変更・①②③アーカイブ・①②③論理削除（restore API）・
  ③レビュー状態・マトリクスセル操作（toggle常時、add/deleteは完全逆転時のみ）・用語状態変更。
  未接続: ③要素の追加・編集・複製・削除・マージ・分割（新Resource作成／structure_json位置の復元が必要）、
  ③表示順・階層変更（端でのクランプにより逆操作が不正確になり得るため見送り）、チャンク操作、
  取込元の更新（updateSources）、セマンティック参照の承認・取消、設定変更。
- コンテキストメニューはEditorタブ・Explorer行・Jobs一覧・②抽出／③中間ステージ一覧行へ接続済み。マトリクスセル等は未接続（共通 `showContextMenu` へ追加するだけ）。
- ツールチップの「説明＋例」の明示 `title` はSettings／Glossary等の代表画面のみ。他画面は自動補完文（label由来）が表示される。
- LLMログからの候補再作成（LLM再実行）は design-candidates（④候補生成）のみ。intermediate.textCandidate 等の他処理種別・
  プロンプト編集付き再実行は未対応。**LLM再実行を伴わない再構成**（保存済み応答から candidate:// を開き直すだけ）は
  LLMログ一覧・詳細の双方から「候補を開く／候補セットを開く」ボタンで design-candidates 応答なら常に可能（design.getCandidateSet が
  result_blob_uid から都度再パースするため、LLM実行不要）。トースト自動消去は info（5秒）を E2E で検証済み、error（15秒）は時間都合で未検証（実装は notify の setTimeout で共通）。
- 動作ログはRendererメモリのみで再起動後は消える（永続側はデバッグログファイルが担う）。デバッグログの
  ローテーション（古い日付ファイルの自動削除）は未実装。
- resource_table_cell の entity_registry CHECK 制約追加（テーブル再構築が必要 → 将来 2.0.0）
- アーカイブ差分の左右テキストは Backend プロセス内保持（再起動後は差分インポート再実行）
- Word 抽出の LLM 補助（EXT の一部）、GC 系 Golden Case の拡充
- 編集画面内部のペイン比率はEditorを開いている間だけ保持し、閉じる／再起動後の復元は未実装。
- Resource EditorのJSONカラムは構造化テキスト編集。表セルは既存のセルグリッド編集も併用し、図の画像実体差替えは画像URI編集として扱う。
- UI点検（2026-07-19）の未対応項目: Activity名の英語表記（Explorer等、付録A仕様のため据置。Secondary見出しは日本語化済み）、
  Editorタブのタイトル命名規則（Job/Git差分等のID露出）、タブ多段折返し時の整理（グループ化・スクロール化）、
  Secondaryの辞書検索入力の意匠統一、Explorer情報行（「編集する場合は…」）の配置見直し。
- 同種の複雑Resource（表、図、モデル等）の通常マージは、JSON配列は連結、JSONオブジェクトはキー統合、競合するenum/数値等は先頭値を採用して警告する。意味的な再構成が必要な場合はLLMマージまたは右フォームでの手動修正が必要。
- MCPサーバの残り（将来実装）: プロジェクトフォルダだけで動く独立MCPサーバ化、SSEストリーム（サーバ通知）・セッション管理・認証、MCP検索のMeCabトークナイズ対応、アクセスログのローテーション。
- 設計分析・評価の残り: 分析グラフのノードクリックによる要素ジャンプ・レイアウト調整（現状は種別列の固定配置）、DSLのさらなる拡張（要素属性の数値比較・正規表現、経路上の要素種別制約）、評価①の文脈戦略切替（前後チャンク文脈・用語集/既存モデル添付の取捨選択をパラメータ化した比較実行）、評価履歴の時系列比較（現状は都度レポートのみ）、評価①のE2E（実LLM必要のためユニットのスタブ検証のみ。E2Eは評価②のみ）。
