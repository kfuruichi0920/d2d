# workers/python — D2D Python ワーカー

Local Backend（Electron utilityProcess）からサブプロセスとして起動される抽出ワーカー。
stdin/stdout の JSONL プロトコルで通信する（`backend/workers/worker-runner.ts`、
sdd_function_architecture §11）。

## セットアップ

### 1. 実行時依存のインストール（PDF 抽出を使う場合のみ）

Word / Excel 抽出は標準ライブラリのみで動作するため、追加インストールは不要。
**PDF 抽出（`extract.pdf`）だけ** サードパーティ依存（pdfplumber、pypdfium2。いずれも
MIT / Apache-2.0 系で AGPL 依存なし）が必要になる。

D2D が実際に起動する Python（後述）に対してインストールする。

```bash
python -m pip install -r workers/python/requirements.txt
```

### 2. D2D が使う Python の指定

D2D は次の順で Python を解決する（`backend/runtime-paths.ts` `resolveWorkerLaunch()`）。

1. 環境変数 `D2D_PYTHON` が設定されていればそのパスを使用
2. 未設定なら PATH 上の `python`（Windows）/ `python3`（他 OS）

PATH 先頭の `python` に pip が無い、または別の Python 環境へ依存を入れた場合は、
**その Python へインストールし、かつ同じパスを `D2D_PYTHON` に設定する**。

```powershell
# 例: PATH 先頭が pip の無い venv で、pip 入りの miniconda を使う場合
C:\path\to\miniconda3\python.exe -m pip install -r workers/python/requirements.txt

$env:D2D_PYTHON = 'C:\path\to\miniconda3\python.exe'
```

`D2D_PYTHON` は、D2D アプリ本体の起動・`npm run dev`・E2E（`npx playwright test`）・
`node dev-process/verify.mjs --e2e` など、ワーカーを実際に起動するすべてのコマンドの前で
設定しておく必要がある。未設定のままだと PATH の `python` を探しに行き、そこに pip が無い
（＝依存をインストールした環境と一致しない）場合は `extract.pdf` がエラーになる。

### 3. pytest 用の依存（開発者向け）

ユニットテスト（`pytest`）実行用の依存は別ファイル。

```bash
python -m pip install -r workers/python/requirements-dev.txt
```

## 使い方

### テスト実行

```bash
cd workers/python
python -m pytest -q
```

PDF 抽出のテスト（`tests/test_pdf_extract.py`）は pdfplumber / pypdfium2 が未導入の環境では
自動的にスキップされる（`unittest.skipUnless`）。実際に検証するには手順1のインストールが必要。

### コマンド一覧

`main.py` の `COMMANDS` が対応コマンド。Local Backend からは `command` フィールドで指定される。

| コマンド              | 内容                                                     | 実装             |
| --------------------- | -------------------------------------------------------- | ---------------- |
| `worker.ping`         | 疎通確認                                                  | `main.py`         |
| `extract.word`        | Word (.docx) 抽出                                         | `commands/word.py` |
| `extract.excel`       | Excel (.xlsx) 物理抽出・候補生成                            | `commands/excel.py` |
| `extract.pdf`         | PDF 物理抽出・ページ画像レンダリング・抽出領域候補生成          | `commands/pdf.py` |
| `extract.pdf.region`  | PDF 領域単位の部分再解析（表 / テキスト / 画像切出し）        | `commands/pdf.py` |

### 検証用フィクスチャの生成

各形式のテストは `.docx` / `.xlsx` / `.pdf` を外部ツール無しでスクリプト生成する
（`tests/make_docx.py` / `tests/make_xlsx.py` / `tests/make_pdf.py`）。単体で実行して
サンプルファイルを作ることもできる。

```bash
python workers/python/tests/make_pdf.py sample.pdf
```

## パッケージング（配布用ビルド）

```bash
npm run package:worker
```

PyInstaller で `d2d-worker(.exe)` を生成する（P14-5、詳細は `docs/sdd_tech_stack.md` §5.4）。
パッケージ後は Python 不要でワーカー単体で起動する。

## 関連ドキュメント

- `dev-process/STATE.md`「恒久制約」「E2E の注意」節: このマシンでの `D2D_PYTHON` 設定例など
- `tasks/P5-20-pdf-extraction.md`: PDF 抽出候補フローの設計方針・実装フェーズ・未対応事項
- `docs/tbd_register.md` TBD-01: PDF 解析ライブラリの採否・ライセンス判断の経緯
