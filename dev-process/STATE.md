# D2D 開発状況・申し送り（STATE）

新しいセッション / 別の LLM で作業を始めるときは、まずこのファイルを読むこと。
フェーズ完了ごとに `dev-process/PROCESS.md` ステップ 7 に従って更新する。

## 現在地

- 完了: P0〜P13（クリティカルパス完走、MS6 相当まで）
- 残り: **P14**（性能・オフライン確認・残 TBD-06〜08・パッケージング・商用版）、
  **P5 の他形式抽出**（Excel / PowerPoint / PDF / Visio / テキスト系、EXT-014/015）
- テスト規模: ユニット 169 件 / pytest 10 件 / E2E 18 件（すべて成功の状態で引き渡し）

## フェーズ履歴（要点のみ）

| フェーズ      | 内容                                                                                | コミット        |
| ------------- | ----------------------------------------------------------------------------------- | --------------- |
| P0〜P3        | 骨格 / DB スキーマ 35 表 + 台帳 / ジョブ・設定・イベント / Workbench UI             | 〜P3 各コミット |
| P4/P5         | 原本取込 → Word 抽出 → ②候補 → 共通複数選択レビュー/構造プレビュー → 正本化         | —               |
| P6            | LLM 基盤（4 Provider、マスキング、外部送信ブロック、preview→run 2段階）             | —               |
| P7            | プロジェクト成果物/フェーズ設定、フェーズ→成果物取込、②/③/プレビュー3ペイン統合編集 | —               |
| P8            | ③→④候補生成 → 候補セットレビュー → 採用（同一 Txn・全 ROLLBACK）                    | —               |
| P9            | 再帰 CTE トレース・SVG グラフ・マトリクス・整合性検査 → Problems                    | —               |
| P10           | 状態遷移 / 用語集 / 表編集 / 検証編集 / PlantUML。schema 1.1.0 初適用               | 81d96d1         |
| P11           | 検索（FTS5 + MeCab トグル）※別セッションで実装・マージ                              | 921a55d 等      |
| P12           | DB to Text / SQLite dump / ZIP + manifest / 差分インポート / Git 参照 / ストア閲覧  | d2bc9c6         |
| P13           | レポート出力（②③④→文書風、フィルタ、Markdown/HTML、report:// プレビュー）           | 1123e29         |
| P7 追加       | 任意複数③マージ、2ペインResource Editor、所有判定による上書き／置換／保護派生       | aa9e815         |
| P3 追加       | 文字サイズ一括変更、可変パネル、Secondaryアコーディオン、再帰分割・タブ移動         | f59cadc         |
| P3 追加       | パネル表示切替、未確定Badge、Activity並べ替え・Settings下端固定・選択表示           | 9af6c6d         |
| P4/P5追加     | 複数原本Job取込、抽出名称管理、Explorer Tooltip・強調折りたたみ                     | 7495617         |
| P3 追加       | ②/③/チャンク/Resource編集の内部ペイン可変化、チャンク表スタイル統一                 | a5ec368         |
| P7 追加       | ③取込編集の統合元選択・多対多based_on・個別解除・操作バー再編・全項目正本確定       | 1861358         |
| P3〜P8追加    | ①〜④ステージ一覧・ソート・OS原本表示・①②アーカイブ／論理削除・文書状態集約          | 585e959         |
| P3 追加       | ステージ選択表示・一覧キーボード操作・①〜③可変境界・Workbench外周状態共通化         | 6983f25         |
| P3/P7 追加    | Explorer閲覧専用化・ステージ操作集約・③重複整理・中間3モード切替                    | de2566f         |
| P3 追加       | SecondaryをProperties／Relations／Reviewへ整理、共通Selection・コメントtrace化      | 6514664         |
| P3/P8/P12追加 | 全画面検索・プレビュー表示切替・Relations遷移・Store全件閲覧・関係候補ルール検証    | 本コミット      |
| P4/P5追加     | 原本選択経路の操作統一・抽出データ存在時の抽出実行無効化（ユニット168件／E2E 18件） | 09ab962         |
| P7追加        | 設定成果物の空③作成・未確認②取込・統合元状態修正・取込元／対応削除・階層識別        | 本コミット      |

