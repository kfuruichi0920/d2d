# third_party — 配布同梱物の配置場所（P14-5）

D2D のインストーラへ同梱する外部ツールをこのディレクトリへ配置する。
バイナリ本体は Git 管理外（`.gitignore`）で、この README と配置規約だけをコミットする。
配置状況は `node scripts/prepare-dist.mjs` で検査できる（欠けている任意コンポーネントは
該当機能だけが無効になり、インストーラ生成自体は可能）。

開発時も同じレイアウトをリポジトリ直下の `third_party/` に置けば、設定なしで
PlantUML レンダリングや MeCab 検索を利用できる（`backend/runtime-paths.ts` が解決）。

## 配置規約

| コンポーネント  | 配置先                                         | 用途 / 備考                                                                              |
| --------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------- |
| PlantUML jar    | `third_party/plantuml/plantuml.jar`            | モデル図レンダリング（FORM-001）。GPL 版（TBD-02 決定）。<https://plantuml.com/download> |
| Java ランタイム | `third_party/jre/bin/java(.exe)` ほか JRE 一式 | PlantUML 実行用。Temurin 等の再配布可能な JRE（jlink 最小構成可）                        |
| Graphviz        | `third_party/graphviz/bin/dot(.exe)` ほか一式  | PlantUML の一部図種が依存。`GRAPHVIZ_DOT` で PlantUML へ連携される                       |
| MeCab           | `third_party/mecab/bin/mecab(.exe)` ほか一式   | 検索の分かち書き（TBD-03 決定: MeCab + UniDic）                                          |
| UniDic 辞書     | `third_party/mecab/unidic/`                    | MeCab 用辞書。再配布条件の確認は P14-4                                                   |

## ライセンス上の注意（NFR-040〜044）

- PlantUML（GPL 3.0）・Graphviz（EPL）・MeCab（BSD/LGPL/GPL の三択、BSD 条件で利用）・
  UniDic（BSD 等、版により異なる）は **ツールとして同梱** し、D2D 本体とはプロセス境界で分離する。
- 同梱時は各コンポーネントのライセンス文書を同じディレクトリへ含めること。
- 商用版（P14-6）では構成を再審査する。依存一覧の出力は `npm run licenses:report`。
