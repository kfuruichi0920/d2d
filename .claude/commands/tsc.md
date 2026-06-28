---
description: TypeScript の型チェックを実行し、エラーを整理して報告する
---

## 手順

1. `npx tsc --noEmit` を実行する

2. エラーがなければ「型エラーなし ✅」と報告して終了

3. エラーがある場合：
   - ファイルごとにエラーをグループ化して表示
   - 各エラーの原因を一行で説明
   - 修正方針を提示する（修正するかどうかはユーザーに確認）

4. よくある原因のチェックリスト：
   - `d2d-api.ts` の型と `preload/index.ts` のブリッジが一致していない
   - `electron/main/` の関数が返す型と IPC ハンドラの型が合っていない
   - `EntityType` のキャストが不正確
   - `IntermediateItemRow` 等に `code`/`title` フィールドが不足
