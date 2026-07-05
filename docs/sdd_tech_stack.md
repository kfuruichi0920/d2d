# D2D 技術スタック選定書

## 1. 目的

本書は、D2D で使用するライブラリ・フレームワーク・ツールを選定し、採用理由とライセンスを記録する。SRS NFR-040〜044（商用利用・ライセンス管理）の根拠文書でもある。

---

## 2. デスクトップシェル

| 種別 | 選定 | バージョン | ライセンス | 採用理由 |
| --- | --- | --- | --- | --- |
| デスクトップシェル | Electron | 35+ | MIT | Windows/macOS/Linux 対応、Node.js 統合、Web 技術の再利用 |
| ビルドツール | electron-vite | 5.x | MIT | Vite ベース高速 HMR、Electron IPC 設定を統合 |
| パッケージング・配布 | electron-builder | 25.x | MIT | Windows インストーラ生成、コード署名対応 |
| ネイティブモジュール再ビルド | @electron/rebuild | 4.x | MIT | better-sqlite3 等のネイティブモジュールを Electron の Node.js バージョンに合わせて再コンパイル。`postinstall` スクリプトとして自動実行 |

---

## 3. フロントエンド（renderer process）

| 種別 | 選定 | バージョン | ライセンス | 採用理由 |
| --- | --- | --- | --- | --- |
| UI フレームワーク | React | 19 | MIT | 大規模 UI の再利用性、エコシステムの豊富さ |
| 言語 | TypeScript | 5.x | Apache 2.0 | 型安全性、IDE サポート、リファクタリング容易性 |
| デザインシステム | @serendie/ui | 3.x | MIT | 三菱電機 Serendie Design System の React コンポーネント群（@ark-ui/react ベース） |
| デザイントークン | @serendie/design-token | 1.x | MIT | Serendie カラートークン・タイポグラフィ・スペーシングの CSS 変数定義 |
| アイコン | @serendie/symbols | 1.x | MIT | Serendie Design System 標準アイコン（SRS UI-028） |
| ヘッドレスコンポーネント | @ark-ui/react | 5.x | MIT | @serendie/ui の基盤ライブラリ（アクセシビリティ対応） |
| グリッド・表 | TanStack Table | v8 | MIT | 仮想スクロール対応、ヘッドレス設計で自由なスタイリング可 |
| 仮想スクロール | TanStack Virtual | v3 | MIT | 大量行リストの 60fps 表示（SRS NFR-001） |
| ルーティング | TanStack Router | v1 | MIT | 型安全ルーティング、ファイルベースルート対応 |
| グラフ描画 | SVG 自前実装 | — | — | 関係グラフ・影響分析の可視化。力学レイアウト、階層表示、ホップ距離による強調・減衰表示を SVG + React で自前実装。外部グラフ描画ライブラリは初期導入しない（Cytoscape.js 等は将来移行候補） |
| テキスト・コードエディタ | Monaco Editor | 0.5x | MIT | 設計要素本文、Markdown、PlantUML / SysMLv2、JSON / JSONL、SQL、ログの閲覧・編集に利用する。styled textarea は暫定代替として採用しない |
| Markdownレンダリング | marked | 14.x+ | MIT | 抽出結果、レポート、LLM入力用クリーンMarkdownのプレビューに利用する。HTML混在Markdownはサニタイズ方針を別途実装する |
| クライアント状態管理 | Zustand | 5.x | MIT | 軽量、スライス構成しやすい、React 外からも利用可 |

---

## 4. Local Backend（別プロセス / Node.js）

| 種別 | 選定 | バージョン | ライセンス | 採用理由 |
| --- | --- | --- | --- | --- |
| SQLite アクセス | better-sqlite3 | 12.x | MIT | 同期 API、高速、Local Backend のDBアクセス層に適用。Electron同梱Node.jsと実行Node.jsの差分は @electron/rebuild と起動時検査で扱う |
| APIキー・機密情報保管 | keytar | 7.x | MIT | OS キーチェーン利用（Windows: DPAPI、macOS: Keychain、Linux: Secret Service）。SRS CORE-045 / NFR-020 対応 |
| ファイルハッシュ | Node.js crypto（built-in） | — | — | SHA-256 による原本同一性確認（SRS IMP-008） |
| ZIP 操作 | adm-zip | 0.5+ | MIT | ZIP 生成・展開（SRS DATA-030〜033） |
| Git 操作 | simple-git | 3.x | MIT | Git 履歴・diff の読み取り専用参照（SRS GIT-001〜002）。コミットは行わない |
| UUID 生成 | uuid | 11.x | MIT | UUIDv7 形式の UID 生成（SRS EXT-013） |
| 日本語形態素解析 | MeCab 実行バイナリ + 辞書 | 0.996+ | BSD / GPL / LGPL（採用条件をBSDとして確認） | FTS5登録用の検索本文をアプリ側で分かち書きする。Windows優先で同梱またはインストールパス設定を扱う |

