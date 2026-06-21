# D2D 全体詳細設計書

## 位置づけ

本ドキュメントは、D2D 全体に共通する詳細設計を定義する。プラグイン固有ではない実行時フォルダ構成、成果物配置、Git管理対象、アーカイブ配置などは本ドキュメントに集約する。

srs_main.md の以下に対応する詳細設計である。

- 5.2 ワークスペース管理
- 6.1 成果物セット / ZIPアーカイブ管理
- 16. Git連携要求

---

## 1. 実行時フォルダ構成案

実行時の保存領域は、ワークスペース単位の設定・一時情報と、プロジェクト単位の成果物を分離する。Git履歴管理の対象は、原則としてプロジェクト配下の②/③成果物フォルダと②/③/④のDB to Text出力とし、一時ファイル、キャッシュ、ZIPアーカイブ、インポート作業領域はGit対象外にする。

### 1.1 標準構成

```text
workspace-root/
  d2d-workspace.json
  .d2d/
    settings.json
    cache/
    temp/
    locks/
    logs/
  projects/
    {project_id}/
      project.json
      sources/
        {source_file_id}/
          original.{ext}
          source.json
      artifacts/
        extracted/
          {source_file_id}/
            manifest.json
            extracted.jsonl
            structure.json
            tables.sqlite
            media/
            rendered/
            text/
            logs/
        intermediate/
          {design_artifact_id}/
            manifest.json
            integrated_document.md
            integrated_structure.json
            llm_chunks.jsonl
            references.jsonl
            review.sqlite
            media/
            rendered/
            text/
            logs/
      model/
        working.sqlite
        graph-index/
        text/
          elements.jsonl
          relations.jsonl
          trace_matrix.csv
          trace_matrix.tsv
          model_manifest.json
      archives/
        exported/
          {archive_id}.zip
        imported/
          {archive_id}/
      reports/
      exports/
```

### 1.2 ディレクトリの役割

| パス | 役割 | Git管理 |
| --- | --- | --- |
| `d2d-workspace.json` | ワークスペース識別子、プロジェクト一覧、schema_version | 対象 |
| `.d2d/settings.json` | ワークスペース単位設定。APIキー等の秘匿値は直接保存しない | 対象可 |
| `.d2d/cache/` | 表示キャッシュ、解析キャッシュ | 対象外 |
| `.d2d/temp/` | ジョブ実行中の一時ファイル | 対象外 |
| `.d2d/locks/` | 多重起動、ジョブ競合防止用ロック | 対象外 |
| `.d2d/logs/` | アプリ実行ログ、ジョブログ集約 | 原則対象外 |
| `projects/{project_id}/project.json` | プロジェクト定義、開発フェーズ、成果物ID一覧 | 対象 |
| `sources/{source_file_id}/` | ①原本データと原本メタデータ | 方針により対象可 |
| `artifacts/extracted/{source_file_id}/` | ②抽出データ。原本ファイル単位の成果物セット | 対象 |
| `artifacts/intermediate/{design_artifact_id}/` | ③中間データ。複数原本ファイルから成る成果物単位の成果物セット | 対象 |
| `model/working.sqlite` | ④設計モデルの作業DB | 対象外または管理者設定 |
| `model/text/` | ④設計モデルのDB to Text出力 | 対象 |
| `artifacts/*/*/text/` | ②抽出データ、③中間データのDB to Text出力 | 対象 |
| `model/graph-index/` | 関係探索、影響分析用の派生索引 | 対象外 |
| `archives/exported/` | 成果物フォルダをZIP化した保管・受け渡し用アーカイブ | 対象外 |
| `archives/imported/` | ZIPアーカイブ差分比較用の展開先 | 対象外 |
| `reports/` | ③中間データ等から生成した文書レポート、レビュー、分析、差分結果レポート | 対象可 |
| `exports/` | 外部提出用のPDF、Word、HTML、SysMLv2等 | 対象外または対象可 |

### 1.3 ②抽出データフォルダ

②抽出データは原本ファイル単位で保存する。`source_file_id` は原本ファイルの安定IDであり、ファイル名変更だけでは変化しない。

```text
artifacts/extracted/{source_file_id}/
  manifest.json
  extracted.jsonl
  structure.json
  tables.sqlite
  media/
  rendered/
  text/
  logs/
```

| ファイル | 内容 |
| --- | --- |
| `manifest.json` | schema_version、source_file_id、原本ハッシュ、抽出器名、抽出器バージョン、成果物一覧 |
| `extracted.jsonl` | 段落、セル、図、表、数式等の抽出要素 |
| `structure.json` | 章節、ページ、シート、スライド等の構造 |
| `tables.sqlite` | 表、セル、結合セル等の構造化保存。存在しない形式では省略可 |
| `media/` | 原本から抽出した画像、埋め込みメディア |
| `rendered/` | ページ画像、スライド画像、シート画像等の確認用レンダリング成果物 |
| `text/` | ②抽出データのDB to Text出力。差分表示やLLM入力に利用 |
| `logs/` | 抽出器固有ログ、警告、未対応要素一覧 |

