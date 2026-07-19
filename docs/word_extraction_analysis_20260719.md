# Word抽出機能 高度化分析結果

## 現行分析

現行コードを確認した結果、D2Dの従来実装は `python-docx` を直接使用せず、Python標準の `zipfile` と `xml.etree.ElementTree` でOOXMLを解析していた。この既存経路を維持して拡張した。

従来実装は本文、見出し、単純なリスト階層、結合表、画像、キャプションを
`elements` に抽出していた。一方、`numbering.xml` の番号定義、Run書式、Story、
図形、Relationship、校閲情報、未対応要素の存在を保存しておらず、
`extractor_version=0.1.0` の出力から原本の保存情報を再構成できなかった。

## 抽出精度の評価

今回の改善で、従来は欠落していたリスト定義、Run直接書式、図形、Story、校閲情報を
文書構造データとして取得できる範囲は拡大した。一方、本文文字列や見出し判定の正解率を
定量評価したものではないため、「Word抽出全体の精度が何%向上した」とは評価しない。
P5-18では取得済み情報を文書プレビューへ投影し、欠落・誤抽出を人が確認できる範囲を拡大する。

## 今回追加した抽出対象

| 対象 | 状態 | 主な出力 |
| --- | --- | --- |
| 箇条書き／番号付きリスト | 対応 | `list_info` |
| 太字、下線、取消線、色、蛍光等 | 直接書式に対応 | `runs[].format.direct` |
| DrawingML/VMLオートシェイプ | 基本図形に対応 | `shape` |
| 図形内文字列 | 段落／Run構造に対応 | `text_body.paragraphs` |
| グループ図形 | 親子関係に対応 | `group_shape`, `parent_uid` |
| コネクタ | 明示接続IDと矢印に対応 | `connector` |
| ヘッダ／フッタ | Storyとして対応 | `stories` |
| PAGE等フィールド | 命令／キャッシュ値に対応 | `fields` |
| コメント／変更履歴 | 基本文字情報に対応 | `comments`, `revisions` |
| Part／Relationship | 全Part inventoryに対応 | `package` |
| Raw XML／未対応要素 | 対応 | `raw_xml_ref`, `unsupported_elements` |

## Raw保持のみ／未対応

SmartArt、チャート、OLE、OMML、ActiveX、Custom XML、複雑なコンテンツコントロール、
返信コメント、書式変更履歴は専用の意味モデルへ変換していない。
ただし、Part URI、Content Type、Relationship、サイズ、SHA-256、Raw XMLを保持し、
未対応Word要素は件数をレポートするため、黙って欠落しない。

## OOXML対応表

| Part／要素 | 処理 |
| --- | --- |
| `word/document.xml` | 本文、表、図形、フィールド、ブックマーク、改訂 |
| `word/numbering.xml` | `numId`、`abstractNumId`、`ilvl`、開始番号 |
| `word/styles.xml` | 見出しレベル |
| `word/header*.xml`, `footer*.xml` | Story、フィールド |
| `word/footnotes.xml`, `endnotes.xml` | Story |
| `word/comments*.xml` | コメント |
| `word/_rels/*.rels` | 内部／外部Relationship |
| `w:drawing`, `wps:wsp`, `wpg:wgp`, `a:cxnSp` | DrawingML図形 |
| `w:pict`, `v:shape`, `v:rect`, `v:oval`, `v:line` | VML図形 |
| `mc:AlternateContent` | Choice優先、Fallback重複防止 |
| `word/charts`, `diagrams`, `embeddings`, `activeX`, `customXml` | inventory／Raw保持 |

## 性能試験結果

2026-07-19、Windows、Python 3.12.11で `make_advanced_docx.py` の機能別DOCXを同一プロセス内で100回抽出した。
平均50.39ms、p95 62.98ms、最大68.74ms、`tracemalloc`ピーク0.36MiBだった。
これは小規模な合成DOCXの回帰基準値であり、大容量文書のNFR-001〜005判定ではない。
大容量、多数画像、深いグループ、巨大埋め込みを含む性能・上限試験はP14に残す。

詳細な中間データモデル、セキュリティ上限、ライセンス、試験、既知制約は
`docs/sdd_word_extraction.md` を正とする。