## 恒久制約（違反するとビルド/実行が壊れる、または設計方針違反）

- **package.json に `"type": "module"` を入れない**。sandbox 化された preload は CommonJS 必須。
- **better-sqlite3 の ABI 切替**: vitest 前に `npm rebuild better-sqlite3`、build/E2E 前に
  `npm run rebuild:electron`。※P11 マージ以降 `rebuild:node` スクリプトは無く、
  `postinstall` が rebuild:electron を実行する（npm install 直後は Electron ABI）。
- **候補と正本の区別は entity_registry.status**（draft=候補 / approved=正本）。
- **抽出由来・共有正本は破壊しない**: 編集・マージ・分割・表編集は新リソース + `based_on` trace_link
  （transform_note = edit / merge / split / edit-table）で由来を残し、旧リソースを保護する。
- **Main は Gateway/Shell のみ**。業務ロジックは backend/（utilityProcess）に置く。
  safeStorage は Main 専用 → backend からは main-bridge（逆方向 RPC）経由。
- **API キー等の秘密情報は平文で保存・ログ出力しない**（settings-service が強制）。
- スキーマ変更は `backend/db/migrations.ts` に追記（バックアップ → DDL → 版数更新）。現在 1.5.0。
- ②抽出レビューの選択・状態更新・構造プレビュー・Properties は `ReviewElement` 共通契約で実装し、
  Word 固有にしない。今後の Excel / PowerPoint / PDF / Visio / テキスト系も同じ操作体系へ接続する。
- Python ワーカーは stdin/stdout とも UTF-8 ラップ必須（CP932 化け）。pytest はシステム Python
  （miniconda）で実行（PATH 先頭の venv に pip が無い）。
