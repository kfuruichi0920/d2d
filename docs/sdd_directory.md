# D2D ディレクトリ・ファイル構成設計書

## 1. 目的

本書は、D2D プロジェクトの実行時フォルダ構成、ファイル命名規則、Git 管理対象と管理外の区別、および実装時のソースコードディレクトリ構成を定義する。

---

## 2. プロジェクトルート構成

すべての設計データは単一の `project.db` に保存する。DB外の大容量ファイル（原本・画像・表・LLMログ等）は `blobs/` に格納し、テキスト派生出力（差分確認・LLM入力用）は `exports/` に格納する。

```
<project_root>/
├── project.d2d                    # プロジェクト定義ファイル（JSON）
├── project.db                     # SQLite DB（正本・全テーブルを単一ファイルで管理）
│
├── blobs/                         # DB外バイナリ・大容量ファイル
│   ├── originals/                 # ①原本ファイルの保管コピー（改変しない）
│   │   └── <source_document_uid>/
│   │       └── <original_filename>
│   ├── extracted/                 # ②PDFページ画像、Office抽出副産物、OCR中間物
│   ├── figures/                   # ②③ 図・画像・レンダリング結果
│   ├── tables/                    # ②③ CSV・JSON化した表データ
│   ├── llm/                       # prompt・completion・評価ログ
│   └── exports/                   # blob形式の派生成果物（dump等）
│
├── exports/                       # テキスト派生出力（Git管理対象）
│   ├── db_to_text/                # DB to Text 出力（Git diff 主要媒体）
│   │   ├── entity_registry.jsonl
│   │   ├── extracted_document.jsonl
│   │   ├── intermediate_document.jsonl
│   │   ├── resource_*.jsonl       # 各設計リソーステーブル
│   │   └── trace_link.jsonl
│   ├── sqlite_dump/               # SQLite dump（調査・履歴参照用）
│   │   ├── schema.sql
│   │   └── data.sql
│   └── manifest/                  # ZIPアーカイブ生成時・export時に作成（派生成果物）
│       └── blob_manifest.json
│
├── logs/                          # ジョブログ・LLMログ（Git 管理外推奨）
│   ├── jobs/
│   │   └── <job_uid>.jsonl
│   └── llm/
│       └── <llm_run_ref_uid>.jsonl
│
└── archives/                      # ZIP アーカイブ（Git 管理外）
    └── <artifact_name>_<yyyymmdd_hhmmss>.zip
```

---

## 3. データ階層とファイル・テーブルの対応

4階層データ（①〜④）がどのファイルおよびテーブルに対応するかを示す。

```mermaid
flowchart TD
    subgraph ①原本データ
        SD["source_document\nsource_location\nblob_resource"]
        ORIG["blobs/originals/"]
    end

    subgraph ②抽出データ
        ED["extracted_document\nextracted_item"]
        EXBLOB["blobs/extracted/\nblobs/figures/\nblobs/tables/"]
    end

    subgraph ③中間データ
        IMD["intermediate_document\nintermediate_item\nchunk / chunk_item"]
    end

    subgraph ④設計モデル
        REG["entity_registry\nresource_*\ntrace_link"]
    end

    subgraph project.db
        SD
        ED
        IMD
        REG
    end

    ORIG -->|blob_resource参照| SD
    EXBLOB -->|blob_resource参照| ED

    SD -->|抽出| ED
    ED -->|統合・正規化| IMD
    IMD -->|モデル化| REG

    subgraph exports/
        DBT["db_to_text/\n（Git差分媒体）"]
        DUMP["sqlite_dump/\n（調査・復元用）"]
        MANIF["manifest/\n（blob整合確認用）"]
    end

    REG -.->|DB to Text| DBT
    IMD -.->|DB to Text| DBT
    ED -.->|DB to Text| DBT
```

| 階層 | テーブル（project.db） | blobs/ | exports/ |
| -- | --- | --- | --- |
| ①原本データ | `source_document`、`source_location`、`blob_resource` | `blobs/originals/` | — |
| ②抽出データ | `extracted_document`、`extracted_item` | `blobs/extracted/`、`blobs/figures/`、`blobs/tables/` | `exports/db_to_text/extracted_document.jsonl` 等 |
| ③中間データ | `intermediate_document`、`intermediate_item`、`chunk`、`chunk_item` | `blobs/figures/`、`blobs/tables/` | `exports/db_to_text/intermediate_document.jsonl` 等 |
| ④設計モデル | `entity_registry`、`resource_*`（16種）、`trace_link`、`llm_run_ref` | `blobs/llm/` | `exports/db_to_text/resource_*.jsonl`、`trace_link.jsonl` 等 |
| 派生成果物 | — | `blobs/exports/` | `exports/sqlite_dump/`、`exports/manifest/` |

