# Excel文書情報抽出 詳細設計

対象: P5-19、IMP-002、EXT-009、EXT-049〜055

## 1. 基本設計

Excel抽出は既存の①原本→②抽出データの境界を維持し、その間に正本ではない抽出グループ候補ドラフトを置く。

```text
① source_document (.xlsx)
  -> extract.excel（OOXML物理抽出・候補生成）
  -> excel_extraction_draft（ユーザー編集・LLM修正候補）
  -> excelDraft.confirm
  -> ② extracted_document / extracted_item / resource_* / source_location
```

ワーカーは `project.db` を更新しない。Local Backendだけがドラフト保存と②正本候補への変換を行う。Excel候補は確認済みでも②抽出データではなく、`confirm` 成功時に初めて既存Word抽出と同じ②データモデルへ接続する。

## 2. 実行境界

| 層 | 責務 |
| --- | --- |
| Renderer | 原本操作、候補レビュー、セルグリッド表示、範囲・種別・タイトル・採否編集、LLM送信前確認、確定操作 |
| Main | 既存IPCとOS原本表示。Excel業務ロジックを持たない |
| Local Backend | Job登録、原本blob解決、候補UID採番、ドラフト永続化、LLM実行・結果検証、確定時トランザクション |
| Python worker | `.xlsx` ZIP/XMLの物理解析、ルール候補生成、JSON成果物出力。DBとネットワークへアクセスしない |

Microsoft Open XML SDKを別ランタイムとして追加せず、既存Pythonワーカー境界でOOXMLを直接解析する。これにより配布ランタイムを増やさず、未知パートの保持と低水準情報取得を両立する。

## 3. ワーカー契約

`command = "extract.excel"` とし、`parameters` は `file_path`、`work_dir` を必須とする。出力ファイルは次の概念構造を持つ。

```json
{
  "metadata": { "extractor_name": "d2d-excel-extractor", "extractor_version": "0.1.0" },
  "workbook": { "file_name": "sample.xlsx", "sheets": [] },
  "candidates": [],
  "package": { "parts": [], "unsupported_parts": [] },
  "review_hints": { "warnings": [] }
}
```

セルは `address`、`row`、`column`、`raw_value`、`display_value`、`data_type`、`formula`、`style`、`comment`、`hyperlink` を保持する。数式は評価せず、保存済みキャッシュ値と式を分離する。外部リンク、マクロ、ActiveX、埋込オブジェクトは実行・取得しない。

## 4. 候補モデル

候補は `candidate_uid`、`sheet_name`、`start_cell`、`end_cell`、`candidate_type`、`title`、`detection_methods[]`、`confidence`、`candidate_status`、`review_status`、`llm_suggestion` を持つ。

- `candidate_status`: `detected / adjusted / confirmed / rejected`
- `candidate_type`: `table / text / list / formula / figure / model / unknown`
- `review_status`: `draft / review / approved / rejected`

候補範囲は初期実装では矩形セル範囲とする。複合範囲、図形包含、範囲プロファイルと再取込差分はP5-19D/Eへ分離する。

## 5. DB

schema 2.3.0で `excel_extraction_draft` を追加する。

| カラム | 用途 |
| --- | --- |
| `source_document_uid` | PK/FK。①Excel原本 |
| `status` | `generated / editing / confirmed / failed` |
| `physical_json` | ワーカーが返した物理モデル |
| `candidates_json` | Local BackendがUUIDv7を付与した候補配列 |
| `last_llm_run_uid` | 最後の範囲限定LLM実行証跡 |
| `confirmed_extracted_document_uid` | 確定後の②抽出文書 |
| `created_at / updated_at / confirmed_at` | 監査時刻 |

ドラフトは候補編集用であり、`entity_registry` の正本エンティティには登録しない。

## 6. API

| API | 内容 |
| --- | --- |
| `document.extract` | Wordは従来どおり。Excelは `extract.excel` 候補生成Jobを登録 |
| `excelDraft.get` | 物理モデルと候補ドラフトを返す |
| `excelDraft.saveCandidates` | 候補配列を検証して保存 |
| `excelDraft.prepareLlm` | 選択候補と周辺セルだけのLLM要求を構築 |
| `excelDraft.runLlmConfirmed` | 送信前確認済み要求からLLM修正候補Jobを登録 |
| `excelDraft.confirm` | 採用候補を既存②抽出データへ変換 |

重複実行は、既存②抽出データがある場合と、ドラフト生成Jobの完了後に未確定ドラフトがある場合の双方でBackendが拒否する。

## 7. UI

原本操作は既存 `OriginalActions` を共用する。Excelでは未生成時に「抽出グループ候補を生成」、生成後に「抽出グループ候補を確認」を表示する。

`excel-draft://` Editorは、シート選択、セルグリッド、候補一覧と編集欄を同一Workbench内に配置する。候補選択で対象セル範囲を強調し、候補の編集・追加・削除、LLM支援、確定抽出を行う。原本は既存の「OSアプリで開く」で対照確認する。

## 8. エラー・安全性

- ZIP総展開量、エントリ数、個別XMLサイズを上限検証し、パストラバーサル名を拒否する。
- DTD/外部実体は受け付けず、外部URLへアクセスしない。
- 暗号化、破損、必須OOXMLパート欠落は `worker` エラーとする。
- 未対応パートは `unsupported_parts` と警告へ記録する。
- 確定変換は同一DBトランザクションとし、1要素でも失敗した場合は全件ROLLBACKする。
