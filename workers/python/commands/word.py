"""Word (.docx) 抽出コマンド（P5-4、EXT-001〜008/016〜018、sdd_function_architecture §11.3）。

OpenXML を zipfile + xml.etree.ElementTree で直接解析し、原本忠実な文書構造を返す。
- 見出し階層（pStyle / outlineLvl）、段落、箇条書き（numPr）、表（結合セル）、
  図・画像（work_dir へ切り出し）、キャプション、文書メタデータ
- 出力は work_dir/extract.json（output_ref）。正本反映は Local Backend が行う。

未対応（P5 後続で拡張）: 脚注・コメント・変更履歴・ブックマーク・文書内参照・
テキストボックス・数式。structure_json の粒度は sdd_data_structure §2.7 に従う。
"""

from __future__ import annotations

import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

EXTRACTOR_NAME = "d2d-word-extractor"
EXTRACTOR_VERSION = "0.1.0"

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
}


def _qn(tag: str) -> str:
    prefix, local = tag.split(":")
    return f"{{{NS[prefix]}}}{local}"


def _para_text(p: ET.Element) -> str:
    parts: list[str] = []
    for t in p.iter(_qn("w:t")):
        parts.append(t.text or "")
    for _ in p.iter(_qn("w:tab")):
        pass
    return "".join(parts)


def _style_outline_levels(zf: zipfile.ZipFile) -> dict[str, int]:
    """styles.xml から styleId → 見出しレベル（1始まり）の対応を得る。"""
    levels: dict[str, int] = {}
    try:
        root = ET.fromstring(zf.read("word/styles.xml"))
    except KeyError:
        return levels
    for style in root.iter(_qn("w:style")):
        style_id = style.get(_qn("w:styleId")) or ""
        outline = style.find(f"{_qn('w:pPr')}/{_qn('w:outlineLvl')}")
        if outline is not None:
            levels[style_id] = int(outline.get(_qn("w:val"), "0")) + 1
        else:
            m = re.fullmatch(r"[Hh]eading\s*(\d)|見出し\s*(\d)", style_id)
            if m:
                levels[style_id] = int(m.group(1) or m.group(2))
    return levels


def _relationships(zf: zipfile.ZipFile) -> dict[str, str]:
    """document.xml.rels の rId → ターゲットパス。"""
    rels: dict[str, str] = {}
    try:
        root = ET.fromstring(zf.read("word/_rels/document.xml.rels"))
    except KeyError:
        return rels
    for rel in root.iter(_qn("rel:Relationship")):
        rels[rel.get("Id", "")] = rel.get("Target", "")
    return rels


def _core_metadata(zf: zipfile.ZipFile) -> dict:
    meta: dict = {}
    try:
        root = ET.fromstring(zf.read("docProps/core.xml"))
    except KeyError:
        return meta
    for tag, key in [
        ("dc:title", "title"),
        ("dc:creator", "creator"),
        ("cp:lastModifiedBy", "last_modified_by"),
    ]:
        el = root.find(_qn(tag))
        if el is not None and el.text:
            meta[key] = el.text
    return meta


def _image_metadata(data: bytes, file_name: str) -> dict:
    """stdlibだけで抽出画像の形式・ピクセル寸法・サイズを取得する（EDIT-086）。"""
    suffix = Path(file_name).suffix.lower().lstrip(".")
    result = {"byte_size": len(data), "image_format": suffix.upper() or "UNKNOWN"}
    if data.startswith(b"\x89PNG\r\n\x1a\n") and len(data) >= 24:
        result.update({"width": int.from_bytes(data[16:20], "big"), "height": int.from_bytes(data[20:24], "big")})
    elif data.startswith(b"\xff\xd8"):
        offset = 2
        while offset + 9 < len(data):
            if data[offset] != 0xFF:
                offset += 1
                continue
            marker = data[offset + 1]
            if marker in {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}:
                result.update({"height": int.from_bytes(data[offset + 5 : offset + 7], "big"), "width": int.from_bytes(data[offset + 7 : offset + 9], "big")})
                break
            if offset + 4 > len(data):
                break
            length = int.from_bytes(data[offset + 2 : offset + 4], "big")
            offset += max(length + 2, 2)
    return result


def _extract_images(p: ET.Element, rels: dict[str, str], zf: zipfile.ZipFile, media_dir: Path) -> list[dict]:
    """段落内の画像（a:blip r:embed）を work_dir へ切り出し、参照情報を返す。"""
    images: list[dict] = []
    for blip in p.iter(_qn("a:blip")):
        rid = blip.get(_qn("r:embed"))
        target = rels.get(rid or "")
        if not target:
            continue
        src = f"word/{target}" if not target.startswith("word/") else target
        try:
            data = zf.read(src)
        except KeyError:
            continue
        media_dir.mkdir(parents=True, exist_ok=True)
        file_name = Path(target).name
        out_path = media_dir / file_name
        out_path.write_bytes(data)
        images.append({"file": f"media/{file_name}", "source": target, **_image_metadata(data, file_name)})
    return images