### 1.4 ③中間データフォルダ

③中間データは開発プロセス上の成果物単位で保存する。複数の②抽出データを入力にして、原本に近い自然言語本文と章構成を持つ一つの統合設計書として扱う。

```text
artifacts/intermediate/{design_artifact_id}/
  manifest.json
  integrated_document.md
  integrated_structure.json
  llm_chunks.jsonl
  references.jsonl
  review.sqlite
  media/
  rendered/
  text/
  logs/
```

| ファイル | 内容 |
| --- | --- |
| `manifest.json` | design_artifact_id、開発フェーズ、入力source_file_id一覧、入力②成果物ID一覧、統合順序 |
| `integrated_document.md` | 原本に近い自然言語本文と章構成を持つ統合設計書。レポート出力の主な入力 |
| `integrated_structure.json` | 章、節、親子関係、本文範囲、図表、参照、出力範囲指定に使う構造情報 |
| `llm_chunks.jsonl` | ④設計モデル候補生成時にLLMへ渡す一時的な入力単位。③中間データの親子関係は持たない |
| `references.jsonl` | 図表参照、章節参照、原本根拠リンク、成果物内リンク |
| `review.sqlite` | レビュー状態、修正履歴、採用・棄却判断 |
| `media/` | 統合設計書から参照される画像、図表 |
| `rendered/` | 統合設計書表示用のページ画像等の確認用レンダリング成果物 |
| `text/` | ③中間データのDB to Text出力。差分表示やLLM入力に利用 |
| `logs/` | 統合、チャンク化、参照解決のログ |

### 1.5 ④設計モデルフォルダ

④設計モデルは編集・検索用の作業DBと、Git差分確認用のtext dumpを分離する。

```text
model/
  working.sqlite
  graph-index/
  text/
    elements.jsonl
    relations.jsonl
    trace_matrix.csv
          trace_matrix.tsv
    model_manifest.json
```

| ファイル | 内容 | Git管理 |
| --- | --- | --- |
| `working.sqlite` | 編集・一覧表示用の作業DB | 対象外または管理者設定 |
| `graph-index/` | 関係探索、影響分析、可視化用の派生索引 | 対象外 |
| `text/elements.jsonl` | 設計要素の安定順出力 | 対象 |
| `text/relations.jsonl` | `parent_child`、`based_on`、`satisfy`、`verify`、`depend` の関係一覧 | 対象 |
| `text/trace_matrix.csv` / `text/trace_matrix.tsv` | 主要トレースマトリクスの出力 | 対象 |
| `text/model_manifest.json` | schema_version、出力日時、DBハッシュ、出力設定 | 対象 |

### 1.6 ZIPアーカイブの扱い

ZIPアーカイブは通常編集対象ではなく、成果物フォルダの時点保存、外部受け渡し、過去版との差分比較に使う。

```text
archives/
  exported/
    {archive_id}.zip
  imported/
    {archive_id}/
      manifest.json
      artifacts/
      model/
```

| 要求ID | 要求 |
| --- | --- |
| PLG-030 | ZIPアーカイブ生成時は、対象成果物フォルダ、作成日時、作成者、schema_version、元フォルダのハッシュ一覧をmanifestに記録すること |
| PLG-031 | ZIPアーカイブはGit対象外とし、必要に応じて外部保管または成果物管理システムへ登録できること |
| PLG-032 | ZIPアーカイブを差分比較用にインポートする場合、`archives/imported/{archive_id}/` に展開し、現在の成果物フォルダを直接上書きしないこと |
| PLG-033 | インポートしたZIPアーカイブとの差分は、現在の②/③成果物フォルダ、②/③/④のDB to Text出力との比較として表示できること |

### 1.7 推奨 `.gitignore`

```gitignore
.d2d/cache/
.d2d/temp/
.d2d/locks/
.d2d/logs/

projects/*/archives/
projects/*/model/working.sqlite
projects/*/model/graph-index/
projects/*/exports/

*.tmp
*.lock
```

②/③の成果物フォルダ内にあるSQLite DBは、成果物セットの一部としてGit管理対象にできる。②/③/④のDB to Text出力も差分表示やLLM入力に利用でき、Git管理対象にできる。一方、④設計モデルの作業DBや派生索引は再生成可能な実行時データとして扱い、Git管理は `model/text/` を基本とする。

Gitへのコミットは本ツール内では実行しない。本ツールは差分確認、Git管理対象の整理、text dump生成までを支援し、実際のコミット操作はユーザが外部のGitクライアントまたはCLIで行う。
