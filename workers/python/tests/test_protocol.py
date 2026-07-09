"""ワーカー JSONL プロトコルのテスト（P2-6）。

main.py をサブプロセスとして起動し、§11 の入出力契約を検証する。
"""

import json
import subprocess
import sys
from pathlib import Path

MAIN_PY = str(Path(__file__).resolve().parents[1] / "main.py")


def run_worker(request: dict | None, raw: str | None = None) -> list[dict]:
    stdin_data = raw if raw is not None else json.dumps(request, ensure_ascii=False) + "\n"
    proc = subprocess.run(
        [sys.executable, MAIN_PY],
        input=stdin_data,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    lines = [line for line in proc.stdout.splitlines() if line.strip()]
    return [json.loads(line) for line in lines]


def test_ping_returns_progress_and_result():
    messages = run_worker(
        {
            "job_id": "job-1",
            "project_uid": "prj-1",
            "worker_name": "d2d-worker",
            "command": "worker.ping",
            "parameters": {"hello": "世界"},
        }
    )
    types = [m["type"] for m in messages]
    assert "progress" in types
    assert types[-1] == "result"

    result = messages[-1]
    assert result["job_id"] == "job-1"
    assert result["status"] == "success"
    assert result["output"]["echo"] == {"hello": "世界"}


def test_unknown_command_emits_error():
    messages = run_worker(
        {
            "job_id": "job-2",
            "project_uid": "prj-1",
            "worker_name": "d2d-worker",
            "command": "no.such.command",
            "parameters": {},
        }
    )
    assert messages[-1]["type"] == "error"
    assert messages[-1]["error_code"] == "unknown_command"
    assert messages[-1]["job_id"] == "job-2"


def test_broken_json_emits_error():
    messages = run_worker(None, raw="{not-json}\n")
    assert messages[-1]["type"] == "error"
    assert messages[-1]["error_code"] == "invalid_request"
