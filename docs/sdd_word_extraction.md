# Word文書情報抽出 詳細設計

対象: P5-4 / P5-17 / P5-18、EXT-001〜008、EXT-016〜019、EXT-042〜048

## 1. 目的と境界

DOCXの表示結果を再現するのではなく、DOCXパッケージに保存された構造、書式、描画要素、
Story、Part、Relationshipを設計支援で再利用できる文書構造データとして抽出する。
抽出時には設計上の意味へ分類しない。Wordワーカーは `project.db` を更新せず、
Local Backendが既存の②抽出候補保存処理を用いて正本候補へ接続する。

## 2. 抽出アーキテクチャ

| 層 | 実装 | 責務 |
| --- | --- | --- |
| コマンド | `workers/python/commands/word.py` | 後方互換の `elements` を組み立て、画像を作業領域へ保存する |
| OOXML解析 | `workers/python/commands/word_ooxml_base.py` | ZIP検証、XML安全解析、番号定義、Run書式、Story、図形、Part inventoryを抽出する |
| 公開契約 | `workers/python/commands/word_ooxml.py` | 未対応要素検出を含むOOXML解析APIを公開する |
| 保存 | `backend/extract/store-extraction.ts` | `elements` をResourceへ接続し、拡張情報を `structure_json` に欠落なく保存する |

処理順は、ZIP安全検証、Part/Relationship inventory、本文の出現順走査、補助Story走査、
未対応要素検出、文書構造データ生成とする。`mc:AlternateContent` は `Choice` を優先し、
利用できない場合のみ `Fallback` を解析するため、DrawingML/VMLの二重抽出を防ぐ。

## 3. 文書構造データ

既存の `metadata` と `elements` を維持し、次を追加する。

| 項目 | 内容 |
| --- | --- |
| `metadata.feature_flags` | 実行時に有効な抽出機能 |
| `metadata.source_sha256` | 抽出原本のSHA-256 |
| `statistics` | 要素種別、Story、コメント、変更履歴、未対応要素の件数 |
| `stories` | header / footer / footnote / endnoteごとの要素 |
| `comments` | コメントID、作成者、日時、本文、元Part |
| `revisions` | 挿入、削除、移動のID、作成者、日時、本文 |
| `package.parts` | Part URI、Content Type、種別、サイズ、SHA-256、親Part、Relationship、Raw XML参照 |
| `package.relationships` | 親Partごとの内部／外部Relationship |
| `unsupported_elements` | 要素名、元Part、件数、Raw XML保持状態 |
| `review_hints.warnings` | 未対応要素等のレビュー警告 |

各 `elements` 要素は、既存の `id`、`type`、`text`、`section_path` に加え、必要に応じて
`uid`、`element_type`、`parent_uid`、`story_type`、`page_no`、`source_part`、
`relationship_id`、`anchor_paragraph_uid` を持つ。

### 3.1 リスト

`word/numbering.xml` の `numId` → `abstractNumId` → `lvl` を解決し、`list_info` に
`level`、`number_format`、`level_text`、`start`、インデント、箇条書き／番号付きの区別を保持する。
表示文字列の先頭から番号を推測しない。開始番号上書きは `lvlOverride/startOverride` を優先する。

### 3.2 Run書式

`runs[].format.direct` にOOXMLで直接指定された値を保存する。未指定と `false` を区別するため、
未指定プロパティはキー自体を出力しない。現在は `effective` に直接値を複製する。
スタイル継承を解決した有効書式は今後の拡張対象とする。

対象は太字、斜体、下線種別、取消線、二重取消線、文字色、蛍光、網掛け、フォント、
フォントサイズ、上付き／下付き、非表示、文字間隔、位置、圏点、東アジアレイアウトである。

### 3.3 図形、グループ、コネクタ

DrawingMLの `wps:wsp` / `a:sp` / `a:cxnSp` と、VMLの
`v:shape` / `v:rect` / `v:oval` / `v:line` を抽出する。
グループは `group_shape` と子要素の `parent_uid` で表す。図形内テキストは段落境界とRunを
`text_body.paragraphs` に保持する。

コネクタは `start_native_id`、`end_native_id`、接続位置、始端／終端矢印を保持する。
両端が明示された場合だけ `connection_status=resolved`、
それ以外は `unresolved` とし、幾何推定で確定しない。