---

## 4. project.d2d

プロジェクトを開く起点となるファイル。アプリはこのファイルを開くことでプロジェクトルートを特定し、同一ディレクトリの `project.db` を読み込む。

```json
{
  "d2d_version": "1",
  "project_uid": "018fe6c2-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "schema_version": "1.0.0",
  "created_at": "2025-01-01T00:00:00Z"
}
```

パスは相対参照のみ使用し、絶対パスを持たない（ディレクトリ移動後も開けること）。

---

## 5. SQLite DB のテーブル割り当て

すべてのテーブルを単一の `project.db` に格納する。情報種別ごとに DB ファイルを分けない（詳細は `sdd_data_structure.md` 参照）。

| テーブルグループ | テーブル名 |
| --- | --- |
| プロジェクト管理 | `project`、`project_artifact_setting`、`project_artifact_relation`、`project_dev_phase_setting` |
| 共通台帳・取込管理 | `entity_registry`、`batch_operation_info` |
| 原本・blob参照 | `source_document`、`source_location`、`blob_resource` |
| 抽出データ | `extracted_document`、`extracted_item` |
| 中間データ | `intermediate_document`、`intermediate_item`、`chunk`、`chunk_item` |
| 設計リソース（16種） | `resource_label`、`resource_text`、`resource_list`、`resource_figure`、`resource_table`、`resource_formula`、`resource_code`、`resource_model`、`resource_scenario`、`resource_interface`、`resource_state_transition`、`resource_data_structure`、`resource_reference`、`resource_metadata`、`resource_glossary`、`resource_glossary_synonym` |
| トレース・LLM | `trace_link`、`llm_run_ref`、`prompt_template` |

---

## 6. ファイル命名規則

| 対象 | 命名規則 | 例 |
| --- | --- | --- |
| エンティティUID（uid） | UUIDv7 形式 TEXT | `018fe6c2-xxxx-7xxx-xxxx-xxxxxxxxxxxx` |
| 原本保管ディレクトリ | `blobs/originals/<source_document_uid>/` | `blobs/originals/018fe6c2-.../spec.docx` |
| 図ファイル | `blobs/figures/<blob_uid>.<mime拡張子>` | `blobs/figures/018fxxxx-....png` |
| 表ファイル | `blobs/tables/<blob_uid>.csv` | `blobs/tables/018fxxxx-....csv` |
| LLM プロンプトログ | `blobs/llm/<llm_run_ref_uid>_prompt.jsonl` | `blobs/llm/018fxxxx-..._prompt.jsonl` |
| LLM 結果ログ | `blobs/llm/<llm_run_ref_uid>_result.jsonl` | `blobs/llm/018fxxxx-..._result.jsonl` |
| DB to Text | `exports/db_to_text/<table_name>.jsonl` | `exports/db_to_text/trace_link.jsonl` |
| ZIP アーカイブ | `archives/<artifact_name>_<yyyymmdd_hhmmss>.zip` | `archives/req_spec_20250601_120000.zip` |
| ジョブログ | `logs/jobs/<job_uid>.jsonl` | `logs/jobs/018fxxxx-....jsonl` |
| LLM ログ（高水準） | `logs/llm/<llm_run_ref_uid>.jsonl` | `logs/llm/018fxxxx-....jsonl` |
| PlantUML テキスト | `blobs/exports/<element_uid>.puml` | `blobs/exports/018fxxxx-....puml` |

---

## 7. Git 管理対象と管理外

| パス | Git 管理 | 理由 |
| --- | --- | --- |
| `project.d2d` | 対象 | プロジェクト定義 |
| `project.db` | 対象 | 正本データ（バイナリ diff は `exports/db_to_text/` で補完） |
| `blobs/originals/` | 対象（既定） | 原本の同一性追跡。ただし機密文書を含むプロジェクトでは、リモート共有時の原本拡散を避けるため、プロジェクトごとの運用判断で `.gitignore` により管理外にできる |
| `blobs/figures/` | 対象 | 図・画像の変更履歴 |
| `blobs/tables/` | 対象 | 表データの変更履歴 |
| `exports/db_to_text/` | 対象 | Git diff による変更差分の可読化（主要差分確認媒体） |
| xports/sqlite_dump/ | 対象 | スキーマ差分とデータ復元補助。ツール内コミット時にDB to Textとともに再生成・ステージする |
| `exports/sqlite_dump/` | 対象 | スキーマ差分・復元補助 |
| `exports/manifest/` | 対象 | blob整合確認（派生成果物） |
| `blobs/extracted/` | 管理外（.gitignore 推奨） | 大容量・再生成可能 |
| `blobs/llm/` | 管理外（.gitignore） | 大容量・機密情報含む可能性 |
| `blobs/exports/` | 管理外（.gitignore） | 派生成果物・再生成可能 |
| `logs/` | 管理外（.gitignore） | 大容量・再生成可能 |
| `archives/` | 管理外（.gitignore） | ZIP は差分比較専用 |

