"""PDF 抽出コマンド（pdfplumber使用）"""

from __future__ import annotations
import os
import uuid
from typing import Callable


def run(params: dict, progress: Callable[[str], None]) -> dict:
    try:
        import pdfplumber
    except ImportError:
        raise RuntimeError("pdfplumber is not installed. Run: pip install pdfplumber")

    blob_path: str = params["blob_path"]
    progress(f"PDF を読み込み中: {os.path.basename(blob_path)}")

    items = []
    structure = []

    with pdfplumber.open(blob_path) as pdf:
        total = len(pdf.pages)
        for page_idx, page in enumerate(pdf.pages):
            page_no = page_idx + 1
            if page_no % 10 == 0 or page_no == total:
                progress(f"  ページ {page_no} / {total}")

            # テキスト抽出
            text = page.extract_text() or ""
            if text.strip():
                text_uid = str(uuid.uuid4())
                items.append({
                    "item_uid": text_uid,
                    "item_type": "text",
                    "page_no": page_no,
                    "text": text.strip(),
                })
                structure.append({"uid": text_uid, "title": f"ページ {page_no}", "children": []})

            # 表抽出
            for t_idx, table in enumerate(page.extract_tables() or []):
                tbl_uid = str(uuid.uuid4())
                items.append({
                    "item_uid": tbl_uid,
                    "item_type": "table",
                    "page_no": page_no,
                    "table_index": t_idx,
                    "rows": [[str(c) if c else "" for c in row] for row in table],
                    "row_count": len(table),
                    "column_count": max((len(r) for r in table), default=0),
                })

    progress(f"抽出完了: {len(items)} アイテム")
    return {"items": items, "structure_json": structure}
