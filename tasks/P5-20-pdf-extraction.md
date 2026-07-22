# P5-20 PDF抽出候補フロー

対象: IMP-005、EXT-012、EXT-027〜033、UI-031〜032
参照: 検討資料「PDF文書取込・構造化機能に関する技術検討結果」（d2d-project/13-Pdf抽出方針.md）

## 1. 設計方針（検討資料との対応）

1. **物理抽出層と論理構造化層を分離する**（検討資料 §4）。extract.pdf ワーカーが
   pdfplumber で文字・座標・フォント・色・太字/斜体・線・矩形・画像・リンクを取得し、
   pypdfium2 でページPNG（144dpi相当、幅上限4000px）をレンダリングする。
2. **最初に生成するのは抽出データではなく「抽出領域候補」**（検討資料 §5〜6）。
   `pdf_extraction_draft`（schema 2.5.0）に物理モデルと領域候補を②正本と分離して保持する。
   領域候補は uid・ページ・bbox（PDFポイント、左上原点）・種別・信頼度・検出根拠・
   読み順・採否・キャプション関連（caption_of）・表データを持つ。
3. **候補UIDはLocal BackendがUUIDv7で採番**し、ワーカー内キー（candidate_key）の参照を
   保存時に差し替える（Excel P5-19 と同じ方針）。
4. **ルールベース候補生成**（検討資料 §8）: 行・段落グルーピング（ベースライン・行間・
   同一スタイル）、本文フォント中央値との比較とナンバリングによる見出し（レベルはサイズ
   降順）、行頭記号によるリスト、罫線格子による表（セル2次元配列付き）、埋込み画像と
   ベクター描画集中による図、図表番号キーワード近接によるキャプション、複数ページ同位置
   繰り返しによるヘッダ・フッタ・ページ番号・ロゴ（装飾）。
5. **不要要素は非破壊除外**（検討資料 §9）: header / footer / page_number / decoration は
   review_status='rejected' を既定とし、確定時に②へ変換しない。ユーザーは採用へ戻せる。
6. **読み順**（検討資料 §10）: 単段は上→下・左→右、二段組検出時は全幅要素で区切った
   区間ごとに左列→右列。ユーザーがレビューで調整できる。
7. **領域単位の部分再解析**（検討資料 §7.4/§14）: extract.pdf.region ワーカーコマンドで
   指定領域だけの表再解析（罫線→テキスト整列フォールバック）・テキスト再抽出・画像切出し
   （crop）を行う。文書全体は再解析しない。
8. **ライセンス**（検討資料 §22）: pdfplumber(MIT) + pdfminer.six(MIT) + Pillow(MIT-CMU) +
   pypdfium2(Apache-2.0/BSD-3) のみ。AGPL（pymupdf）を採用しない。TBD-01 の
   「開発版 pymupdf・商用版で差替え」は「pypdfium2 で統一（差替え不要）」へ更新する。
9. **安全対策**（検討資料 §23）: PDF内 JavaScript・埋込みファイルを実行しない。外部リンクへ
   アクセスしない。暗号化PDFはエラーにする。ファイル256MB・300ページ・ページ2万語・
   描画3000要素・表5000セル・画像幅4000pxの上限で打ち切り、警告として保持する。
10. **確定→②変換**は採用（approved）領域だけを既存 `storeExtractionResult` へ渡し、
    `source_location.page_no_start/end` と `bbox_json` で原PDFページ・座標トレースを保持する。
11. **LLM支援は候補生成段階に限定**（検討資料 §16）: 物理ブロックを渡して分類・結合・分割を
    提案させる方式を基本とし、生成座標はブロック境界へスナップする。OCRは Vision対応LLMで
    選択領域の画像から行う（EXT-030。専用OCRエンジンは使用しない）。LLM出力は自動確定しない。

## 2. 実装フェーズ

### P5-20A 物理抽出・ドラフト・ルール候補（ワーカー+Backend）

- workers/python/commands/pdf.py: extract.pdf / extract.pdf.region
- workers/python/requirements.txt 新設（初のワーカー実行時依存。導入は
  `python -m pip install -r workers/python/requirements.txt`。未導入環境では明確なエラー）
- schema 2.5.0: pdf_extraction_draft
- backend/extract/pdf-draft-service.ts: storePdfDraft / getPdfDraft / savePdfRegions /
  applyPdfRegionReanalysis / textInRegion
- API: pdfDraft.get / getPageImage / saveRegions / reanalyzeRegion、document.extract の pdf 分岐

### P5-20B オーバーレイレビューEditor

- pdf-draft:// URI の PdfExtractionEditor: ページ画像上の領域オーバーレイ、ズーム、
  ページ切替、追加・削除・移動・リサイズ・種別変更・採否、詳細ペイン、表データ表示、警告

### P5-20C 確定→②変換・トレース

- confirmPdfDraft: 採用領域→ExtractionElement 変換（heading/text/list/table/figure/caption/
  formula。除外系は変換しない）、図領域のページ画像切出し→blob化、
  source_location（page + bbox_json）による双方向トレース、確定後の候補再表示

### P5-20D LLM支援・Vision OCR

- 選択領域の物理ブロックによる分類・結合・分割候補（検討資料 §16.3 方式）
- 選択領域画像の Vision LLM による OCR・表OCR・数式LaTeX化候補（EXT-030）
- 既存 prepareLlm / runConfirmed / 送信前確認 UI パターンへ相乗り

## 3. 明示的な未対応（検討資料の後続段階）

- 数式領域のルールベース自動検出（EXT-027の一部。手動種別変更とVision OCR(formula)で代替）
- EXT-031 のレビュー用/LLM入力用Markdown再生成は既存の共通生成器（extracted.getMarkdown）へ
  相乗りしており、PDF固有要素（ページ座標注記等）の出力検証は未実施
- EXT-032/033 の相互同期は領域一覧⇔オーバーレイ選択・表エディタ・警告表示まで。
  文書全体プレビュー切替・LLM実行ログの同一画面同期表示は未対応（LLMログはPanel側で参照）
- 文字化けした埋込みテキストを持つ領域へOCR適用した場合、bbox変更で保存すると
  manual_text が優先されるが、manual_text 未適用のままでは物理テキストが優先される

- 抽出ルールプロファイル・組織/文書様式単位のルール再利用（検討資料 §18、第二段階）
- 改訂版PDFへの領域再適用・差分識別（検討資料 §15、第三段階。Excel P5-19E 相当の
  再取込差分・UID継承を含む）
- 領域操作の詳細履歴 pdf_region_revision（検討資料 §19。現状は candidate_status と
  ドラフト updated_at のみ）
- 段階別キャッシュ（検討資料 §14。部分再解析は都度実行）
- 図内部の構造化（ノード・エッジ抽出、検討資料 §11.3/第五段階）。図中文字は物理ブロック
  として保持済み
- 罫線のない表の自動候補化（部分再解析のテキスト整列フォールバックのみ。第一弾では
  誤検出リスクを許容しない）
- 複数ページにまたがる表・段落の連結（continues_to）
- 縦書き・多段組（3段以上）・回転ページの読み順（回転ページは警告を保持）
- パスワード保護PDF（エラーとして扱う）
- スキャンPDFの全文OCR（テキストレイヤなし警告のみ。領域単位の Vision OCR は P5-20D）

未対応情報は成功扱いで消さず、review_hints.warnings としてユーザー確認へ残す。
