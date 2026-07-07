# D2D TBD管理台帳

## 1. 目的

本書は、D2D の要求仕様書・設計書群に残存する未解決の設計判断（TBD）を一元管理する台帳である。各TBDには決定期限と決定者を割り当て、決定後は該当文書へ反映のうえ本台帳の状態を更新する。

運用ルール:

1. 新しいTBDが発生した場合、本台帳へ追記し、該当文書からは `TBD-xx` で参照する。
2. 決定した場合、状態を「決定済」に変更し、決定内容と反映先を記録する。行は削除しない。
3. 状態が「未決」のまま決定期限を超過したTBDは、設計レビューで扱いを再判断する。

## 2. TBD一覧

| TBD-ID | 項目 | 該当文書・箇所 | 影響 | 決定期限 | 決定者 | 状態 | 決定内容 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| TBD-01 | pymupdf の採否（AGPL / 商用ライセンス購入 / pdfminer.six 代替） | `sdd_tech_stack.md` 5.1 | 商用配布ライセンス（NFR-040〜041） | （早期に決定） | プロジェクトオーナー | 決定済（2026-07-08） | pymupdf を採用する（AGPL）。ツール完成後、商用利用向け版（商用ライセンス購入または代替ライブラリへの差し替え）を別途作成する。反映先: `sdd_tech_stack.md` 5.1・8章、`tasks/task_breakdown.md` P5-10・P14-6 |
| TBD-02 | PlantUML のライセンス形態（GPL既定 / MIT限定ビルド等）と配布方式、Javaランタイム・Graphviz依存の扱い | `sdd_tech_stack.md` 4章・8章 | 商用配布ライセンス、実行環境前提（NFR-040〜041、FORM-001） | （早期に決定） | プロジェクトオーナー | 決定済（2026-07-08） | GPL版 PlantUML をツールとして利用する。Javaランタイムおよび Graphviz モジュールも同梱して配布する。反映先: `sdd_tech_stack.md` 4章・8章、`tasks/task_breakdown.md` P10-3・P14-5 |
| TBD-03 | MeCab辞書の選定（IPADIC / UniDic 等）と再配布条件、専門用語辞書の運用 | `sdd_tech_stack.md` 4章・8章、`sdd_data_structure.md` 10.3 | 商用配布ライセンス、検索精度 | 実装設計開始まで | プロジェクトオーナー | 決定済（2026-07-08） | 標準構成を MeCab + UniDic とする。辞書自体はユーザが追加可能とする（追加辞書登録機構を設ける）。反映先: `sdd_tech_stack.md` 4章・8章、`tasks/task_breakdown.md` P11-1 |
| TBD-04 | `resource_list_item` / `resource_table_cell` の別テーブル分割 | `sdd_data_structure.md` 4.6.3・4.6.5 | DBスキーマ（マイグレーション影響が大きいため早期決定） | （早期に決定） | プロジェクトオーナー | 決定済（2026-07-08） | `resource_list_item` / `resource_table_cell` は別テーブルとして分割する。反映先: `sdd_data_structure.md` 4.6.3・4.6.5、`tasks/task_breakdown.md` P1-1 |
| TBD-05 | 読み順の同一行判定閾値の既定値（PowerPoint / PDF 抽出） | `sdd_function_architecture.md` 11.4.3・11.5.3 | 抽出品質。設定化済みのため既定値のみ決定 | 抽出ワーカー実装まで | プロジェクトオーナー | 決定済（2026-07-08） | 同一行判定の閾値は設定化し、ユーザ設定変更により読み順・Markdownを再生成可能とする。初期既定値は 0.2 行程度を目安とする。反映先: `sdd_function_architecture.md` 11.4.3・11.5.3、`tasks/task_breakdown.md` P5-8・P5-10 |
| TBD-06 | マイグレーションの上位桁更新条件、DDL適用順、バックアップ手順の詳細 | `sdd_data_structure.md` 10.4 | 運用・データ保全 | 実装設計開始まで | 未定 | 未決 | ― |
| TBD-07 | GraphDB（Neo4j 等）移行および Graph RAG 導入の判断 | `srs.md` DATA-011、`sdd_function_architecture.md` 5.2、`sdd_data_structure.md` | 将来拡張。現行は SQLite 再帰CTEで確定 | 実測で性能問題が顕在化した時点 | 未定 | 未決 | ― |
| TBD-08 | 同時編集時のコード採番競合への対応（現状は単一利用者前提・運用でカバー） | `sdd_data_structure.md` 2.6・9章 | マルチユーザー化時のDB採番制御 | 複数プロセス同時編集をサポートする判断時 | 未定 | 未決 | ― |