- Workbench の文字サイズはツール全体設定 `theme.fontSize`（10〜20px、既定13px）で管理し、通常UIとMonacoへ即時反映する。
- Primary／Secondary／下段パネルの表示・寸法とSecondaryアコーディオン開閉はWorkbench外周状態として1組だけ保持し、作業モード／①〜④ステージを切り替えても変更しない。再帰的なEditor分割木・分割比・タブ配置はプロジェクト単位（未選択時はglobal）でlocalStorageへ保持する。各境界はポインタと矢印キーで変更でき、領域内の表示超過は必要時だけ縦横スクロールする。
- SecondaryはWorkbench全体で共通のProperties／Relations／Reviewだけを独立開閉できる縦アコーディオンとする。Propertiesは共通Selectionの選択アイテム属性、Relationsは当該UIDを端点とする`trace_link`の関係種別・相対方向・相手、Reviewはコメントを表示する。コメントは`resource_text(text_role='comment')`として保存し、コメント→選択アイテムの`relates_to`を同一トランザクションで作る。EvidenceはRelationsへ、LLM Candidatesは候補Editor／下段Panelへ集約する。Editorタブは最大220pxで省略表示し、収まらない場合は複数段へ折り返す。タブは分割区分へのドラッグ＆ドロップまたはコマンドで移動する。
- Primary／Secondary／下段PanelはTitle Bar右側ボタンとCommandの双方から表示切替する。Activity BarはSettingsを下端固定し、それ以外のDnD順序をプロジェクト単位に保存する。選択ActivityはPrimary非表示時も選択色を維持する。保存レイアウトがないプロジェクトへ切り替えた場合は、直前プロジェクトの状態を持ち越さずM0既定値へ初期化する。
- Primary ActivityはExplorer／Search／Trace／Reports／History／Settingsで構成する。Reviewは各編集画面とSecondary、Jobsは下段PanelとStatus Barに集約し、Primary Activityへ戻さない。旧永続値のreview／jobsは読込時にExplorerへ正規化する。
- Pipeline Navigatorの選択表示はactiveなステージURIだけを基準とし、①〜④を排他的に表示する。①〜④の一覧行は薄青背景で選択を示し、上下矢印で選択行を移動、Enter／Spaceでクリックと同じ操作を実行する。④モデルは単一クリックで開く。①〜③の一覧／プレビュー境界は共通 `ResizablePaneGroup` で変更する。
- Explorer未確定Badgeは文書状態ではなく要素単位で集計し、extracted_itemはresource_uid、intermediate_itemはitem uidに対応するentity_registry.statusがapproved／deleted以外の件数を表示する。削除済みを除く子要素が1件以上かつ全件approvedの場合だけ抽出／中間文書もapprovedとし、それ以外はdraftへ同期する。
- Explorerの①〜④は強調した折りたたみ見出しとし、原本・抽出・中間・設計モデル各行は保持プロパティをTooltip表示する。Explorerは一覧と選択によるEditor表示に限定し、取込・名称変更・チャンク・モデル追加ボタンを置かない。Pipeline Navigatorの各ステージはEditor Areaにソート可能な一覧を開き、①は一覧上部の取込からWindows複数ファイル選択を直接開く読取専用詳細、②は独自プレビューとExplorer選択案内、③は一覧上部の取込とフェーズ－成果物階層、④はモデル一覧と追加操作を表示する。原本はファイルごとに独立した `import.source` Jobへ登録する（実行はJob Managerの直列制約を維持）。
- 抽出文書の初期 `entity_registry.title` は原本の `source_document.file_name` と同一にする。後の名称変更は抽出文書の `entity_registry.title` だけを更新し、原本名・blob・traceは変更しない。
- ①原本はPipeline NavigatorとExplorerのどちらから選択しても「OSアプリで開く」と「②抽出データの生成（抽出ジョブ実行）」を表示する。`source_document.uid`を参照する`extracted_document`が存在する場合は抽出実行を無効表示し、Backendも重複実行を拒否する。
- ①原本・②抽出・③中間の通常削除は `status='deleted'` の論理削除、Explorerだけからの一時非表示は `is_archived=1` とする。アーカイブはステージ一覧に残して復元可能とし、schema 1.5.0で `entity_registry.is_archived` と索引を追加した。同じ `dev_phase_id`／`artifact_type_id` の③が複数ある場合は、現在表示中の1件を優先し、表示中が複数なら最新1件以外を自動アーカイブする。復元時は同一成果物の他文書をアーカイブしてExplorer表示を最大1件に保つ。
- Workbench内文字検索は `Ctrl/Cmd+F` の共通検索UIで提供する。文書プレビューのパーツ種別・セクション・要素ID表示は共通 `DocumentPreviewMeta` で切替・ツール全体保存し、抽出形式固有の表示判定を各Editorへ埋め込まない。
- Secondaryの閉じたアコーディオンは開いたセクションの下へ安定ソートする。Relationsは相手エンティティから `resource://`／`original://`／`extracted://`／`intermediate://`／`chunk://` の編集URIを解決し、クリックまたはEnter／Spaceで開く。
- ストア閲覧はCOUNTによる総件数と500件単位の追加読込で全件到達可能にし、固定件数で打ち切らない。表は行番号・縦横スクロール・薄青選択・上下キー移動を備え、選択行を共通Selectionへ通知する。
- 関係性候補の選択肢は `relation_rule_master.allowed=1` と始点／終点カテゴリから導出する。LLMが許容外の関係性を返した場合は元値を保持して警告表示し、許容関係へ修正するまで採用不可とする。
- prettier は docs/ と tasks/ を対象外（.prettierignore）。
- LLM 外部送信はプロジェクト設定 `llm.externalSendAllowed`（既定 false）でブロックされる。
- Settings はツール全体設定（`settings://tool`）とプロジェクト設定（`project-settings://current`）を分離する。
  成果物・開発フェーズ・LLM外部送信可否は後者で管理する。
- ③中間データの統合元正本は文書間 `based_on`。`structure_json.sources` は表示順、
  `source_extracted_document_uid` は旧データ互換用で新規データでは NULL とする。
- ③編集の移動は連続した intermediate_item 選択のみ許可し、Ctrlによる歯抜け選択は拒否する。
- 成果物は `project_artifact_setting.dev_phase_id` で開発フェーズ配下に所属する。schema 1.2.0で追加。
  成果物・フェーズの「削除」は関連③中間データを含む物理削除であり、確認後も復旧不能。
