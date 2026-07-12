# D2D 開発状況・申し送り（STATE）

新しいセッション / 別の LLM で作業を始めるときは、まずこのファイルを読むこと。
フェーズ完了ごとに `dev-process/PROCESS.md` ステップ 7 に従って更新する。

## 現在地

- 完了: P0〜P13（クリティカルパス完走、MS6 相当まで）
- 残り: **P14**（性能・オフライン確認・残 TBD-06〜08・パッケージング・商用版）、
  **P5 の他形式抽出**（Excel / PowerPoint / PDF / Visio / テキスト系、EXT-014/015）
- テスト規模: ユニット 141 件 / pytest 10 件 / E2E 16 件（すべて成功の状態で引き渡し）

## フェーズ履歴（要点のみ）

| フェーズ | 内容                                                                                | コミット        |
| -------- | ----------------------------------------------------------------------------------- | --------------- |
| P0〜P3   | 骨格 / DB スキーマ 35 表 + 台帳 / ジョブ・設定・イベント / Workbench UI             | 〜P3 各コミット |
| P4/P5    | 原本取込 → Word 抽出 → ②候補 → 共通複数選択レビュー/構造プレビュー → 正本化         | —               |
| P6       | LLM 基盤（4 Provider、マスキング、外部送信ブロック、preview→run 2段階）             | —               |
| P7       | プロジェクト成果物/フェーズ設定、フェーズ→成果物取込、②/③/プレビュー3ペイン統合編集 | —               |
| P8       | ③→④候補生成 → 候補セットレビュー → 採用（同一 Txn・全 ROLLBACK）                    | —               |
| P9       | 再帰 CTE トレース・SVG グラフ・マトリクス・整合性検査 → Problems                    | —               |
| P10      | 状態遷移 / 用語集 / 表編集 / 検証編集 / PlantUML。schema 1.1.0 初適用               | 81d96d1         |
| P11      | 検索（FTS5 + MeCab トグル）※別セッションで実装・マージ                              | 921a55d 等      |
| P12      | DB to Text / SQLite dump / ZIP + manifest / 差分インポート / Git 参照 / ストア閲覧  | d2bc9c6         |
| P13      | レポート出力（②③④→文書風、フィルタ、Markdown/HTML、report:// プレビュー）           | 1123e29         |

## 恒久制約（違反するとビルド/実行が壊れる、または設計方針違反）

- **package.json に `"type": "module"` を入れない**。sandbox 化された preload は CommonJS 必須。
- **better-sqlite3 の ABI 切替**: vitest 前に `npm rebuild better-sqlite3`、build/E2E 前に
  `npm run rebuild:electron`。※P11 マージ以降 `rebuild:node` スクリプトは無く、
  `postinstall` が rebuild:electron を実行する（npm install 直後は Electron ABI）。
- **候補と正本の区別は entity_registry.status**（draft=候補 / approved=正本）。
- **正本は破壊しない**: 編集・マージ・分割・表編集は新リソース + `based_on` trace_link
  （transform_note = edit / merge / split / edit-table）で由来を残す。旧リソースは残す。
- **Main は Gateway/Shell のみ**。業務ロジックは backend/（utilityProcess）に置く。
  safeStorage は Main 専用 → backend からは main-bridge（逆方向 RPC）経由。
- **API キー等の秘密情報は平文で保存・ログ出力しない**（settings-service が強制）。
- スキーマ変更は `backend/db/migrations.ts` に追記（バックアップ → DDL → 版数更新）。現在 1.3.0。
- ②抽出レビューの選択・状態更新・構造プレビュー・Properties は `ReviewElement` 共通契約で実装し、
  Word 固有にしない。今後の Excel / PowerPoint / PDF / Visio / テキスト系も同じ操作体系へ接続する。
- Python ワーカーは stdin/stdout とも UTF-8 ラップ必須（CP932 化け）。pytest はシステム Python
  （miniconda）で実行（PATH 先頭の venv に pip が無い）。
- prettier は docs/ と tasks/ を対象外（.prettierignore）。
- LLM 外部送信はプロジェクト設定 `llm.externalSendAllowed`（既定 false）でブロックされる。
- Settings はツール全体設定（`settings://tool`）とプロジェクト設定（`project-settings://current`）を分離する。
  成果物・開発フェーズ・LLM外部送信可否は後者で管理する。
- ③中間データの統合元正本は文書間 `based_on`。`structure_json.sources` は表示順、
  `source_extracted_document_uid` は旧データ互換用で新規データでは NULL とする。
- ③編集の移動は連続した intermediate_item 選択のみ許可し、Ctrlによる歯抜け選択は拒否する。
- 成果物は `project_artifact_setting.dev_phase_id` で開発フェーズ配下に所属する。schema 1.2.0で追加。
  成果物・フェーズの「削除」は関連③中間データを含む物理削除であり、確認後も復旧不能。
- 統合元対応の正本は `intermediate_item → extracted_item` のアイテム単位 `based_on`。編集・マージ・分割後も元 extracted_item へ張り直し、既存データはresource由来からDBへ補完する。派生要素が全削除された場合のみ再統合可能。
- ②プレビューと③の3ペインは必要時だけ縦横スクロールを表示し、3ペイン選択は対応要素を相互強調する。
- Explorer の③成果物は有効状態かつ `artifact.dev_phase_id === phase.dev_phase_id` の設定だけ表示し、未所属成果物は表示しない。
- ③成果物の状態サイクルは `draft → approved → review → rejected → draft`。成果物ペインの上下矢印はデータ順を変更せず、選択行の前後移動とフォーカス追従に割り当てる。
- チャンクは成果物単位で管理し、確認済み intermediate_item と多対多で対応する。対応正本は chunk → intermediate_item のアイテム単位 based_on。チャンク固有の追加プロンプトは chunk.additional_prompt に保持し、LLM候補生成時に本文へ追加する。

## E2E（Playwright）の注意

- `e2e/app.spec.ts` は**逐次実行・状態共有**（beforeAll で 1 プロジェクト作成、afterAll で
  app.close 後に削除。開いている project.db を rmSync すると EBUSY）。
- Activity Bar のボタンは**再クリックでサイドバーが閉じる**トグル。クリック前に
  `isVisible().catch(() => false)` で条件分岐する（既存テストのパターンを踏襲）。
- `<input>` の値は textContent に出ない → `toHaveValue` を使う。
- パネルは `status-jobs` クリックで強制オープンしてからタブ切替。
- 前のテストがデータを書き換えることがある（例: P6 テストが③本文を置換）。
  後続テストで参照する文言は実際に残る文言を選ぶ。

## 残課題（正直リスト）

- P14 一式（性能 NFR-001〜005 実測、オフライン確認、TBD-06〜08、
  Java/Graphviz/PlantUML/MeCab 同梱パッケージング P14-5、pymupdf 商用版 P14-6）
- P5 他形式抽出: Excel / PowerPoint / PDF / Visio / テキスト系（P5-7〜14）、
  Word 拡張（脚注・コメント・変更履歴・テキストボックス・数式）
- プロジェクト横断 Undo/Redo（NFR-012）はエディタ内のみ。操作履歴ベース未実装
- resource_table_cell の entity_registry CHECK 制約追加（テーブル再構築が必要 → 将来 2.0.0）
- アーカイブ差分の左右テキストは Backend プロセス内保持（再起動後は差分インポート再実行）
- Word 抽出の LLM 補助（EXT の一部）、GC 系 Golden Case の拡充
