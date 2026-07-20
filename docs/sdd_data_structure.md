# D2D データ構造詳細設計

> **実装準拠版: schema 2.2.0（2026-07-20）**
>
> 本書は `docs/srs.md` 6章・8章・9章を、SQLiteの物理データ構造へ具体化する。DDLの唯一の正は `backend/db/schema/initial-schema.ts` とし、本書はその設計意図と主要カラムを説明する。

---

## スキーマ版数履歴

| schema_version | 内容 | 互換性 |
| --- | --- | --- |
| `2.0.0` | ④を13個の `model_*` 物理テーブルへ分離。オントロジー定義・許容マトリクスを追加。`entity_registry.design_category` と未使用Resource 5種を削除 | 1.xとの後方互換なし。既存プロジェクトは再作成 |
| `2.1.0` | `llm_candidate_draft`を追加 | LLM実行ごとに編集途中の候補セットを1件保持 |
| `2.2.0` | 振舞モデルを `model_beh` へ改名し、関係の作成中状態と設定駆動アイコンを追加 | 2.1以前のプロジェクトは再作成 |

## 1. 設計方針

1. ①原本、②抽出、③中間、④設計モデルの正本を `project.db` で一体管理する。
2. 画像、原本、LLM生ログ等の大容量データは `blobs/` に置き、DBには相対パスとハッシュを保持する。
3. 全エンティティを `entity_registry` に登録し、`uid` を詳細テーブルの主キー兼外部キーとする。
4. ②③の記述形式は9種類の `resource_*`、④の設計意味は13種類の `model_*` で管理する。
5. ④の種別は `entity_registry.entity_type` で判定し、`design_category` は設けない。
6. 設計モデルの共通情報は台帳と各テーブル共通カラム、独自情報は `detail_json` に分離する。
7. 独自情報の構造、モデル定義、関係定義、許容組合せはオントロジー設定を正とする。
8. 関係は `trace_link` に一元化し、許容判定はオントロジー設定から行う。
9. 正本由来のResourceを破壊せず、④は新規 `model_*` と `based_on` で作る。

## 2. データ階層と物理格納

| 階層 | 主なテーブル | 格納内容 |
| --- | --- | --- |
| ①原本 | `source_document`、`source_location`、`blob_resource` | 原本、ハッシュ、原本内位置 |
| ②抽出 | `extracted_document`、`extracted_item`、9種類の `resource_*` | 抽出構造、抽出器情報、記述形式 |
| ③中間 | `intermediate_document`、`intermediate_item`、`chunk`、`chunk_item`、9種類の `resource_*` | 統合文書、章構造、LLM入力単位 |
| ④設計モデル | 13種類の `model_*`、`trace_link` | 設計意味、種別固有情報、関係 |
| オントロジー | `ontology_version`、`ontology_model_definition`、`ontology_relation_definition`、`ontology_relation_allowance` | 採用中のモデル・関係・許容組合せ |

②③で使用するResourceは次の9種類である。

- `resource_label`
- `resource_text`
- `resource_list`
- `resource_figure`
- `resource_table`
- `resource_formula`
- `resource_code`
- `resource_model`
- `resource_reference`

`resource_scenario`、`resource_state_transition`、`resource_interface`、`resource_data_structure`、`resource_metadata` はschema 2.0.0に存在しない。シナリオ、状態遷移、IF、データ構造等は、②③では本文・表・図・モデル等の記述として保持し、④への確定時に対応する `model_*` へ構造化する。用語集は補助データとして `resource_glossary` と `resource_glossary_synonym` で管理する。

## 3. テーブル一覧

| グループ | テーブル |
| --- | --- |
| プロジェクト | `project`、`project_artifact_setting`、`project_artifact_relation`、`project_dev_phase_setting` |
| 共通台帳・ジョブ | `entity_registry`、`batch_operation_info`、`job_record` |
| 原本・blob | `blob_resource`、`source_document`、`source_location` |
| 抽出 | `extracted_document`、`extracted_item` |
| 中間 | `intermediate_document`、`intermediate_item`、`intermediate_source_document`、`chunk`、`chunk_item` |
| Resource | 上記9種、`resource_list_item`、`resource_table_cell`、`resource_glossary`、`resource_glossary_synonym` |
| 設計モデル | `model_src`、`model_std`、`model_req`、`model_cst`、`model_func`、`model_struct`、`model_beh`、`model_state`、`model_data`、`model_if`、`model_verif`、`model_impl`、`model_mgmt` |
| オントロジー | `ontology_version`、`ontology_model_definition`、`ontology_relation_definition`、`ontology_relation_allowance` |
| 関係 | `trace_link` |
| LLM | `llm_run_ref`、`llm_candidate_draft`、`prompt_template`、`llm_provider_config`、`llm_request_log` |
| セマンティック入力 | `semantic_input_document`、`semantic_reference`、`normalization_history`、`semantic_recent_use` |
| UI・設定 | `project_ui_state`、`favorite_resource`、`comment_record`、`impact_view_config` |