- 統合元対応の正本は `intermediate_item.uid → extracted_item.uid` のアイテム単位 `based_on`。多対多とし、紐付済み統合元も選択・別成果物行への再利用を許可する。取込編集の状態列は `extracted_item.resource_uid` 側の抽出レビュー状態を表示する。「削除」は選択した extracted_item を終点とする当該中間文書配下のアイテムリンクだけを削除し、成果物行・Resource・抽出データ・文書単位リンクは保持する。`structure_json.elements[].intermediate_item_uid` を持つ新形式データは明示解除後に互換補完を再実行しない。編集・マージ・分割後も元 extracted_item へのリンクを維持する。
- ②プレビューと③の3ペインは必要時だけ縦横スクロールを表示し、3ペイン選択は対応要素を相互強調する。
- ②抽出と③中間のプレビューは文書表示／`structure_json`階層表示を切り替える。DBのJSON文字列はBackendで解析して返し、共通ビューはWord固有フィールドへ依存せず、キー・値の型をテーマ対応色で表示する。
- Explorer の③成果物は有効状態かつ `artifact.dev_phase_id === phase.dev_phase_id` の設定を②取込前から表示し、未所属成果物は表示しない。フェーズと成果物は種別ラベル・境界・背景で区別し、成果物選択時に対応する③がなければ統合元なしの空③を作成して編集画面を開く。
- ③成果物の状態サイクルは `draft → approved → review → rejected → draft`。成果物ペインの上下矢印はデータ順を変更せず、選択行の前後移動とフォーカス追従に割り当てる。
- チャンクは成果物単位で管理し、確認済み intermediate_item と多対多で対応する。対応正本は chunk → intermediate_item のアイテム単位 based_on。チャンク固有の追加プロンプトは chunk.additional_prompt に保持し、LLM候補生成時に本文へ追加する。
- チャンク編集の成果物ペインは状態・ID・種別・内容・小節・選択を表示し、中間編集と同じ階層/種別表現にする。チャンクは表形式で、追加プロンプトはチャンク行選択後の上部「編集」から変更する。プレビューは見出し階層・表・図を表示する。チャンクはsort_order順に表示し、新規作成は末尾、上下移動ではIDを変更しない。
- ②抽出・③中間・チャンク編集の選択行は `--d2d-selection-bg` の薄青背景、`based_on` 対応行は warning 22% mix の黄色背景で統一する。チャンク表も共通の罫線・角丸を使い、太い選択枠を独自実装しない。
- ②抽出（2ペイン）、③取込（3ペイン）／単独（2ペイン）、チャンク（3ペイン）、Resource編集（2ペイン）の内部境界は共通 `ResizablePaneGroup` を使用する。隣接ペインの合計比率と最小120pxを守り、ポインタドラッグと矢印キーの両方で変更する。チャンク表は横罫線のみとし、状態Badgeは折り返さない。
- Explorer の②抽出データ行に③への統合ボタンを置かず、③ステージ一覧上部の `取込` から、取込先成果物を排他的に1件、レビュー状態を問わない②を複数選択する。既存成果物を選ぶと `structure_json.sources` の関係を初期チェックへ復元し、保存時は文書単位 `based_on` と同期する。③ステージは成果物配下に取込元②を表示し、未使用の取込元を同画面から削除できる。統合済み要素の由来となる②は、対応する成果物要素を削除するまで取込元から外せない。チャンク操作は中間文書Editor上部のモード切替から開く。
- 中間文書エディタは同一Resource内で「中間データ取込編集画面」（統合元／成果物／プレビューの3ペイン）、「中間データ単独編集画面」（成果物／プレビューの2ペイン）、「チャンク編集画面」（成果物／チャンク／プレビューの3ペイン）を切り替える。ヘッダーは文書の自由名称ではなくプロジェクト成果物名を表示する。成果物要素の追加・複製・削除・編集は取込／単独画面共通で、ダブルクリックまたはSpace／Enterから編集を開く。
- 中間要素の追加・複製は新Resourceを作成する。複製は元Resourceへ `transform_note=duplicate` の `based_on` を保持し、②由来のアイテム単位トレースも引き継ぐ。基本種別編集は paragraph／heading／list_item／caption を対象とする。
- Resource編集は4.6の14種を定義駆動で共通化し、`resource://<uid>` からも開ける。保存直前にDBで所有・参照状況を判定する。③で新規作成され現在の `intermediate_item` だけが参照するResourceは、同種なら同じUIDへ上書きし、異種なら現在要素を新Resourceへ差し替えて旧Resourceを物理削除する。抽出由来、共有、入力トレース、他Resource、LLM実行記録から参照されるResourceは保護し、新Resource + 元Resourceへの `based_on (edit-resource)` とする。
- 中間要素の一覧マージはCtrl/Shiftの非連続を含む2件以上を文書表示順で処理し、先頭位置・階層へ集約する。同一Resource種別は同種の候補へ、異種は可読な `resource_text` へ変換し、全元Resourceへの `based_on (merge)` と全 `extracted_item` 由来を維持する。
- 中間要素から開くResource Editorは左を抽出由来（読取専用）または画面追加Resource（編集可能）、右を保存候補とする。通常/LLMマージは右フォームを更新するだけで、明示保存まではDBを変更しない。LLMマージは既存Provider・外部送信可否・マスキングを経由し、保存時は `llm_run_uid` と `llm-merge` を由来へ記録する。

