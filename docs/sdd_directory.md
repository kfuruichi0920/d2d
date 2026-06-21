# D2D ディレクトリ・ファイル構成設計書

## 1. 目的

本書は、D2D プロジェクトの実行時フォルダ構成、ファイル命名規則、Git 管理対象と管理外の区別、および実装時のソースコードディレクトリ構成を定義する。

---

## 2. プロジェクトルート構成

```
<project_root>/
├── project.d2d                      # プロジェクト定義ファイル（JSON）
├── project.db                       # プロジェクト共通 SQLite DB（正本）
│
├── originals/                       # ①原本データ（改変しない）
│   └── <original_file_id>/
│       └── <original_filename>      # 原本ファイルの保管コピー
│
├── extracted/                       # ②抽出データ（原本ファイル単位）
│   └── <original_file_id>/
│       ├── extracted.db             # SQLite: extracted_item, extraction_run 等
│       ├── figures/
│       │   └── <figure_ref_id>.<ext>
│       └── tables/
│           └── <table_ref_id>.csv
│
├── artifacts/                       # ③中間データ（成果物単位）
│   └── <artifact_id>/
│       ├── intermediate.db          # SQLite: intermediate_item, doc_node, 詳細テーブル群
│       ├── chunks.jsonl             # LLM入力用チャンク（派生、再生成可）
│       ├── figures/
│       └── tables/
│
├── design/                          # ④設計モデル（プロジェクト全体）
│   ├── design.db                    # SQLite: design_element, design_relation
│   └── model_text/
│       └── <element_id>.puml        # PlantUML / SysMLv2 テキスト＋要素ID対応表
│
├── db_to_text/                      # DB to Text 派生出力（Git 管理対象）
│   ├── extracted/
│   │   └── <original_file_id>/
│   │       └── items.md
│   ├── artifacts/
│   │   └── <artifact_id>/
│   │       └── document.md
│   └── design/
│       ├── elements.md
│       ├── relations.md
│       └── trace_matrix.md
│
├── logs/                            # ジョブログ・LLMログ（Git 管理外推奨）
│   ├── jobs/
│   │   └── <job_id>.jsonl
│   └── llm/
│       └── <llm_run_ref_id>.jsonl
│
└── archives/                        # ZIP アーカイブ（Git 管理外）
    └── <artifact_id>_<yyyymmdd_hhmmss>.zip
```

---

## 3. project.d2d

プロジェクトを開く起点となるファイル。アプリはこのファイルを開くことでプロジェクトルートを特定し、同一ディレクトリの `project.db` を読み込む。

```json
{
  "d2d_version": "1",
  "project_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "schema_version": "1.0.0",
  "created_at": "2025-01-01T00:00:00Z"
}
```

パスは相対参照のみ使用し、絶対パスを持たない（ディレクトリ移動後も開けること）。

---

## 4. SQLite DB のテーブル割り当て

| DB ファイル | 含むテーブル |
| --- | --- |
| `project.db` | project, project_setting, artifact_type_def, artifact_name_def, dev_phase_def, original_file, original_location, artifact, trace_subject, trace_link, review_record, review_action, llm_run_ref, glossary_term, term_synonym |
| `extracted/<original_file_id>/extracted.db` | extraction_run, extracted_item, table_resource, figure_resource, formula_resource |
| `artifacts/<artifact_id>/intermediate.db` | intermediate_item, intermediate_doc_node, intermediate_title, intermediate_text, intermediate_table, intermediate_table_column, intermediate_table_row, intermediate_table_cell, intermediate_figure, intermediate_model, intermediate_state_transition, intermediate_state, intermediate_event, intermediate_transition, intermediate_state_event_action, intermediate_interface, intermediate_interface_item, intermediate_verification, intermediate_scenario, chunk, chunk_item |
| `design/design.db` | design_element, design_relation |

分割の方針：プロジェクト共通情報は `project.db` に集約し、データ量が多くなる層別の設計情報は層ごとのDBに分散する。これにより Git diff の粒度を層単位に保てる。

---

## 5. ファイル命名規則

| 対象 | 命名規則 | 例 |
| --- | --- | --- |
| original_file_id | UUID v4 | `f3a2b1c0-1234-...` |
| artifact_id | UUID v4 | `a1b2c3d4-5678-...` |
| 図ファイル | `<figure_ref_id>.<mime拡張子>` | `fig_001.png` |
| 表ファイル | `<table_ref_id>.csv` | `tbl_001.csv` |
| ZIP アーカイブ | `<artifact_id>_<yyyymmdd_hhmmss>.zip` | `a1b2..._20250601_120000.zip` |
| PlantUML テキスト | `<element_id>.puml` | `elem_req_001.puml` |
| ジョブログ | `<job_id>.jsonl` | `job_abc123.jsonl` |
| LLM ログ | `<llm_run_ref_id>.jsonl` | `llm_xyz789.jsonl` |

