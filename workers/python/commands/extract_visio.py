"""Visio (.vsdx) 抽出コマンド — 標準ライブラリのみで実装"""

from __future__ import annotations
import os
import uuid
import zipfile
import xml.etree.ElementTree as ET
from typing import Callable


# Visio XML の名前空間
_NS = {
    'v': 'http://schemas.microsoft.com/office/visio/2012/main',
}


def _text_of(shape: ET.Element) -> str:
    """Shape 要素からテキストを抽出する"""
    parts: list[str] = []
    for cell in shape.iter('{http://schemas.microsoft.com/office/visio/2012/main}Text'):
        text = ''.join(cell.itertext()).strip()
        if text:
            parts.append(text)
    return ' '.join(parts)


def run(params: dict, progress: Callable[[str], None]) -> dict:
    blob_path: str = params["blob_path"]
    progress(f"Visio ファイルを読み込み中: {os.path.basename(blob_path)}")

    items: list[dict] = []
    structure: list[dict] = []

    with zipfile.ZipFile(blob_path, 'r') as z:
        # pages/pages.xml からページ一覧を取得
        try:
            pages_xml = z.read('visio/pages/pages.xml')
        except KeyError:
            raise RuntimeError("有効な .vsdx ファイルではありません (visio/pages/pages.xml が見つかりません)")

        pages_root = ET.fromstring(pages_xml)

        for page_el in pages_root.findall('v:Page', _NS):
            page_name = page_el.get('Name', 'Page')
            rel_id = page_el.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id', '')

            # ページファイルのパスを特定（visio/pages/page1.xml など）
            page_path = _resolve_page_path(z, rel_id, page_name)
            if page_path is None or page_path not in z.namelist():
                continue

            progress(f"  ページ: {page_name}")
            page_uid = str(uuid.uuid4())

            page_xml = z.read(page_path)
            page_root = ET.fromstring(page_xml)

            shapes_data: list[dict] = []
            for shape in page_root.iter('{http://schemas.microsoft.com/office/visio/2012/main}Shape'):
                shape_id = shape.get('ID', '')
                text = _text_of(shape)
                if text:
                    shapes_data.append({
                        "shape_id": shape_id,
                        "text": text,
                    })

            items.append({
                "item_uid": page_uid,
                "item_type": "model",
                "page_name": page_name,
                "shapes": shapes_data,
            })
            structure.append({"uid": page_uid, "title": page_name, "children": []})

    progress(f"抽出完了: {len(items)} ページ")
    return {"items": items, "structure_json": structure}


def _resolve_page_path(z: zipfile.ZipFile, rel_id: str, page_name: str) -> str | None:
    """pages.xml.rels からページファイルのパスを解決する"""
    rels_path = 'visio/pages/_rels/pages.xml.rels'
    if rels_path not in z.namelist():
        # rels がない場合はページ名からの推測
        return f"visio/pages/{page_name.lower()}.xml"

    rels_xml = z.read(rels_path)
    rels_root = ET.fromstring(rels_xml)
    ns = 'http://schemas.openxmlformats.org/package/2006/relationships'

    for rel in rels_root.findall(f'{{{ns}}}Relationship'):
        if rel.get('Id') == rel_id:
            target = rel.get('Target', '')
            # Target が相対パスの場合に絶対パスへ変換
            if not target.startswith('visio/'):
                target = f"visio/pages/{target}"
            return target

    return None
