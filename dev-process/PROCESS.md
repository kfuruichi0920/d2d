# D2D 開発サイクル（AI 駆動・モデル中立）

このファイルが開発プロセスの**唯一の正**です。どの LLM / エージェントで作業する場合も、
1 フェーズ（または 1 タスク）を以下の 7 ステップで回してください。
ステップを飛ばさないこと。**完了条件を満たすまで次へ進まない**こと。

対象リポジトリ: D2D（Electron + React + TS + better-sqlite3 + Python ワーカー）。
計画は `tasks/task_breakdown.md`（P0〜P14）、要求は `docs/srs.md`、設計は `docs/sdd_*.md` が正。

---

## ステップ 1: 要件確認

1. `dev-process/STATE.md` を読む（前回までの状況・制約・残課題）。
2. `tasks/task_breakdown.md` の対象フェーズ表を読み、タスク ID・依存・対応 SRS ID を列挙する。
3. 対応する SRS ID の本文を `docs/srs.md` から grep して原文を確認する（推測で実装しない）。
4. 設計上の決定が必要なら `docs/sdd_*.md` と `docs/tbd_register.md` を確認する。

**完了条件**: 「このフェーズで満たす SRS ID の一覧」と「今回やらないこと（残課題候補）」を書き出せている。

## ステップ 2: 既存パターン調査

新しいコードを書く前に、必ず同種の既存実装を読む。

- Backend サービス: `backend/<領域>/<名前>-service.ts` の近い例
- API 登録: `backend/api/*.ts`（asRecord/requireString の検証パターン、`registerXxxApi(router, ...)`）
- 配線: `backend/index.ts`（API 登録とジョブ executor 登録）
- UI: Resource URI → `src/components/workbench/EditorArea.tsx`、サイドバー → `PrimarySideBar.tsx`
- テスト: 隣接する `*.test.ts` と `e2e/app.spec.ts` の直近テスト

**完了条件**: 触るファイル一覧と、従うべき既存パターン（命名・検証・イベント・トランザクション）を特定した。

## ステップ 3: 実装

- 実装順序: Backend サービス → ユニットテスト → API → `backend/index.ts` 配線 → UI → E2E。
- 周辺コードの流儀（コメント密度・日本語コメント・命名・エラー契約 BackendError）に合わせる。
- ファイル先頭コメントとコード中に**対応する SRS ID / タスク ID を明記**する（例: `EDIT-022〜025、TBD-04`）。
- 守るべき不変条件は `dev-process/STATE.md` の「恒久制約」節を参照（preload は CJS、抽出由来・共有正本は非破壊、
  派生は新リソース + based_on、③専有ResourceはMID-005の所有判定に従い上書き／置換、候補/正本は entity_registry.status、等）。
- 対象外のリファクタや無関係ファイルの変更をしない。

**完了条件**: フェーズ表の各タスクについて「実装した/意図的に見送った」のどちらかが言える。

## ステップ 4: 静的チェック

```
npm run typecheck
npm run lint
npm run format:check   # 崩れていたら npx prettier --write <触ったファイルのみ>
```

**完了条件**: エラー 0・警告 0（自分が触っていない既存警告も、軽微なら直してよい）。

## ステップ 5: 試験

better-sqlite3 は Node と Electron で ABI が異なるため、順序が重要:

```
npm rebuild better-sqlite3      # Node ABI（vitest 用）
npm test                        # ユニットテスト全件
npm run rebuild:electron        # Electron ABI
npm run build
npx playwright test             # E2E（実アプリ）
npm rebuild better-sqlite3      # Node ABI に戻す
```

まとめて実行: `node dev-process/verify.mjs --e2e`（ユニットのみは `node dev-process/verify.mjs`）。

- 新機能には必ず**ユニットテスト（サービス層）と E2E（実アプリの UI 経路）を追加**する。
- E2E は既存の逐次・状態共有スタイルに従う（`e2e/app.spec.ts` 末尾へ追加。注意点は STATE.md）。
- 失敗したら原因を特定して修正し、全件再実行。**失敗を残したまま先へ進まない**。

**完了条件**: ユニット・E2E とも全件成功（件数を控える。報告とコミットメッセージに使う）。

## ステップ 6: コミット

- 全ステップ成功後にのみコミットする。1 フェーズ = 原則 1 コミット。
- メッセージは日本語で `feat: P<N> <フェーズ名> (<要点>)` + 本文に
  「実装項目（SRS ID 付き）」「テスト追加数（累計）」を箇条書き。
- `docs/` `tasks/` は prettier 対象外（`.prettierignore`）。手で整形しない。

**完了条件**: `git status` がクリーン、コミットメッセージから実装範囲が追える。

## ステップ 7: 次回に向けた情報整理

1. `dev-process/STATE.md` を更新する:
   - 「フェーズ履歴」に 1 行追記（完了フェーズ・要点・テスト件数・コミットハッシュ）
   - 新たに判明した**非自明な制約・ハマりどころ**を「恒久制約」または「E2E の注意」へ追記
   - 「残課題」を最新化（見送った項目を正直に列挙）
2. STATE.md の更新を同じブランチにコミットする（実装コミットに含めてもよい）。
3. ユーザーへの完了報告に必ず含める:
   - 何を実装したか（SRS ID 対応付き）、テスト件数、コミットハッシュ
   - **正直な残課題・見送り事項**（できていないものを「できた」と言わない）
   - 次フェーズの推奨と理由

**完了条件**: 次のセッションが STATE.md だけ読めば続きを始められる。

---

## 品質基準（Done の定義）

以下すべてを満たしたときのみ、そのフェーズを「完了」と報告してよい:

- [ ] 対象フェーズの全タスクが「実装済み」または「理由付きで見送り」に分類されている
- [ ] typecheck / lint / format:check がクリーン
- [ ] ユニットテスト全件成功（新機能分のテストを追加済み）
- [ ] ビルド成功 + E2E 全件成功（実アプリで新機能の経路を通した）
- [ ] コードに SRS ID / タスク ID が明記されている
- [ ] 無関係な変更が混ざっていない
- [ ] コミット済み（規約どおりのメッセージ）
- [ ] STATE.md 更新済み + 完了報告に残課題を明記

## 禁止事項

- テスト失敗・lint エラーを残したままのコミット / 完了報告
- `"type": "module"` を package.json へ追加（preload が壊れる）
- 開いている project.db の削除（E2E で EBUSY）
- 抽出由来・共有・他エンティティ参照中の正本データの破壊的変更（編集は新リソース + based_on 由来リンク）。ただし、③で新規作成され現在の intermediate_item だけが参照するResourceは、MID-005の所有判定に従う同種上書き／異種置換を許可する
- SRS/SDD にない仕様の発明（不明点は TBD として質問するか、明記して見送る）
- prettier での docs/・tasks/ の整形