### 3.4 Story、フィールド、ページ情報

本文とheader、footer、footnote、endnoteを `story_type` で分離する。
PAGE等のフィールドは命令文字列とキャッシュ表示結果を分ける。
ページ番号は `w:br type=page` と `lastRenderedPageBreak` から得る補助値であり、
Wordの再レイアウト結果を保証しない。ヘッダ／フッタ内のPAGEフィールドは保持する。

### 3.5 文書プレビューへの投影

Extraction Review Editorは `runs` の直接書式、`list_info`、図形・グループ・コネクタ、
`stories`、フィールド、コメント、変更履歴を文書プレビューへ投影する。Storyは本文と混在させず、
headerを本文の前、footer・footnote・endnoteを本文の後へPart名付きで表示する。
図形は図形種別、名前、親子関係、保存済み位置・寸法・接続ID・矢印を図形情報カードで表す。
Wordと同一のページ割付や幾何描画に必要な情報が不足する場合は、推測で補完せず保存済み値を表示する。

## 4. 情報欠落防止

`preserve_raw_xml=true` の場合、XML Partを `blobs/extracted/job-*/raw_xml/` に保存し、
Part inventoryから参照する。未対応のWord要素とWord拡張名前空間は黙って捨てず、
`unsupported_elements` とレビュー警告へ集計する。SmartArt、チャート、OLE、OMML、
ActiveX、Custom XML、複雑なコンテンツコントロールは現時点ではPart inventoryとRaw XMLを
保持するが、共通中間モデルへの意味解析は未対応である。

## 5. セキュリティ

- ZIPエントリ数: 4,096以下
- 単一エントリ展開サイズ: 32 MiB以下
- 全エントリ展開サイズ: 256 MiB以下
- 絶対パスと `..` を含むZIPパスを拒否
- XMLのDTD／ENTITYを拒否
- XML深度: 256以下
- OLE、VBA、ActiveXを実行しない
- 外部Relationshipへアクセスしない
- バイナリPartはサイズとSHA-256のみをinventory化

## 6. 機能フラグ

`extract.word` の `parameters.features` で、図形、図形内文字、コネクタ、SmartArt、
チャート、OLE、変更履歴、コメント、フィールド、コンテンツコントロール、Raw XML保持を
個別に指定できる。既存Backend経路では後方互換の既定値を使用する。

## 7. ライブラリとライセンス

| ライブラリ | バージョン | ライセンス | 商用利用 | 採用理由 | 代替 |
| --- | --- | --- | --- | --- | --- |
| Python `zipfile` | Python 3.11+標準 | PSF License | 可 | OPCパッケージを追加依存なしで安全に走査 | lxml + OPC実装 |
| Python `xml.etree.ElementTree` | Python 3.11+標準 | PSF License | 可 | DTD/外部実体を利用せずOOXMLを直接解析 | lxml |
| python-docx | 未同梱（補助候補） | MIT | 可 | 将来の基本API補助候補。今回の実装は未使用 | Open XML SDK |

GPL系ライブラリと商用SDKは追加していない。外部リンクや埋め込みオブジェクトを実行しない。

## 8. 試験

`make_advanced_docx.py` が多段リスト、Run書式、DrawingML/VML図形、グループ、
明示コネクタ、AlternateContent、header/footer PAGEフィールド、コメント、変更履歴、
未対応Word拡張要素を含むDOCXを生成する。`test_word_advanced.py` は抽出結果、
Raw XML、機能フラグ、DTD拒否を検証する。既存 `test_word_extract.py` は後方互換を検証する。

## 9. 既知の制約と次段階

- スタイル／テーマ継承後の有効書式は未解決。
- SmartArt、チャート、OLE、OMML、返信コメント、改訂書式差分、Custom XML bindingは
  inventoryとRaw XML保持までで、意味モデル化していない。
- DrawingMLの全図形型、描画キャンバス、フリーフォーム座標、クロップ、グループ座標変換は未完。
- コネクタの明示IDは保持するが、IDから抽出UIDへの解決表は未実装。
- Wordレンダリング依存の正確な物理ページ番号、折返し、座標は対象外。
- ZIP圧縮率上限、処理時間／メモリのOSレベル制限、マルウェアスキャンはBackend実行基盤側の残課題。
