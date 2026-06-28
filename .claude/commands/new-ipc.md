---
description: 新しい IPC ドメインを end-to-end で作成する（manager → handler → ipc/index → preload → d2d-api.ts）
---

引数 `$ARGUMENTS` を新ドメイン名（スネークケース、例: `glossary`）として扱う。

以下の手順で **5ファイル** を更新する。CLAUDE.md の「IPC エンドポイントの追加パターン」を必ず参照。

## 手順

1. **`electron/main/<domain>/<domain>-manager.ts` を新規作成**
   - `getDatabase()`, `withTransaction()`, `createEntityEntry()` を使う
   - 引数に応じてどのような CRUD 関数が必要か推測し、最低限 list / get / create / delete を実装
   - 型インターフェース（`<Domain>Row` 等）をファイル内に定義する

2. **`electron/main/ipc/handlers/<domain>.ts` を新規作成**
   - `export function register<Domain>Handlers(): void` を定義
   - 各 IPC チャンネル名は `<domain>:list`, `<domain>:get`, `<domain>:create`, `<domain>:delete` 等

3. **`electron/main/ipc/index.ts` に登録を追加**
   - import 文と `register<Domain>Handlers()` 呼び出しを追加

4. **`electron/preload/index.ts` に `<domain>` オブジェクトを追加**
   - `ipcRenderer.invoke('<domain>:...')` のラッパーを `api` オブジェクトに追加

5. **`src/types/d2d-api.ts` に型を追加**
   - `<Domain>Row` インターフェース（または必要な型）を追加
   - `D2DApi` インターフェースに `<domain>` プロパティを追加

完了後、`npx tsc --noEmit` を実行してエラーがないことを確認する。
