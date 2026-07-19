# P5-17 Word文書情報抽出の高度化

対象要求: EXT-042〜047
設計: `docs/sdd_word_extraction.md`

## 完了範囲

- [x] `numbering.xml` に基づくリスト種別、階層、開始番号、番号書式の保持
- [x] Run直接書式（太字、下線、取消線、色、蛍光等）の保持
- [x] DrawingML/VMLの図形、図形内段落、グループ、明示コネクタの抽出
- [x] AlternateContentの重複防止
- [x] header/footer/footnote/endnote、フィールド、コメント、変更履歴の抽出
- [x] Part/Relationship inventory、Raw XML、未対応要素レポート
- [x] ZIP/XML安全上限と外部参照非アクセス
- [x] 後方互換テストと機能別DOCX試験データ

## 見送り

- [ ] SmartArt、チャート、OLE、OMML、コンテンツコントロールの意味モデル化
- [ ] スタイル／テーマ継承を解決した有効書式
- [ ] コメント返信／解決状態、改訂の変更前後ビュー
- [ ] コネクタnative IDから抽出UIDへの解決
- [ ] 全DrawingML/VML図形属性とグループ座標変換
- [ ] ZIP圧縮率、OSレベル時間／メモリ制限、マルウェアスキャン

見送り項目もPart inventory、Raw XML、未対応要素レポートで欠落を可視化する。