SQLite バイナリは diff が読みにくいため、`.gitattributes` で `*.db binary` を指定し、`exports/db_to_text/` の JSONL 出力を主な差分確認媒体とする。

---

## 8. アプリ側ソースコードディレクトリ構成

Electron + Vite + TypeScript 構成での実際のソース構成。

> **設計方針**: `src/` はUIのWorkbench / Resource / Editor構成を中心にし、業務ロジックは別プロセスの `backend/` に配置する。Electron Main は Gateway / Shell として `backend/` の起動・停止・接続監視と Renderer IPC 中継に限定する。Rust ワーカーは予定していたが機能要件の変化により不採用。

```
d2d/                               # リポジトリルート
├── electron/
│   ├── main/                      # Electron main process (Gateway / Shell)
│   │   ├── index.ts               # エントリポイント
│   │   ├── ipc/                   # Renderer IPC受付とBackend API中継
│   │   │   └── handlers/          # project / resource / job 等の薄い中継ハンドラ
│   │   ├── backend/               # Local Backendプロセス起動・停止・監視
│   │   ├── system/                # ファイル選択、OS統合、システム情報
│   │   └── utils/                 # Gateway用ユーティリティ
│   └── preload/
│       └── index.ts               # contextBridge 公開（window.api.* の全ブリッジ定義）
│
├── backend/                       # Local Backend（別プロセス / Node.js）
│   ├── index.ts                   # Backendエントリポイント
│   ├── api/                       # Main向け操作単位API
│   ├── db/                        # DBスキーマ定義・マイグレーション
│   │   └── schema/
│   ├── schemas/                   # JSON Schema定義（ワーカーI/O・LLM構造化出力・候補セット検証）
│   ├── store/                     # SQLite アクセス層（better-sqlite3 / entity-registry）
│   ├── jobs/                      # ジョブ管理（キュー・進捗・再実行）
│   ├── workers/                   # 外部ワーカー起動・JSONL 通信管理
│   ├── settings/                  # 設定管理（Electron safeStorage によるAPIキー保護）
│   ├── import/                    # ①原本インポート
│   ├── extract/                   # ②抽出データ管理
│   ├── intermediate/              # ③中間データ処理
│   ├── design/                    # ④設計モデル管理
│   ├── traceability/              # トレーサビリティ機能
│   ├── llm/                       # LLMプロバイダ機能（fetch による HTTP 通信）
│   ├── reports/                   # レポート出力機能
│   ├── git/                       # Git操作（simple-git）
│   ├── plantuml/                  # PlantUML実行
│   ├── search/                    # MeCab前処理、FTS5検索索引
│   ├── project/                   # プロジェクト管理
│   ├── artifacts/                 # 成果物管理
│   ├── events/                    # イベント通知
│   └── utils/                     # Backend用ユーティリティ
│
├── src/                           # React / TypeScript (renderer process)
│   ├── pages/                     # 機能別ページコンポーネント
│   │   │                          # （SourcePage / ExtractedPage / IntermediatePage 等）
│   ├── components/
│   │   ├── workbench/             # Workbench Shell・ペイン管理・アクティビティバー
│   │   │   └── views/             # 各ビューコンポーネント
│   │   └── design/                # 設計リソース編集コンポーネント
│   ├── providers/                 # React Context Provider
│   ├── stores/                    # クライアント状態管理（Zustand）
│   └── types/                     # TypeScript 型定義（IPC API 型・DBスキーマ型）
│
├── workers/                       # 外部ワーカー（サブプロセス）
│   └── python/                    # Python ワーカー（文書抽出・各種コマンド）
│       ├── commands/              # コマンドハンドラ（word.py / excel.py / powerpoint.py / pdf.py 等）
│       ├── main.py                # stdin/stdout JSONL エントリポイント
│       ├── requirements.txt
│       └── dist/                  # PyInstaller ビルド出力（d2d-worker.exe 等）
│
├── docs/                          # 設計文書
├── package.json
├── electron.vite.config.ts
└── .gitattributes                 # *.db binary 指定
```

---

## 9. .gitignore / .gitattributes 推奨設定

**.gitignore**
```
# blob派生物・大容量ファイル
blobs/extracted/
blobs/llm/
blobs/exports/

# ログ・アーカイブ
logs/
archives/

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
*.jsonl text eol=lf
*.ts   text eol=lf
*.py   text eol=lf
```
