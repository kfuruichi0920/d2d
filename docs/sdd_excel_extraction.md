# Excel文書情報抽出 詳細設計

対象: P5-19、IMP-002、EXT-009、EXT-049〜062

## 1. フローと責務

    ① source_document (.xlsx)
      -> extract.excel（OOXML物理抽出、ルール候補、DrawingML）
      -> excel_extraction_draft（候補オーバレイ、人間確認、LLM提案、再取込差分）
      -> excelDraft.confirm
      -> ② extracted_document / extracted_item / resource_* / source_location

ワーカーはDBとネットワークへアクセスしない。Local Backendだけが候補UID採番、ドラフト永続化、LLM範囲検証、差分照合、②へのトランザクション変換を行う。Rendererは候補を編集するが②正本を直接更新しない。

## 2. 物理モデル

セルは address / row / column / raw_value / display_value / data_type / formula / style / comment / hyperlink を保持する。数式は保存式とキャッシュ値を分離し、再計算しない。行・列寸法、非表示、結合範囲、Table、名前付き範囲も保持する。

sheet.drawings は次を保持する。

| 項目 | 内容 |
| --- | --- |
| drawing_uid / drawing_type | Part内IDと image / shape / connector / group / chart / unknown |
| start_cell / end_cell / anchor | DrawingMLアンカーとセル矩形 |
| name / text | 原本に保存された名前・図形内文字 |
| style | 塗り、線、プリセット形状、回転等の取得できた基本装飾 |
| source_part / relationship_id | OOXML追跡情報 |
| preview_path | 画像原本または基本装飾から生成した図形プレビュー |
| connection_status | resolved / unresolved / not_applicable |

SmartArt、OLE、ActiveX、条件付き書式評価は推測せず、未対応Partと警告へ残す。

## 3. 候補モデル

候補は従来項目に drawing_refs、table_header_row_start/end、table_header_column_start/end を追加する。図候補は drawing_refs から図情報・プレビューを解決する。表タイトル行・列は候補本体を破壊せず矩形範囲として保存する。

## 4. DBと再取込差分

schema 2.4.0では excel_extraction_draft に次を追加する。

| カラム | 用途 |
| --- | --- |
| predecessor_source_document_uid | 同名Excelの直前ドラフト |
| diff_json | シートの unchanged/modified/added/removed、候補の unchanged/moved/added/removed/ambiguous |

候補内容署名は候補内セルの相対位置、表示値、数式、style ID、種別、Drawing参照で構成する。一意な一致だけに旧候補UID、候補種別、採否、表見出し設定を継承する。旧 approved は新原本での人間確認を必須にするため review へ戻す。分割・統合・複数一致は ambiguous とし自動継承しない。

## 5. API

| API | 内容 |
| --- | --- |
| excelDraft.get / saveCandidates / confirm | ドラフト取得・編集保存・②への確定変換 |
| excelDraft.getDrawingPreview | プロジェクト配下を検証し図のdata URLを返す |
| excelDraft.prepareLlm / runLlmConfirmed | 選択候補と周辺2セルの候補調整 |
| excelDraft.prepareRangeLlm / runRangeLlmConfirmed | 任意矩形だけのグルーピング候補生成 |

任意範囲LLMの応答は、シートを固定し、開始・終了セルが指定矩形内に完全包含される候補だけを追加する。追加候補は adjusted / review であり自動確定しない。

## 6. UI

上部は「シート」ラベル付きドロップダウンとし、選択シートの候補総数、未確認、要修正、採用、抽出不要の件数を表示する。

左ペインは保持範囲全体をスクロール可能な疎セル仮想表示とする。矢印キー、Shift、マウスドラッグで任意矩形を選択する。候補は種別別色のオーバレイで、選択、移動、リサイズ、追加、削除する。現在選択を任意範囲LLMへ渡せる。

右ペインは選択シートの候補だけをコンパクト表示する。色付き種別タグ、複数選択、右クリック一括採否を提供し、一覧と詳細の境界を縦方向にリサイズできる。詳細は範囲文字列、図プレビュー、表タイトル行・列の設定を表示する。

## 7. 安全性

ZIPエントリ数、総展開量、XMLサイズ、パストラバーサル、DTD/外部実体を検査する。外部URLを取得・実行しない。暗号化、破損、必須Part欠落はエラーとする。未対応Partは黙って捨てない。確定変換は1要素でも失敗した場合に全件ROLLBACKする。