## 4. 主要テーブルのカラム定義

### 4.1 project

| カラム | 型 | 制約・用途 |
| --- | --- | --- |
| `uid` | TEXT | PK |
| `name` | TEXT | NOT NULL |
| `schema_version` | TEXT | NOT NULL。新規プロジェクトは `2.2.0` |
| `created_at`、`updated_at` | TEXT | 作成・更新日時 |

### 4.2 project_artifact_setting

開発フェーズ配下で使用する成果物種別の有効状態、表示順、設定値を管理する。`project_artifact_relation` は成果物間関係、`project_dev_phase_setting` はフェーズ定義を管理する。

### 4.3 batch_operation_info

取込、抽出、LLM、出力の一括処理状態を管理する。個々のエンティティは `entity_registry.batch_operation_uid` から参照する。

### 4.4 blob_resource

DB外ファイルのプロジェクトルート相対パス、MIME、サイズ、SHA-256、説明を保持する。絶対パスは保存しない。

### 4.5 entity_registry

全エンティティの共通台帳である。④設計モデルでは `entity_type` に `model_*` を格納し、同じ名前の物理テーブルへ1対1で接続する。`design_category` は未使用ではなく、カラム自体を削除する。

| カラム | 型 | 制約・用途 |
| --- | --- | --- |
| `uid` | TEXT | PK、UUIDv7 |
| `project_uid` | TEXT | NOT NULL、`project.uid` |
| `entity_type` | TEXT | NOT NULL。設計モデルは下表の `model_*`。追加モデルにも対応するため固定CHECKを設けない |
| `code` | TEXT | NOT NULL。`<code_prefix>-<6桁連番>`、`entity_type` と組み合わせてUNIQUE |
| `title` | TEXT | 表示名 |
| `status` | TEXT | `draft / review / approved / rejected / deleted` |
| `is_archived` | INTEGER | `0 / 1` |
| `owner_uid` | TEXT | 所有者・管理主体。`allocated_to` とは別概念 |
| `review_info_json` | TEXT | レビュー情報 |
| `memo_json` | TEXT | 機械処理可能な補助情報 |
| `administrative_notes` | TEXT | 管理特記事項 |
| `created_by`、`updated_by` | TEXT | 作成・更新主体 |
| `batch_operation_uid` | TEXT | 一括処理との関連 |
| `source_hash` | TEXT | 由来内容のハッシュ |
| `created_at`、`updated_at` | TEXT | 作成・更新日時 |

初期状態で `entity_type` に使用する設計モデル種別は次の13種類である。

| entity_type / 物理テーブル | code_prefix | 層 | 日本語名 |
| --- | --- | --- | --- |
| `model_src` | SRC | 根拠 | 一次情報 |
| `model_std` | STD | 根拠 | 規範 |
| `model_req` | REQ | 要求 | 要求 |
| `model_cst` | CST | 要求 | 制約 |
| `model_func` | FUNC | 論理設計 | 機能 |
| `model_struct` | STRUCT | 論理設計 | 構造 |
| `model_beh` | BEH | 論理設計 | 振舞 |
| `model_state` | STATE | 論理設計 | 状態 |
| `model_data` | DATA | 情報・契約 | データモデル |
| `model_if` | IF | 情報・契約 | インタフェース |
| `model_verif` | VERIF | 評価 | 検証情報 |
| `model_impl` | IMPL | 実現 | 実装 |
| `model_mgmt` | MGMT | 知識・管理 | 知識・管理 |

追加した設計モデルも `entity_type = model_*` とし、`ontology_model_definition.code_prefix` で採番する。

### 4.6 ②③Resource

9種類の詳細テーブルは `uid` をPK/FKとして `entity_registry` と1対1で接続する。配列構造は `resource_list_item`、表セルは `resource_table_cell` へ分離する。抽出項目と中間項目は、それぞれ `extracted_item.resource_uid`、`intermediate_item.resource_uid` からResourceを参照する。

| テーブル | 主な固有情報 |
| --- | --- |
| `resource_label` | ラベル本文、ラベル種別、番号、階層、スタイル |
| `resource_text` | 本文、役割、言語、文分割、文脈 |
| `resource_list` | リスト種別、開始番号、深さ |
| `resource_figure` | 画像blob、キャプション、代替文、図番号、寸法 |
| `resource_table` | 表題、行列数、ヘッダ情報、表構造 |
| `resource_formula` | 数式本文、記法、表示形式、番号 |
| `resource_code` | コード本文、言語、ファイル名、シンボル |
| `resource_model` | モデル名、記法、モデルソース、描画blob |
| `resource_reference` | 参照本文、URI、参照種別、対象 |