---

## 5. Python ワーカー（文書抽出）

ワーカーは `sdd_function_architecture.md` §11 の stdin/stdout JSONL プロトコルで Local Backend と通信する。Electron Main はワーカーと直接通信しない。

### 5.1 依存ライブラリ

| 種別 | 選定 | バージョン | ライセンス | 採用理由 |
| --- | --- | --- | --- | --- |
| Python ランタイム | Python | 3.11+ | PSF License | 安定版、型ヒント充実 |
| Word 抽出 | Python標準ライブラリ（zipfile + xml.etree.ElementTree） + python-docx補助 | 3.11+ / 1.x | PSF License / MIT | .docx のOpenXMLを直接解析し、見出し、段落、階層リスト、結合表、図、キャプション、脚注、コメント、変更履歴、参照、テキストボックスを抽出する。python-docxは補助用途に限定し、取得できないOpenXML構造は標準ライブラリで直接読む |
| Excel 抽出 | openpyxl | 3.x | MIT | .xlsx のセル・シート・結合セル抽出（SRS IMP-002, EXT-009） |
| PowerPoint 抽出 | Python標準ライブラリ（zipfile + xml.etree.ElementTree） + python-pptx補助 | 3.11+ / 0.6+ | PSF License / MIT | .pptx のスライド、図形、テキストボックス、表、画像、ノート、OpenXML座標・関係情報を抽出する。python-pptxで取得しにくいtheme、rels、grpSp座標、notesSlide、media参照はOpenXMLを直接読む |
| PDF 抽出（標準） | pdfplumber | 0.10+ | MIT | 表bbox、表二次元配列、テキスト、ページ座標抽出（SRS IMP-005, EXT-012, EXT-027〜029） |
| PDF 抽出（高精度補助） | pymupdf (fitz) | 1.23+ | **AGPL 3.0 / 商用ライセンス** | **(要審査)** ページ画像レンダリング、bboxクロップ、画像検出、OCR/LLM補正用切り出しに有効。AGPL のため商用配布には商用ライセンス購入が必要 |
| Visio 抽出 | Python 標準ライブラリ（zipfile + xml.etree.ElementTree） | — | PSF License | .vsdx は ZIP + XML 形式のため、外部ライブラリ不要で解析可能。`python-vsdx` パッケージは PyPI 非公開のため不採用 |

> **pymupdf の扱い**: デフォルトでは採用しない。pdfplumber で対応できない場合のみ採用を検討し、商用ライセンスを購入するか pdfminer.six（MIT）への代替を検討する。

> **PowerPoint抽出設計方針**: スライド一覧、SVG/画像プレビュー、透明な選択レイヤー、要素の除外・役割補正・グループ化、スピーカーノート編集、空間読み順Markdown、スライドoverview PNG、構造JSONを提供する。PowerPoint抽出は外部ワーカーJSONL、ジョブ管理、成果物管理、`extracted_document.structure_json`、`blob_resource`、派生成果物へ分離する。JSZipは標準採用しない。

> **PDF抽出設計方針**: ページ画像+bbox編集、表二次元配列、座標順Markdown、OCR/LLM補正候補、表プレビューを提供する。PDF抽出は外部ワーカーJSONL、ジョブ管理、成果物管理、設定管理、`llm_run_ref` へ分離する。

### 5.2 Python 環境制御

Windows 環境では複数の Python インタープリタが共存するケースがある（システム Python、仮想環境、Miniconda 等）。以下の仕組みで起動する Python を制御する。

| 制御方法 | 内容 |
| --- | --- |
| `D2D_PYTHON` 環境変数 | 開発時に `.env` ファイルへ Python 実行ファイルのフルパスを記載。起動時に `python-worker.ts` が読み込み `process.env.D2D_PYTHON` に注入する |
| デフォルト | `D2D_PYTHON` 未設定時は PATH 上の `python`（Windows）または `python3`（macOS/Linux）を使用 |
| 本番（パッケージ済み） | PyInstaller でビルドされた `d2d-worker.exe` を直接起動するため、Python インタープリタ不要 |

### 5.3 文字コード対応（Windows）

