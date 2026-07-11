# D2D — AI エージェント向け作業規約

このリポジトリで実装作業をする AI エージェント（Codex / Cursor / Copilot / Gemini CLI /
Claude Code その他）は、必ず次の順で読み、従うこと:

1. **`dev-process/STATE.md`** — 現在の進捗・恒久制約・ハマりどころ・残課題（申し送り）
2. **`dev-process/PROCESS.md`** — 開発サイクルの唯一の正（7 ステップ + 品質基準 + 禁止事項）

## 最重要ルール（詳細は PROCESS.md / STATE.md）

- 計画は `tasks/task_breakdown.md`、要求は `docs/srs.md`、設計は `docs/sdd_*.md` が正。
  仕様を発明しない。コードに SRS ID / タスク ID を明記する。
- 完了条件 = `node dev-process/verify.mjs --e2e` が ALL PASS
  （typecheck / lint / format / ユニット / ビルド / E2E）。失敗を残して完了報告しない。
- `package.json` に `"type": "module"` を追加しない（preload が壊れる）。
- better-sqlite3 は ABI 切替が必要: vitest 前 `npm rebuild better-sqlite3`、
  build/E2E 前 `npm run rebuild:electron`。
- 正本データは破壊しない（編集は新リソース + based_on 由来リンク）。
- フェーズ完了時は `dev-process/STATE.md` を更新してからコミットする。
- コミットメッセージは日本語 `feat: P<N> <フェーズ名> (<要点>)` + 実装項目/テスト件数。
