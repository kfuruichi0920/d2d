---
description: 新しいレンダラーページを作成し、ワークベンチ・ルーティングと接続する
---

引数 `$ARGUMENTS` をページ名（PascalCase、例: `TraceMatrix`）として扱う。

## 手順

1. **`src/pages/<Name>Page.tsx` を新規作成**

   既存ページ（例: `IntermediatePage.tsx`）のパターンを参考に：
   - `import React, { useCallback, useEffect, useState } from 'react'`
   - プロジェクトが開かれていない場合のガード（`window.api.project.getCurrent()` で確認）
   - データ取得は `useCallback(async () => {...}, [])` + `useEffect(() => { load() }, [load])`
   - `selectedUid: string | null` パターンを使う（直接オブジェクトを state に持たない）
   - Serendie UI コンポーネント（`@serendie/ui`）を使用

2. **ルーティング設定を確認・追加**
   - TanStack Router のルート定義を調べ、新ページを登録する

3. **ワークベンチのナビゲーション追加（必要な場合）**
   - `src/components/workbench/` 配下のナビゲーション定義に追加
   - アイコンは `@serendie/symbols` から選択

4. **型チェック**
   ```bash
   npx tsc --noEmit
   ```

## 注意

- 大量データは仮想スクロール（TanStack Virtual）を使う
- テーブルは TanStack Table v8 を使う
- グラフ描画が必要な場合は Cytoscape.js（将来実装）を想定したインターフェース設計にする