### 4.7 設計モデル共通構造

13個の初期 `model_*` と、設定画面で追加する `model_*` は同じ物理構造を持つ。

| カラム | 型 | 制約・用途 |
| --- | --- | --- |
| `uid` | TEXT | PK、`entity_registry.uid`、ON DELETE CASCADE |
| `summary` | TEXT | NOT NULL、既定値空文字。モデルの要約・本文 |
| `detail_json` | TEXT | NOT NULL、JSON object。種別固有情報 |
| `model_version` | INTEGER | NOT NULL、既定値1。要素データの版 |

独自情報の初期定義は次のとおりであり、実カラムを種別ごとに増やさず `detail_json` に格納する。

| テーブル | detail_json のキー |
| --- | --- |
| `model_src` | `source_kind`、`locator`、`excerpt` |
| `model_std` | `standard_id`、`clause`、`authority` |
| `model_req` | `requirement_kind`、`priority`、`acceptance_criteria` |
| `model_cst` | `constraint_kind`、`condition`、`limit` |
| `model_func` | `responsibility`、`inputs`、`outputs` |
| `model_struct` | `structure_kind`、`responsibility` |
| `model_beh` | `trigger`、`preconditions`、`steps`、`postconditions` |
| `model_state` | `initial_state`、`states`、`transitions` |
| `model_data` | `data_kind`、`fields`、`constraints` |
| `model_if` | `interface_kind`、`provider`、`consumer`、`protocol`、`operations` |
| `model_verif` | `verification_kind`、`condition`、`procedure`、`expected_result` |
| `model_impl` | `implementation_kind`、`location`、`symbol` |
| `model_mgmt` | `management_kind`、`decision`、`rationale`、`assumption`、`issue`、`change` |

### 4.8 ontology_version

| カラム | 型 | 制約・用途 |
| --- | --- | --- |
| `singleton` | INTEGER | PK、常に1 |
| `version` | TEXT | 初期値 `0.1.0` |
| `confirmed_at` | TEXT | 最終確定日時 |
| `confirmed_by` | TEXT | 最終確定者 |

管理画面で「確定」を実行したとき、パッチ番号を1つ増やす。単なる入力中の変更では版を増やさない。

### 4.9 llm_candidate_draft

| 列 | 型 | 制約・意味 |
| --- | --- | --- |
| `llm_run_uid` | TEXT | PK、FK→`llm_run_ref.uid`。LLM実行ごとに一時保存は1件 |
| `candidate_set_json` | TEXT | JSON object。編集途中の要素候補・関係候補を保持 |
| `updated_at` | TEXT | 最終一時保存日時 |

候補原本は`llm_run_ref.result_blob_uid`から読み、一時保存は明示的な「一時保存を再開」操作時だけ表示する。採用成功時は該当行を削除する。

### 4.10 ontology_model_definition

| カラム | 型 | 制約・用途 |
| --- | --- | --- |
| `model_type` | TEXT | PK、`model_` で始まる物理テーブル名 |
| `code_prefix` | TEXT | UNIQUE、表示コード接頭辞 |
| `label` | TEXT | 日本語名 |
| `layer` | TEXT | 根拠、要求、論理設計等の層 |
| `definition` | TEXT | 日本語定義。LLM導出入力とHelpに使用 |
| `field_schema_json` | TEXT | 独自項目定義のJSON配列 |
| `is_enabled` | INTEGER | `0 / 1`。削除の代わりに無効化 |
| `is_builtin` | INTEGER | 初期組込み種別か |
| `sort_order` | INTEGER | 表示順 |
| `updated_at` | TEXT | 更新日時 |

新しい定義を追加するときは、名前を検証したうえで同じ `model_*` 物理テーブルをトランザクション内で作成する。削除操作は提供しない。

### 4.11 ontology_relation_definition

| カラム | 型 | 制約・用途 |
| --- | --- | --- |
| `relation_type` | TEXT | PK |
| `label` | TEXT | 日本語名 |
| `definition` | TEXT | 日本語定義。LLM導出入力とHelpに使用 |
| `required_attr` | TEXT | 保存時に必要な関係属性 |
| `icon_color` | TEXT | トレース表示の背景色。`#RRGGBB` |
| `icon_text` | TEXT | トレース表示の短縮文字。8文字以下 |
| `is_enabled` | INTEGER | `0 / 1`。削除の代わりに無効化 |
| `is_builtin` | INTEGER | 初期組込み関係か |
| `sort_order` | INTEGER | 表示順 |
| `updated_at` | TEXT | 更新日時 |

初期値は `based_on`、`satisfies`、`allocated_to`、`verifies`、`contains`、`implements`、`uses`、`calls`、`conflicts_with`、`relates_to` の10種類とする。

