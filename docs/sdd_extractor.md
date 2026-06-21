# 文書抽出機能設計書

## 1. 位置づけ

本ドキュメントは、文書抽出機能の設計を定義する。

文書抽出機能は、①原本データを入力し、原本ファイル単位の②抽出データを生成する。③中間データおよび④設計モデルは直接更新しない。

関連文書は以下である。

- [要求仕様書](srs.md)
- [機能構成詳細設計書](sdd_function_architecture.md)
- [文書抽出機能 共通設計書](sdd_extractor_common.md)
- [Word文書情報抽出機能 詳細設計書](sdd_extractor_word.md)
- [Excel文書情報抽出機能 詳細設計書](sdd_extractor_excel.md)
- [PowerPoint文書情報抽出機能 詳細設計書](sdd_extractor_powerpoint.md)
- [PDF文書情報抽出機能 詳細設計書](sdd_extractor_pdf.md)
- [Visio文書情報抽出機能 詳細設計書](sdd_extractor_visio.md)

## 2. 対象機能

| 項目 | 内容 |
| --- | --- |
| 機能種別 | 文書抽出機能 |
| 主入力 | ①原本データ、取込設定、抽出設定 |
| 主出力 | ②抽出データ成果物フォルダ |
| 成果物単位 | 原本ファイル単位 |
| 正本 | JSON / JSONL、SQLite DB |
| 派生成果物 | Markdown、プレビュー画像、クロップ画像、LLM入力用テキスト |

## 3. 責務範囲

| 区分 | 内容 |
| --- | --- |
| 責務 | 原本ファイルのプリチェック、ハッシュ計算、文書構造抽出、要素ID付与、原本位置保持、抽出結果保存、警告記録 |
| 責務 | Word、Excel、PowerPoint、Visio、PDF、テキスト、Markdown、CSV、TSV、JSON等の形式別抽出機能を提供する |
| 非責務 | ②抽出データを③中間データへ統合すること |
| 非責務 | ④設計モデルを直接作成・更新すること |
| 非責務 | LLM候補を確定情報として保存すること |

## 4. 入出力

### 4.1 入力

| 入力 | 内容 |
| --- | --- |
| source_file | ①原本データのファイルパス、ファイルID、原本ハッシュ |
| extraction_profile | 形式別抽出設定、文字コード、OCR利用可否、画像抽出可否 |
| workspace_policy | 外部送信可否、ローカル処理制約、ログ制約 |
| prior_extracted_data | 再実行時または差分確認時に参照する既存②抽出データ |

### 4.2 出力

| 出力 | 内容 |
| --- | --- |
| manifest | 成果物ID、原本ファイルID、原本ハッシュ、抽出器ID、schema_version、成果物一覧 |
| extracted.jsonl | 抽出要素、要素ID、原本位置、抽出状態、レビュー状態 |
| extracted.sqlite | 表、セル、ページ、画像、関係候補等を扱う場合の構造化DB |
| media/ | 抽出画像、クロップ画像、ページ画像、スライド画像 |
| review.md | 人間レビュー用の派生Markdown |
| llm_input.md | LLM入力用に範囲制御された派生Markdown |
| logs/ | ジョブログ、警告、未対応要素、再実行条件 |

## 5. 成果物フォルダ

```text
artifacts/extracted/{source_file_id}/
  manifest.json
  extracted.jsonl
  extracted.sqlite
  review.md
  llm_input.md
  media/
  logs/
```

ZIPアーカイブは通常編集対象ではなく、過去時点の保管、受け渡し、差分比較用インポートに利用する。

## 6. 機能定義項目

| 項目 | 内容 |
| --- | --- |
| function_type | `document_extraction` |
| function_id | 文書抽出機能ID |
| supported_source_types | 対応ファイル形式 |
| schema_version | 出力schema version |
| reads | `source_file` |
| writes | `artifacts/extracted/{source_file_id}` |
| optional_functions | LLMプロバイダ、履歴管理、トレーサビリティ |
| external_send | 外部送信有無 |
| license | 利用ライブラリとライセンス |

## 7. 連携

| 連携先 | 用途 |
| --- | --- |
| LLMプロバイダ機能 | OCR補正、表候補、図表説明候補、意味分類候補の生成 |
| 履歴管理機能 | 抽出前後、再抽出前後、ZIPアーカイブとの差分確認 |
| トレーサビリティ機能 | ②抽出データの情報単位IDに対する関係確認 |
| 中間データ処理機能 | ②抽出データを入力として③中間データを生成する後続処理 |

## 8. イベント

| イベント | 方向 | 内容 |
| --- | --- | --- |
| source.imported | 購読 | 原本取込完了を受けて抽出可能状態にする |
| extraction.started | 発行 | 抽出ジョブ開始 |
| extraction.completed | 発行 | ②抽出データ成果物フォルダ生成完了 |
| extraction.failed | 発行 | 抽出失敗、部分成果物、再実行条件 |
| artifact.updated | 発行 | 抽出結果のレビュー編集または再抽出結果の保存 |

## 9. UI・CLI

| 操作 | 要求 |
| --- | --- |
| プリチェック | ファイル形式、サイズ、ページ数、シート数、暗号化、破損を確認できること |
| 抽出実行 | ジョブとして実行し、進捗とログを画面表示できること |
| 抽出結果レビュー | 原本表示と抽出結果を並べて確認し、未確認、確認済、要修正、棄却を管理できること |
| 再実行 | 設定変更後に抽出ジョブを再実行し、既存成果物との差分を確認できること |

## 10. LLM利用

LLM利用は候補生成に限定する。LLM候補をUIに取り込む場合は、候補、編集中、編集確定の状態を分け、編集確定時に②抽出データへ反映する。

## 11. エラー処理

| 状態 | 扱い |
| --- | --- |
| 破損・暗号化 | 抽出失敗として理由をジョブログに記録する |
| 未対応要素 | 文書全体を破棄せず、未対応要素と影響範囲を記録する |
| 部分抽出 | 読み取れた範囲を部分成果物として保持し、失敗範囲を明示する |
| 外部送信禁止 | LLM利用を行わず、ローカル抽出と手動レビューで継続する |

