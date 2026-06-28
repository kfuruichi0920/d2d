"""D2D Python Worker エントリポイント

stdin から JSON を1行受け取り、コマンドを実行して
stdout に JSONL で progress / success / error を出力する。
"""

import io
import json
import sys

# Windows の CP932 デフォルトを UTF-8 に強制
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stdin  = io.TextIOWrapper(sys.stdin.buffer,  encoding='utf-8', errors='replace')

from commands import extract_word, extract_excel, extract_powerpoint, extract_visio, extract_pdf, extract_text


COMMANDS = {
    "extract_word": extract_word.run,
    "extract_excel": extract_excel.run,
    "extract_powerpoint": extract_powerpoint.run,
    "extract_visio": extract_visio.run,
    "extract_pdf": extract_pdf.run,
    "extract_text": extract_text.run,
}


def emit(job_id: str, status: str, **kwargs) -> None:
    payload = {"job_id": job_id, "status": status, **kwargs}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


def main() -> None:
    line = sys.stdin.readline()
    if not line.strip():
        return

    try:
        request = json.loads(line)
    except json.JSONDecodeError as e:
        print(json.dumps({"job_id": "", "status": "error", "error": f"Invalid JSON: {e}"}), flush=True)
        return

    job_id = request.get("job_id", "")
    command = request.get("command", "")
    parameters = request.get("parameters", {})

    handler = COMMANDS.get(command)
    if handler is None:
        emit(job_id, "error", error=f"Unknown command: {command}")
        return

    def progress(message: str) -> None:
        emit(job_id, "progress", message=message)

    try:
        result = handler(parameters, progress)
        emit(job_id, "success", data=result)
    except Exception as e:
        emit(job_id, "error", error=str(e))


if __name__ == "__main__":
    main()
