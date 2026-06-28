# D2D プロジェクト — Claude コンテキスト

## プロジェクト概要

D2D（Document to Design）は Electron 35 + React 19 + TypeScript デスクトップアプリ。
仕様書・設計書などのドキュメントを取り込み、以下の **4階層データ** に変換する。

| 階層 | 概要 | 主テーブル |
| --- | --- | --- |
| ①原本 | 取り込んだ原本ファイル | `source_document`, `blob_resource` |
| ②抽出 | ファイル単位の構造化抽出結果 | `extracted_document`, `extracted_item` |
| ③中間 | 成果物単位の統合・整理データ | `intermediate_document`, `intermediate_item` |
| ④設計モデル | 設計リソース + トレース関係 | `entity_registry`, `resource_*`（16種）, `trace_link` |

---

## アーキテクチャ

```
renderer (React)  ←IPC→  main (Node.js)  ←subprocess→  Python worker
        ↑                       ↑
   contextBridge            better-sqlite3
   (window.api.*)          (project.db)
```

- **Renderer**: UIのみ。DB直アクセス禁止。`window.api.*` 経由でのみデータ取得。
- **Main**: IPC ハンドラ（薄い層）+ 業務ロジック（`electron/main/<domain>/`）
- **Preload**: `contextBridge` で `window.api` を安全に公開。型は `D2DApi` インターフェース。
- **Python worker**: stdin/stdout JSONL プロトコル。抽出処理を担当。

---

## IPC エンドポイントの追加パターン（最重要）

新ドメイン `foo` を追加する場合、以下 **4ファイル** を必ず連動して変更する。

### 1. 業務ロジック
`electron/main/foo/foo-manager.ts`
```typescript
import { getDatabase } from '../db/database'
export function listFoos(): FooRow[] {
  return getDatabase().prepare(`SELECT ...`).all() as FooRow[]
}
```

### 2. IPC ハンドラ
`electron/main/ipc/handlers/foo.ts`
```typescript
import { ipcMain } from 'electron'
import { listFoos } from '../../foo/foo-manager'
export function registerFooHandlers(): void {
  ipcMain.handle('foo:list', () => listFoos())
}
```

### 3. IPC 登録
`electron/main/ipc/index.ts` に追加:
```typescript
import { registerFooHandlers } from './handlers/foo'
// registerAllIpcHandlers() 内に追加:
registerFooHandlers()
```

### 4. Preload ブリッジ
`electron/preload/index.ts` の `api` オブジェクトに追加:
```typescript
foo: {
  list: () => ipcRenderer.invoke('foo:list'),
},
```

### 5. 型定義
`src/types/d2d-api.ts` に追加:
```typescript
export interface FooRow { uid: string; title: string }
// D2DApi インターフェース内に:
foo: { list: () => Promise<FooRow[]> }
```

---

## データベース規約

- **`entity_registry`**: 全エンティティの共通台帳。`uid`（UUIDv7）, `entity_type`, `code`, `title`, `status`, `created_at`
- **全エンティティ作成**: `createEntityEntry({ entityType, code, title })` を使う（`electron/main/store/entity-registry.ts`）
- **コードカウンタ**: `entity_registry` の COUNT で次番号を決める。UIDは `uuid.v7()` で生成。
- **トランザクション**: 複数テーブル更新は必ず `withTransaction(() => { ... })` で囲む
- **同期API**: `better-sqlite3` は同期。async/await 不要。

---

## UI ライブラリ

- **Serendie Design System**: `@serendie/ui`（`@ark-ui/react` ベース）+ `@serendie/design-token` + `@serendie/symbols`
- Tailwind CSS / shadcn/ui は**未導入**
- **状態管理**: Zustand 5.x（`src/stores/`）
- **ルーティング**: TanStack Router v1（`src/pages/` に各ページ）
- **テーブル**: TanStack Table v8 + TanStack Virtual v3

### Renderer の重要パターン

```typescript
// NG: オブジェクトを state に持つと無限ループの原因
const [selectedDoc, setSelectedDoc] = useState<DocRow | null>(null)

// OK: UIDだけを state に持ち、オブジェクトは find() で派生
const [selectedUid, setSelectedUid] = useState<string | null>(null)
const selectedDoc = docs.find(d => d.uid === selectedUid) ?? null

// データ取得コールバックは必ず useCallback([]) で安定化
const loadDocs = useCallback(async () => {
  const result = await window.api.foo.list()
  setDocs(result)
}, [])

useEffect(() => { loadDocs() }, [loadDocs])

// selectedUid が変わったときだけ詳細を再取得
useEffect(() => {
  if (!selectedUid) return
  window.api.foo.get(selectedUid).then(setDetail)
}, [selectedUid])
```

---

## Python ワーカー

- **プロトコル**: stdin → 1行 JSON、stdout → 改行区切り JSONL（progress / result / error）
- **コマンド追加**:
  1. `workers/python/commands/<name>.py` に `def run(job_id, params, emit): ...` を実装
  2. `workers/python/main.py` の `COMMANDS` dict に登録
- **開発時 Python**: `.env` の `D2D_PYTHON=/path/to/python` → `electron/main/workers/` が読み込む
- **本番**: `workers/python/dist/d2d-worker.exe`（PyInstaller ビルド済み）
- **文字コード**: stdout は `io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')` で強制

---

## ビルド・型チェック

```bash
# TypeScript 型チェック（エラーがないことを確認してからコミット）
npx tsc --noEmit

# 開発起動
npm run dev

# プロダクションビルド
npm run build
```

---

## タスク管理

`docs/tasks.md` でタスクを管理。フォーマット:
- `⏸` 未着手 → `✅ YYYY-MM-DD` 完了
- フェーズごとに完了数/合計を更新
- ヘッダの「N回目更新」とトータル完了数も更新

---

## 重要ファイルマップ

| ファイル | 役割 |
| --- | --- |
| `electron/main/db/schema/v1.0.0.sql` | SQLite スキーマ定義 |
| `electron/main/store/entity-registry.ts` | `createEntityEntry()` / `EntityType` 型 |
| `electron/main/store/store-access.ts` | `withTransaction()` / `getDatabase()` |
| `electron/main/ipc/index.ts` | 全ハンドラ登録エントリポイント |
| `electron/preload/index.ts` | `window.api` ブリッジ全定義 |
| `src/types/d2d-api.ts` | Renderer 用 IPC 型定義 |
| `workers/python/main.py` | Python ワーカーエントリポイント |
| `workers/python/commands/` | 各コマンドハンドラ |
| `docs/tasks.md` | タスク管理 |
| `docs/sdd_tech_stack.md` | 技術スタック選定書 |
| `docs/sdd_function_architecture.md` | 機能構成設計書 |
| `docs/sdd_directory.md` | ディレクトリ構成設計書 |

---

## よくある失敗パターン（要注意）

1. **`entity_registry` JOINを忘れる**: `extracted_item` 等は `title`/`code` を `entity_registry` から取得する必要がある
2. **NOT NULL 制約**: `resource_figure.image_uri`, `resource_text.text_body` 等は空文字でも必須
3. **`promoteFromExtracted` のカウンタ**: `inserted++` は `createEntityEntry` の**前**に行う
4. **renderer での store 直接アクセス**: `window.api.store.query()` / `window.api.store.execute()` が使える
5. **`EntityType` キャスト**: `as EntityType` の代わりに `import { type EntityType }` してキャスト