def extract_word(file_path: str, work_dir: str) -> dict:
    """docx を解析し、structure_json 相当の辞書を返す（work_dir に画像を展開する）。"""
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    media_dir = work / "media"

    with zipfile.ZipFile(file_path) as zf:
        outline_levels = _style_outline_levels(zf)
        rels = _relationships(zf)
        metadata = _core_metadata(zf)
        body_root = ET.fromstring(zf.read("word/document.xml"))
        body = body_root.find(_qn("w:body"))
        if body is None:
            raise ValueError("word/document.xml に w:body がありません")

        elements: list[dict] = []
        heading_stack: list[str] = []
        seq = 0

        def next_id() -> str:
            nonlocal seq
            seq += 1
            return f"e{seq}"

        for child in body:
            tag = child.tag
            if tag == _qn("w:p"):
                text = _para_text(child)
                p_pr = child.find(_qn("w:pPr"))
                style = None
                num_pr = None
                if p_pr is not None:
                    style_el = p_pr.find(_qn("w:pStyle"))
                    style = style_el.get(_qn("w:val")) if style_el is not None else None
                    num_pr = p_pr.find(_qn("w:numPr"))

                images = _extract_images(child, rels, zf, media_dir)
                for img in images:
                    elements.append(
                        {
                            "id": next_id(),
                            "type": "figure",
                            "image": img["file"],
                            "caption": None,
                            "width": img.get("width"),
                            "height": img.get("height"),
                            "byte_size": img["byte_size"],
                            "image_format": img["image_format"],
                            "section_path": "/".join(heading_stack),
                        }
                    )

                if not text and not images:
                    continue  # 空段落
                if not text:
                    continue

                level = outline_levels.get(style or "", 0)
                if level > 0:
                    # 見出し: 章階層スタックを更新
                    del heading_stack[level - 1 :]
                    heading_stack.append(text)
                    elements.append(
                        {
                            "id": next_id(),
                            "type": "heading",
                            "text": text,
                            "level": level,
                            "style": style,
                            "section_path": "/".join(heading_stack[:-1]),
                        }
                    )
                elif num_pr is not None:
                    ilvl_el = num_pr.find(_qn("w:ilvl"))
                    ilvl = int(ilvl_el.get(_qn("w:val"), "0")) if ilvl_el is not None else 0
                    elements.append(
                        {
                            "id": next_id(),
                            "type": "list_item",
                            "text": text,
                            "level": ilvl,
                            "style": style,
                            "section_path": "/".join(heading_stack),
                        }
                    )
                elif style and style.lower() in ("caption", "図表番号"):
                    elements.append(
                        {
                            "id": next_id(),
                            "type": "caption",
                            "text": text,
                            "style": style,
                            "section_path": "/".join(heading_stack),
                        }
                    )
                else:
                    elements.append(
                        {
                            "id": next_id(),
                            "type": "paragraph",
                            "text": text,
                            "style": style,
                            "section_path": "/".join(heading_stack),
                        }
                    )
            elif tag == _qn("w:tbl"):
                rows: list[list[dict]] = []
                for tr in child.findall(_qn("w:tr")):
                    row: list[dict] = []
                    for tc in tr.findall(_qn("w:tc")):
                        cell_text = "\n".join(
                            _para_text(p) for p in tc.findall(_qn("w:p")) if _para_text(p)
                        )
                        tc_pr = tc.find(_qn("w:tcPr"))
                        grid_span = 1
                        v_merge = None
                        if tc_pr is not None:
                            gs = tc_pr.find(_qn("w:gridSpan"))
                            if gs is not None:
                                grid_span = int(gs.get(_qn("w:val"), "1"))
                            vm = tc_pr.find(_qn("w:vMerge"))
                            if vm is not None:
                                v_merge = vm.get(_qn("w:val"), "continue")
                        cell: dict = {"text": cell_text}
                        if grid_span > 1:
                            cell["colspan"] = grid_span
                        if v_merge is not None:
                            cell["v_merge"] = v_merge
                        row.append(cell)
                    rows.append(row)
                elements.append(
                    {
                        "id": next_id(),
                        "type": "table",
                        "rows": rows,
                        "row_count": len(rows),
                        "column_count": max((len(r) for r in rows), default=0),
                        "section_path": "/".join(heading_stack),
                    }
                )

    result = {
        "metadata": {
            **metadata,
            "extractor_name": EXTRACTOR_NAME,
            "extractor_version": EXTRACTOR_VERSION,
            "source_file": Path(file_path).name,
        },
        "elements": elements,
    }
    out_path = work / "extract.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return {
        "output_ref": str(out_path),
        "element_count": len(elements),
        "image_count": sum(1 for e in elements if e["type"] == "figure"),
    }


def run(job_id: str, parameters: dict, emit_progress, emit_result, emit_error) -> None:
    file_path = parameters.get("file_path")
    work_dir = parameters.get("work_dir")
    if not file_path or not work_dir:
        emit_error(job_id, "invalid_parameters", "file_path と work_dir は必須です")
        return
    emit_progress(job_id, 10, "docx を解析中")
    summary = extract_word(str(file_path), str(work_dir))
    emit_progress(job_id, 90, f"要素 {summary['element_count']} 件を抽出")
    emit_result(job_id, "success", output=summary, output_ref=summary["output_ref"])