### 4.12 ontology_relation_allowance

| カラム | 型 | 制約・用途 |
| --- | --- | --- |
| `relation_type` | TEXT | `ontology_relation_definition` 参照 |
| `source_model_type` | TEXT | 起点の `model_*` |
| `target_model_type` | TEXT | 終点の `model_*` |
| `allowed` | INTEGER | `0 / 1` |

3列を複合PKとする。管理画面は関係種別ごとに、起点を縦軸、終点を横軸とする2次元マトリクスで編集する。`based_on` の終点は①〜③のエンティティであるため、このモデル間マトリクスには含めない。

### 4.12 trace_link

`trace_link` は関係そのものをエンティティとして管理する。`relation_type` に固定CHECKを設けず、有効性と組合せをオントロジー設定で検証する。

`review_status` は `creating`（作成中）、`draft`、`review`、`approved`、`rejected`、`provisional` を持つ。`creating` は関係必須属性が仮値であり、確定前の編集対象であることを表す。

主なカラムは `uid`、`from_uid`、`to_uid`、`relation_type`、`direction`、`confidence`、`created_by`、`review_status`、`rationale`、`basis_kind`、`evidence_span`、`transform_note`、`allocation_kind`、`allocation_role`、`usage_kind`、競合関連属性、版・有効期間である。同じ `from_uid + relation_type + to_uid` は一意とする。

保存規則:

- `based_on`: 起点は `model_*`、終点は①〜③またはチャンク。設計モデル間には使用しない。
- その他: 両端を有効な `model_*` とし、許容マトリクスが1の組合せだけを保存する。
- `contains`: 自己包含、異種モデル間、循環を禁止する。
- `conflicts_with`: 逆方向を含む重複を禁止する。
- 無効な関係種別は新規保存しない。マトリクスの表示候補には有効・無効を問わず全定義を返す。
- UI/API境界で必須属性が未入力の場合は関係種別ごとの仮値を補い、`review_status='creating'` とする。DB保存層は必須属性制約を維持する。

## 5. 検索・トレース・出力

### 5.1 検索

FTS5の `fts_entity_text` は台帳タイトル、Resource本文、用語、レビュー情報に加え、`model_*` の `summary` と `detail_json` を索引対象とする。MeCabを無効にした場合もNFKC正規化した部分一致を併用する。

### 5.2 トレース

トレース探索は `entity_registry.entity_type LIKE 'model_%'` で設計モデルを抽出し、SQLite再帰CTEで `trace_link` を走査する。マトリクスの行・列種別には `model_req`、`model_func` 等の完全な `entity_type` を使用する。

### 5.3 DB to Text

全テーブルをテーブルごとのJSONLとして、主キーまたは `uid` 昇順で出力する。設計モデル一覧は `entity_registry.entity_type` と各 `model_*`.summaryから生成する。出力は派生成果物であり正本を置き換えない。

## 6. インデックスと制約

- `entity_registry(entity_type, code)` を一意とする。
- `entity_registry(project_uid, entity_type, status)` を主要検索キーとする。
- `trace_link(from_uid, relation_type)`、`trace_link(to_uid, relation_type)` をトレース探索に使用する。
- `ontology_model_definition.code_prefix` を一意とする。
- `ontology_relation_allowance` は関係・起点・終点を複合主キーとする。
- JSON列は `json_valid` で検査する。
- FKは有効化し、台帳削除時に詳細テーブルをCASCADEする。

## 7. 初期化と移行

新規プロジェクトでは、schema 2.0.0の基底DDLを実行し、2.2.0までのmigrationを適用したうえで次を行う。

1. `ontology_version = 0.1.0` を作成する。
2. 13個の組込みモデル定義を登録する。
3. 10個の組込み関係定義を登録する。
4. 初期許容マトリクスを登録する。

schema 1.xから2.0.0への自動移行は行わない。旧 `resource_*` と `design_category` の意味を推測して変換すると設計意味が変わるため、旧プロジェクトを開いた場合はプロジェクト再作成を要求するエラーとする。

## 8. 実装上の安全条件

- 動的な `model_*` テーブル名は `^model_[a-z][a-z0-9_]*$` で検証し、任意SQLを許可しない。
- `field_schema_json` は100件以下の配列とし、各項目の `key` 重複、`label`、`description`、`type (text / multiline / json / select)`、selectの `options` を保存前に検証する。`detail_json` はobjectとして検証し、定義済み項目の型とselect選択肢を登録・更新時に検証する。
- モデル追加時の物理テーブル作成と定義登録、設計要素追加時の台帳登録と `model_*` 登録は、それぞれ同一トランザクションで行う。
- モデルや関係は削除せず無効化し、既存データと履歴を残す。
- オントロジー定義の変更と確定版更新を分ける。
- ④を編集するときも、②③のResourceを更新・削除しない。
