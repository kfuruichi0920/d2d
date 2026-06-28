---
description: Python ワーカーに新しいコマンドを追加する（command.py 作成 → main.py 登録）
---

引数 `$ARGUMENTS` をコマンド名（スネークケース、例: `analyze_table`）として扱う。

## 手順

1. **`workers/python/commands/<command>.py` を新規作成**

   以下のテンプレートに従う：
   ```python
   """<command> コマンドの説明"""
   from typing import Callable, Any

   def run(job_id: str, params: dict[str, Any], emit: Callable) -> None:
       """
       params:
         - <param_name>: <type> — <説明>
       """
       try:
           emit(job_id, "progress", percent=0, message="処理開始")
           
           # TODO: 実装
           result = {}
           
           emit(job_id, "result", status="success", output=result)
       except Exception as e:
           emit(job_id, "error", error_code="<COMMAND>_ERROR", message=str(e))
   ```

2. **`workers/python/main.py` の `COMMANDS` dict に登録**
   ```python
   from commands import <command>
   COMMANDS = {
       ...,
       "<command>": <command>.run,
   }
   ```

3. **（必要に応じて）Node.js 側の IPC ハンドラを追加**
   - `electron/main/workers/` にある Python ワーカー呼び出し関数を参照
   - ジョブとして実行する場合は `jobs` ドメインのパターンを参考にする

4. **`requirements.txt` に新しい依存があれば追加**

完了後、開発環境で手動テストするかスモークテスト用の JSON を stdin に渡して確認する。