---

## 6. Git 管理対象と管理外

| パス | Git 管理 | 理由 |
| --- | --- | --- |
| `project.d2d` | 対象 | プロジェクト定義 |
| `project.db` | 対象 | 正本データ（バイナリ diff は db_to_text で補完） |
| `originals/` | 対象 | 原本の同一性追跡 |
| `extracted/` | 対象 | 抽出結果の変更履歴 |
| `artifacts/` | 対象 | 中間データの変更履歴 |
| `design/` | 対象 | 設計モデルの変更履歴 |
| `db_to_text/` | 対象 | Git diff による変更差分の可読化（主要差分確認媒体） |
| `logs/` | 管理外（.gitignore） | 大容量・再生成可能 |
| `archives/` | 管理外（.gitignore） | ZIP は差分比較専用 |
| `artifacts/*/chunks.jsonl` | 管理外（.gitignore） | 派生成果物・再生成可能 |

SQLite バイナリは diff が読みにくいため、`.gitattributes` で `*.db binary` を指定し、`db_to_text/` の Markdown / JSONL 出力を主な差分確認媒体とする。

---

## 7. アプリ側ソースコードディレクトリ構成

Electron + Vite + TypeScript 構成での推奨ソース構成。

```
d2d/                               # リポジトリルート
├── electron/
│   ├── main/                      # Electron main process (Node.js)
│   │   ├── index.ts               # エントリポイント
│   │   ├── ipc/                   # IPC ハンドラ（基盤機能 API の公開）
│   │   │   ├── project.ts
│   │   │   ├── store.ts
│   │   │   ├── jobs.ts
│   │   │   └── settings.ts
│   │   ├── store/                 # SQLite アクセス層（better-sqlite3）
│   │   │   ├── project-db.ts
│   │   │   ├── extracted-db.ts
│   │   │   ├── intermediate-db.ts
│   │   │   └── design-db.ts
│   │   ├── jobs/                  # ジョブ管理（キュー・進捗・再実行）
│   │   ├── workers/               # 外部ワーカー起動・JSONL 通信管理
│   │   │   ├── worker-host.ts     # stdin/stdout JSONL プロトコル
│   │   │   └── worker-registry.ts # ワーカー定義登録
│   │   └── settings/              # 設定管理（keytar によるAPIキー保護）
│   └── preload/
│       └── index.ts               # contextBridge 公開
│
├── src/                           # React / TypeScript (renderer process)
│   ├── app/
│   │   ├── layout/                # AppShell・アクティビティバー・ペイン管理
│   │   └── routes/                # ビュー間ナビゲーション（TanStack Router）
│   ├── features/                  # 機能別ディレクトリ（個別機能・共通機能単位）
│   │   ├── extractor/             # 文書抽出機能
│   │   ├── intermediate/          # 中間データ処理機能
│   │   ├── design-editor/         # 設計編集機能
│   │   ├── traceability/          # トレーサビリティ機能
│   │   ├── history-diff/          # 履歴・差分参照機能
│   │   ├── llm/                   # LLMプロバイダ機能
│   │   └── report/                # レポート出力機能
│   ├── components/                # 共通 UI コンポーネント
│   │   ├── editor/                # Monaco Editor ラッパー
│   │   ├── grid/                  # TanStack Table ラッパー
│   │   ├── graph/                 # Cytoscape.js ラッパー
│   │   └── diff/                  # Diff ビュー（Monaco diff editor）
│   └── store/                     # クライアント状態管理（Zustand）
│
├── workers/                       # 外部ワーカー（サブプロセス）
│   ├── python/                    # Python ワーカー（文書抽出）
│   │   ├── extractor/
│   │   │   ├── word.py
│   │   │   ├── excel.py
│   │   │   ├── pptx.py
│   │   │   ├── pdf.py
│   │   │   └── visio.py
│   │   ├── main.py                # stdin/stdout JSONL エントリポイント
│   │   └── requirements.txt
│   └── rust/                      # Rust ワーカー（高速テキスト処理・差分生成）
│       ├── src/
│       └── Cargo.toml
│
├── docs/                          # 設計文書
├── package.json
├── electron.vite.config.ts
└── .gitattributes                 # *.db binary 指定
```

---

## 8. .gitignore / .gitattributes 推奨設定

**.gitignore**
```
# ログ・派生成果物
**/logs/
**/archives/
**/artifacts/*/chunks.jsonl

# ビルド成果物
dist/
dist-electron/
release/

# Node.js
node_modules/

# Python
workers/python/__pycache__/
workers/python/.venv/
```

**.gitattributes**
```
# SQLite を Git バイナリ扱いにして diff 無効化
*.db binary

# テキスト正規化
*.md   text eol=lf
*.json text eol=lf
*.ts   text eol=lf
*.py   text eol=lf
```
