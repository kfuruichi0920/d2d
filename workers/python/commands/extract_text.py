"""テキスト系ファイル抽出コマンド（txt / md / csv / tsv / json / jsonl / yaml）"""

from __future__ import annotations
import os
import uuid
from typing import Callable


def run(params: dict, progress: Callable[[str], None]) -> dict:
    blob_path: str = params["blob_path"]
    ext = os.path.splitext(blob_path)[1].lower()
    progress(f"テキストファイルを読み込み中: {os.path.basename(blob_path)}")

    with open(blob_path, encoding="utf-8", errors="replace") as f:
        content = f.read()

    items = []
    structure = []

    if ext in (".csv", ".tsv"):
        import csv
        delimiter = "\t" if ext == ".tsv" else ","
        reader = csv.reader(content.splitlines(), delimiter=delimiter)
        rows = list(reader)
        tbl_uid = str(uuid.uuid4())
        items.append({
            "item_uid": tbl_uid,
            "item_type": "table",
            "rows": rows,
            "row_count": len(rows),
            "column_count": max((len(r) for r in rows), default=0),
        })
        structure.append({"uid": tbl_uid, "title": os.path.basename(blob_path), "children": []})

    elif ext == ".jsonl":
        import json as _json
        for line_no, line in enumerate(content.splitlines(), 1):
            line = line.strip()
            if not line:
                continue
            try:
                obj = _json.loads(line)
            except Exception:
                obj = line
            uid = str(uuid.uuid4())
            items.append({
                "item_uid": uid,
                "item_type": "text",
                "line_no": line_no,
                "text": _json.dumps(obj, ensure_ascii=False) if isinstance(obj, (dict, list)) else str(obj),
            })

    elif ext in (".json",):
        import json as _json
        try:
            obj = _json.loads(content)
            text = _json.dumps(obj, ensure_ascii=False, indent=2)
        except Exception:
            text = content
        uid = str(uuid.uuid4())
        items.append({"item_uid": uid, "item_type": "text", "text": text})
        structure.append({"uid": uid, "title": os.path.basename(blob_path), "children": []})

    else:
        # plain text / markdown / yaml: 段落分割
        paragraphs = [p.strip() for p in content.split("\n\n") if p.strip()]
        for para in paragraphs:
            uid = str(uuid.uuid4())
            items.append({"item_uid": uid, "item_type": "text", "text": para})

    progress(f"抽出完了: {len(items)} アイテム")
    return {"items": items, "structure_json": structure}