## E2E（Playwright）の注意

- E2E開始時はElectron userDataに前回実行のレイアウトが残り得るため、`d2d.workbench.*`／`d2d.editors.*` のlocalStorageだけを削除してRendererを再読込する。設定Backendやプロジェクト正本は削除しない。
- `e2e/app.spec.ts` は**逐次実行・状態共有**（beforeAll で 1 プロジェクト作成、afterAll で
  app.close 後に削除。開いている project.db を rmSync すると EBUSY）。
- Electron Rendererの `window.prompt()` は入力ダイアログとして利用できない。名称変更等はテーマ対応のアプリ内ダイアログを使う。
- Activity Bar のボタンは**再クリックでサイドバーが閉じる**トグル。クリック前に
  `isVisible().catch(() => false)` で条件分岐する（既存テストのパターンを踏襲）。
- `<input>` の値は textContent に出ない → `toHaveValue` を使う。
- パネルは `status-jobs` クリックで強制オープンしてからタブ切替。
- 前のテストがデータを書き換えることがある（例: P6 テストが③本文を置換）。
  後続テストで参照する文言は実際に残る文言を選ぶ。
- チャンク編集を開き直した場合、チャンク選択は復元しない。候補生成など選択必須操作のE2Eは、対象チャンク行を明示選択してから実行する。

## 残課題（正直リスト）

- P14 一式（性能 NFR-001〜005 実測、オフライン確認、TBD-06〜08、
  Java/Graphviz/PlantUML/MeCab 同梱パッケージング P14-5、pymupdf 商用版 P14-6）
- P5 他形式抽出: Excel / PowerPoint / PDF / Visio / テキスト系（P5-7〜14）、
  Word 拡張（脚注・コメント・変更履歴・テキストボックス・数式）
- プロジェクト横断 Undo/Redo（NFR-012）はエディタ内のみ。操作履歴ベース未実装
- resource_table_cell の entity_registry CHECK 制約追加（テーブル再構築が必要 → 将来 2.0.0）
- アーカイブ差分の左右テキストは Backend プロセス内保持（再起動後は差分インポート再実行）
- Word 抽出の LLM 補助（EXT の一部）、GC 系 Golden Case の拡充
- 編集画面内部のペイン比率はEditorを開いている間だけ保持し、閉じる／再起動後の復元は未実装。
- Resource EditorのJSONカラムは構造化テキスト編集。表セルは既存のセルグリッド編集も併用し、図の画像実体差替えは画像URI編集として扱う。
- 同種の複雑Resource（表、図、モデル等）の通常マージは、JSON配列は連結、JSONオブジェクトはキー統合、競合するenum/数値等は先頭値を採用して警告する。意味的な再構成が必要な場合はLLMマージまたは右フォームでの手動修正が必要。
