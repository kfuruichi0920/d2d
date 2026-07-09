"""D2D Python ワーカー エントリポイント（P2-6 / P5-1 骨格）。

sdd_function_architecture §11 の stdin/stdout JSONL プロトコルで Local Backend と通信する。
- stdin: 1 行 JSON（job_id / project_uid / worker_name / command / parameters / auth）
- stdout: 改行区切り JSON（progress / result / error）

文書抽出コマンド（extract.word 等）は P5 で commands/ へ追加する。
"""

import io
import json
import sys

# Windows の CP932 文字化け対策（sdd_tech_stack §5.3）。stdin も UTF-8 で受ける
sys.stdin = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8", errors="replace")

WORKER_VERSION = "0.1.0"


def emit(obj: dict) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def emit_progress(job_id: str, percent: int, message: str) -> None:
    emit({"type": "progress", "job_id": job_id, "percent": percent, "message": message})


def emit_result(job_id: str, status: str, output: dict | None = None, output_ref: str | None = None) -> None:
    msg: dict = {"type": "result", "job_id": job_id, "status": status}
    if output is not None:
        msg["output"] = output
    if output_ref is not None:
        msg["output_ref"] = output_ref
    emit(msg)


def emit_error(job_id: str, error_code: str, message: str, detail: str = "") -> None:
    emit({"type": "error", "job_id": job_id, "error_code": error_code, "message": message, "detail": detail})


def cmd_ping(job_id: str, parameters: dict) -> None:
    """疎通確認コマンド。受け取ったパラメータをそのまま返す。"""
    emit_progress(job_id, 50, "処理中")
    emit_result(
        job_id,
        "success",
        output={
            "worker_version": WORKER_VERSION,
            "python_version": sys.version.split()[0],
            "echo": parameters,
        },
    )


def cmd_extract_word(job_id: str, parameters: dict) -> None:
    from commands import word

    word.run(job_id, parameters, emit_progress, emit_result, emit_error)


COMMANDS = {
    "worker.ping": cmd_ping,
    "extract.word": cmd_extract_word,
    # P5 後続で追加: extract.excel / extract.pptx / extract.pdf / extract.visio / extract.text
}


def main() -> int:
    line = sys.stdin.readline()
    if not line.strip():
        emit_error("", "invalid_request", "リクエストが空です")
        return 1

    try:
        request = json.loads(line)
    except json.JSONDecodeError as e:
        emit_error("", "invalid_request", "リクエストの JSON 解析に失敗しました", str(e))
        return 1

    job_id = str(request.get("job_id", ""))
    command = str(request.get("command", ""))
    parameters = request.get("parameters") or {}

    handler = COMMANDS.get(command)
    if handler is None:
        emit_error(job_id, "unknown_command", f"未知のコマンドです: {command}")
        return 1

    try:
        handler(job_id, parameters)
        return 0
    except Exception as e:  # noqa: BLE001 - 契約上すべて error メッセージへ変換する
        emit_error(job_id, "command_failed", f"コマンド実行に失敗しました: {command}", str(e))
        return 1


if __name__ == "__main__":
    sys.exit(main())