Windows の Python stdout は CP932 がデフォルトであり、日本語が文字化けする。以下の両面で UTF-8 を強制する。

| 対応箇所 | 内容 |
| --- | --- |
| Python 側 | `sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')` |
| Node.js 側（spawn 環境変数） | `PYTHONIOENCODING=utf-8`、`PYTHONUTF8=1` |

### 5.4 本番パッケージング

| 項目 | 内容 |
| --- | --- |
| ビルドツール | PyInstaller（`d2d-worker.spec` で依存モジュールを単一ディレクトリへ収録） |
| 出力先（ビルド） | `workers/python/dist/` |
| 配置先（パッケージ済みアプリ） | `resources/workers/python/`（electron-builder `extraResources` で自動コピー） |
| 実行ファイル名 | `d2d-worker.exe`（Windows）/ `d2d-worker`（macOS/Linux） |

---

### 5.5 仕様書・設計書要素候補生成の技術方針

> **設計方針**: 正規化テキスト生成、設計要素候補、関係候補、保存前の表形式編集、要素名変更時の関係候補追従、関係グラフのフィルタ・レイアウト切替・ホップ強調、AI通信ログを提供する。実装は Local Backend の操作単位API、`entity_registry` / `resource_*` / `trace_link`、SVG + React のTrace Graph、Serendie Symbols、fetchベースLLMプロバイダ、Workbench型UXに統一する。

## 6. LLM クライアント（Local Backend）

すべての Provider は Local Backend の `globalThis.fetch` を用いた HTTP リクエストで実装する。外部 SDK（openai npm、Google Generative AI SDK 等）は**未導入**。初期設定画面は OpenAI / Gemini / Azure OpenAI を対象に含める。

| Provider | エンドポイント形式 | 認証 | 対応要求 |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1/chat/completions` | Bearer token | LLM-001 |
| Gemini | `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` | API Key クエリパラメータ | LLM-002 |
| Ollama | `http://localhost:11434/api/chat`（ローカル） | 不要 | LLM-003, LLM-043 |
| Azure OpenAI | `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version={ver}` | api-key ヘッダ | LLM-004 |

---

## 7. テスト

| 種別 | 選定 | バージョン | ライセンス | 用途 |
| --- | --- | --- | --- | --- |
| ユニット・統合テスト | Vitest | 2.x | MIT | 高速、TypeScript ネイティブ、Node.js API テスト |
| E2E テスト | Playwright | 1.x | Apache 2.0 | Electron 対応、クロスプラットフォーム UI テスト |

---

## 8. ライセンス審査チェックリスト

SRS NFR-040〜044 に対応する商用配布可否の確認。

| ライブラリ | ライセンス | 商用配布 | 対処事項 |
| --- | --- | --- | --- |
| Electron | MIT | ○ | |
| React, Zustand | MIT | ○ | |
| TypeScript | Apache 2.0 | ○ | |
| @serendie/ui, @serendie/design-token, @serendie/symbols | MIT | ○ | |
| @ark-ui/react | MIT | ○ | |
| Monaco Editor | MIT | ○ | 初期実装で採用する |
| Cytoscape.js | MIT | ○ | 現時点未導入。将来導入時も MIT のため問題なし |
| TanStack Table / Virtual / Router | MIT | ○ | |
| better-sqlite3 | MIT | ○ | |
| @electron/rebuild | MIT | ○ | ビルド時のみ使用 |
| keytar | MIT | ○ | |
| adm-zip, simple-git | MIT | ○ | |
| uuid | MIT | ○ | |
| Python標準ライブラリによるWord OpenXML抽出 | PSF License | ○ | .docx はZIP + XMLとして解析する |
| python-docx, openpyxl, python-pptx | MIT | ○ | python-docxはWord抽出の補助用途。PowerPoint抽出ではpython-pptxを補助に使い、OpenXML直接解析と併用する |
| marked | MIT | ○ | Markdownプレビューに利用 |
| pdfplumber | MIT | ○ | |
| Visio 抽出（Python 標準ライブラリ） | PSF License | ○ | |
| Vitest | MIT | ○ | |
| Playwright | Apache 2.0 | ○ | |
| electron-builder | MIT | ○ | ビルド時のみ使用 |
| **pymupdf (fitz)** | **AGPL 3.0** | **要確認** | 採用する場合は商用ライセンス購入または MIT 代替（pdfminer.six）に切替 |

> **フォント・テンプレート**: アプリに同梱するフォントは OFL（SIL Open Font License）または MIT のものに限定する（SRS NFR-044）。
