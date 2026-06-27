"""Visio (.vsdx) 抽出コマンド"""

from __future__ import annotations
import os
import uuid
from typing import Callable


def run(params: dict, progress: Callable[[str], None]) -> dict:
    try:
        import vsdx
    except ImportError:
        raise RuntimeError("python-vsdx is not installed. Run: pip install python-vsdx")

    blob_path: str = params["blob_path"]
    progress(f"Visio ファイルを読み込み中: {os.path.basename(blob_path)}")

    items = []
    structure = []

    with vsdx.VisioFile(blob_path) as vis:
        for page in vis.pages:
            page_uid = str(uuid.uuid4())
            progress(f"  ページ: {page.name}")

            shapes_data = []
            for shape in page.shapes:
                text = shape.text.strip() if shape.text else ""
                if text:
                    shapes_data.append({
                        "shape_id": shape.ID,
                        "text": text,
                    })

            items.append({
                "item_uid": page_uid,
                "item_type": "model",
                "page_name": page.name,
                "shapes": shapes_data,
            })
            structure.append({"uid": page_uid, "title": page.name, "children": []})

    progress(f"抽出完了: {len(items)} ページ")
    return {"items": items, "structure_json": structure}
