# D2D — Design to Digital

設計ドキュメントからデジタル設計資産を生成するデスクトップアプリケーション。

## 概要

D2D は Electron ベースのデスクトップツールです。Word・Excel・PowerPoint・PDF・Visio などの既存設計ドキュメントを取り込み、4 階層のデータ変換パイプラインを通じて構造化された設計モデルを生成します。

```
①原本 → ②抽出データ → ③中間データ → ④設計モデル
```

## 主な機能

| 機能 | 説明 |
|------|------|
| 原本取込 | Word / Excel / PowerPoint / PDF / Visio / テキスト系を SHA-256 管理しながら Blob ストアへ取込 |
| 文書抽出 | Python ワーカー（python-docx / openpyxl / python-pptx / pdfplumber）で構造抽出 |
| 中間データ処理 | 複数原本を成果物単位に統合・章構成管理・チャンク化 |
| 設計モデル | 16 種の設計リソース（ラベル・テキスト・図・表・状態遷移など）と相互トレースリンク |
| LLM 支援 | 候補生成・要約・分類・関係候補（外部 LLM API 連携） |
| エクスポート | ZIP アーカイブ / Markdown レポート / DB-to-Text（Git diff 対応） |

## 技術スタック

| 層 | 技術 |
|---|---|
| シェル | Electron 30+ / electron-vite |
| フロントエンド | React 19 / TypeScript / Serendie Design System |
| 状態管理 | Zustand / TanStack Router |
| バックエンド (Main) | Node.js / better-sqlite3（WAL モード） |
| API キー管理 | keytar（OS キーチェーン） |
| 文書抽出 | Python 3.11+ / python-docx / openpyxl / python-pptx / pdfplumber |
| パッケージング | electron-builder（Windows NSIS インストーラー） |

## ディレクトリ構成

```
d2d/
├── electron/
│   ├── main/          # Electron Main プロセス（IPC・DB・ジョブ管理）
│   └── preload/       # contextBridge 定義
├── src/               # Renderer プロセス（React UI）
│   ├── pages/
│   ├── components/
│   ├── stores/
│   └── providers/
├── workers/
│   └── python/        # 文書抽出 Python ワーカー
│       ├── main.py
│       ├── commands/  # extract_word / excel / powerpoint / pdf / visio / text
│       ├── requirements.txt
│       └── d2d-worker.spec  # PyInstaller ビルド設定
└── docs/              # 設計書（SRS / SDD 各種）
```

## プロジェクトデータ構造

実行時に生成されるプロジェクトフォルダ：

```
<project_root>/
├── project.d2d        # プロジェクト定義（JSON）
├── project.db         # SQLite DB（32 テーブル、全設計データ）
├── blobs/
│   └── originals/     # 原本ファイルのコピー（SHA-256 検証用）
├── exports/
│   └── db_to_text/    # Git diff 対応テキスト出力
└── archives/          # ZIP アーカイブ
```

## セットアップ

### 必要環境

- Node.js 20+
- Python 3.11+（文書抽出用）
- Windows 10/11（現在の主要サポート対象）

### インストール

```bash
npm install
```

Python 依存関係：

```bash
cd workers/python
pip install -r requirements.txt
```

### 開発起動

```bash
npm run dev
```

### ビルド

```bash
# TypeScript チェック
npm run typecheck

# プロダクションビルド
npm run build

# Windows インストーラー生成
npm run build:win
```

### Python ワーカー本番ビルド（PyInstaller）

```bash
cd workers/python
pyinstaller d2d-worker.spec
```

生成された `dist/d2d-worker.exe` を `resources/workers/python/` に配置します。

## データ階層

```
①原本 (source_document / blob_resource)
    ↓ Python ワーカーで抽出
②抽出データ (extracted_document / extracted_item)
    ↓ 中間データ処理で統合
③中間データ (intermediate_document / intermediate_item / chunk)
    ↓ 設計編集・LLM支援
④設計モデル (entity_registry + resource_* 16種 + trace_link)
```

## IPC API

Renderer から `window.api.*` 経由でアクセス：

```typescript
window.api.import.document(filePath)        // 原本取込
window.api.extract.document(uid)            // 抽出実行
window.api.intermediate.create(options)     // 中間データ生成
window.api.intermediate.listChunks(uid)     // チャンク一覧
window.api.artifacts.generateArchive()      // ZIP アーカイブ生成
window.api.settings.getApp()               // アプリ設定
window.api.settings.setApiKey(key, value)  // API キー保存（OS キーチェーン）
```

## 設計書

| ドキュメント | 内容 |
|------------|------|
| [srs.md](docs/srs.md) | システム要求仕様書 |
| [sdd_function_architecture.md](docs/sdd_function_architecture.md) | 機能構成詳細設計書 |
| [sdd_data_structure.md](docs/sdd_data_structure.md) | データ構造設計書 |
| [sdd_tech_stack.md](docs/sdd_tech_stack.md) | 技術スタック選定書 |
| [sdd_directory.md](docs/sdd_directory.md) | ディレクトリ構成設計書 |
| [sdd_ui_design.md](docs/sdd_ui_design.md) | UI 設計書 |
| [tasks.md](docs/tasks.md) | 開発タスク管理表 |

## ライセンス

Private — 社内利用のみ
