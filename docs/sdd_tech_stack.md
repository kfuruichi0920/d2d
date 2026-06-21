# D2D 技術スタック選定書

## 1. 目的

本書は、D2D で使用するライブラリ・フレームワーク・ツールを選定し、採用理由とライセンスを記録する。SRS NFR-040〜044（商用利用・ライセンス管理）の根拠文書でもある。

---

## 2. デスクトップシェル

| 種別 | 選定 | バージョン | ライセンス | 採用理由 |
| --- | --- | --- | --- | --- |
| デスクトップシェル | Electron | 30+ | MIT | Windows/macOS/Linux 対応、Node.js 統合、Web 技術の再利用 |
| ビルドツール | electron-vite | latest | MIT | Vite ベース高速 HMR、Electron IPC 設定を統合 |
| パッケージング・配布 | electron-builder | latest | MIT | Windows インストーラ生成、コード署名対応 |

---

## 3. フロントエンド（renderer process）

| 種別 | 選定 | バージョン | ライセンス | 採用理由 |
| --- | --- | --- | --- | --- |
| UI フレームワーク | React | 19 | MIT | 大規模 UI の再利用性、エコシステムの豊富さ |
| 言語 | TypeScript | 5.x | Apache 2.0 | 型安全性、IDE サポート、リファクタリング容易性 |
| スタイリング | Tailwind CSS | 3.x | MIT | ユーティリティクラスによるデザイントークン管理 |
| UI コンポーネント | shadcn/ui | latest | MIT | Radix UI ベース、アクセシビリティ対応、コピー＆カスタマイズ形式 |
| テキスト・コードエディタ | Monaco Editor | 0.46+ | MIT | VSCode 同等エディタ、Markdown / JSON / PlantUML 対応、diff エディタ内蔵 |
| グリッド・表 | TanStack Table | v8 | MIT | 仮想スクロール対応、ヘッドレス設計で自由なスタイリング可 |
| 仮想スクロール | TanStack Virtual | v3 | MIT | 大量行リストの 60fps 表示（SRS NFR-001） |
| グラフ描画 | Cytoscape.js | 3.x | MIT | 関係グラフ・影響分析の可視化、各種レイアウトアルゴリズム内蔵 |
| クライアント状態管理 | Zustand | 4.x | MIT | 軽量、スライス構成しやすい、React 外からも利用可 |
| ルーティング | TanStack Router | v1 | MIT | 型安全ルーティング、ファイルベースルート対応 |

---

## 4. バックエンド（main process / Node.js）

| 種別 | 選定 | バージョン | ライセンス | 採用理由 |
| --- | --- | --- | --- | --- |
| SQLite アクセス | better-sqlite3 | 9.x | MIT | 同期 API、高速、Electron main process に最適 |
| APIキー・機密情報保管 | keytar | 7.x | MIT | OS キーチェーン利用（Windows: DPAPI、macOS: Keychain、Linux: Secret Service）。SRS CORE-045 / NFR-020 対応 |
| ファイルハッシュ | Node.js crypto（built-in） | - | - | SHA-256 による原本同一性確認（SRS IMP-008） |
| ZIP 操作 | adm-zip | 0.5+ | MIT | ZIP 生成・展開（SRS DATA-030〜033） |
| Git 操作 | simple-git | 3.x | MIT | Git 履歴・diff の読み取り専用参照（SRS GIT-001〜002）。コミットは行わない |

---

## 5. Python ワーカー（文書抽出）

ワーカーは `sdd_function_architecture.md` §11 の stdin/stdout JSONL プロトコルで Electron main process と通信する。

| 種別 | 選定 | バージョン | ライセンス | 採用理由 |
| --- | --- | --- | --- | --- |
| Python ランタイム | Python | 3.11+ | PSF License | 安定版、型ヒント充実 |
| Word 抽出 | python-docx | 1.x | MIT | .docx の段落・表・図・スタイル抽出（SRS IMP-001, EXT-001〜009） |
| Excel 抽出 | openpyxl | 3.x | MIT | .xlsx のセル・シート・結合セル抽出（SRS IMP-002, EXT-009） |
| PowerPoint 抽出 | python-pptx | 0.6+ | MIT | .pptx のスライド・図形・テキストボックス抽出（SRS IMP-003, EXT-010） |
| PDF 抽出（標準） | pdfplumber | 0.10+ | MIT | テキスト・表・ページ座標抽出（SRS IMP-005, EXT-012） |
| PDF 抽出（高精度補助） | pymupdf (fitz) | 1.23+ | **AGPL 3.0 / 商用ライセンス** | **(要審査)** 複雑 PDF の高精度抽出が必要な場合のみ採用。AGPL のため商用配布には商用ライセンス購入が必要 |
| Visio 抽出 | python-vsdx | 0.5+ | MIT | .vsdx の図形・接続・ラベル抽出（SRS IMP-004, EXT-011） |

> **pymupdf の扱い**: デフォルトでは採用しない。pdfplumber で対応できない場合のみ採用を検討し、商用ライセンスを購入するか pdfminer.six（MIT）への代替を検討する。

---

## 6. LLM クライアント（main process）

| Provider | 選定 | バージョン | ライセンス | 採用理由 |
| --- | --- | --- | --- | --- |
| OpenAI / Azure OpenAI | openai（Node.js SDK） | 4.x | MIT | OpenAI・Azure OpenAI 両対応（SRS LLM-001, LLM-004） |
| Gemini | @google/generative-ai | 0.x | Apache 2.0 | Gemini API 公式 SDK（SRS LLM-002） |
| Ollama | HTTP fetch（built-in） | - | - | Ollama は REST API のみで SDK 不要（SRS LLM-003） |

---

## 7. テスト

| 種別 | 選定 | バージョン | ライセンス | 用途 |
| --- | --- | --- | --- | --- |
| ユニット・統合テスト | Vitest | 1.x | MIT | 高速、TypeScript ネイティブ、Node.js API テスト |
| E2E テスト | Playwright | 1.x | Apache 2.0 | Electron 対応、クロスプラットフォーム UI テスト |

---

## 8. ライセンス審査チェックリスト

SRS NFR-040〜044 に対応する商用配布可否の確認。

| ライブラリ | ライセンス | 商用配布 | 対処事項 |
| --- | --- | --- | --- |
| Electron | MIT | ○ | |
| React, shadcn/ui, Zustand | MIT | ○ | |
| TypeScript | Apache 2.0 | ○ | |
| Tailwind CSS | MIT | ○ | |
| Monaco Editor | MIT | ○ | |
| TanStack Table / Virtual / Router | MIT | ○ | |
| Cytoscape.js | MIT | ○ | |
| better-sqlite3 | MIT | ○ | |
| keytar | MIT | ○ | |
| adm-zip, simple-git | MIT | ○ | |
| openai SDK | MIT | ○ | |
| @google/generative-ai | Apache 2.0 | ○ | |
| python-docx, openpyxl, python-pptx | MIT | ○ | |
| pdfplumber | MIT | ○ | |
| python-vsdx | MIT | ○ | |
| Vitest | MIT | ○ | |
| Playwright | Apache 2.0 | ○ | |
| **pymupdf (fitz)** | **AGPL 3.0** | **要確認** | 採用する場合は商用ライセンス購入または MIT 代替（pdfminer.six）に切替 |
| electron-builder | MIT | ○ | ビルド時のみ使用 |

> **フォント・テンプレート**: アプリに同梱するフォントは OFL（SIL Open Font License）または MIT のものに限定する（SRS NFR-044）。
