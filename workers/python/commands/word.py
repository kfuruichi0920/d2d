"""Word (.docx) 高度抽出コマンド（P5-4/P5-17、EXT-001〜008/016〜018/042〜048）。

後方互換の ``elements`` を維持しながら、Word が DOCX に保存した構造・書式・
描画要素・Story・Part・Relationship・Raw XML・未対応要素を保持する。
"""

from __future__ import annotations

import hashlib
import json
import re
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from commands.word_ooxml import (
    FEATURE_DEFAULTS,
    NS,
    drawing_elements,
    extract_auxiliary,
    package_inventory,
    paragraph_data,
    parse_numbering,
    qn,
    read_xml,
    unsupported_report,
    validate_package,
)

EXTRACTOR_NAME = "d2d-word-extractor"
EXTRACTOR_VERSION = "0.2.0"


def _style_outline_levels(zf: zipfile.ZipFile) -> dict[str, int]:
    levels: dict[str, int] = {}
    try:
        root, _ = read_xml(zf, "word/styles.xml")
    except KeyError:
        return levels
    for style in root.iter(qn("w:style")):
        style_id = style.get(qn("w:styleId")) or ""
        outline = style.find(f"{qn('w:pPr')}/{qn('w:outlineLvl')}")
        if outline is not None:
            levels[style_id] = int(outline.get(qn("w:val"), "0")) + 1
        else:
            match = re.fullmatch(r"[Hh]eading\s*(\d)|見出し\s*(\d)", style_id)
            if match:
                levels[style_id] = int(match.group(1) or match.group(2))
    return levels


def _document_relationships(zf: zipfile.ZipFile) -> dict[str, dict]:
    try:
        root, _ = read_xml(zf, "word/_rels/document.xml.rels")
    except KeyError:
        return {}
    return {
        rel.get("Id", ""): {
            "target": rel.get("Target", ""),
            "type": rel.get("Type", "").rsplit("/", 1)[-1],
            "external": rel.get("TargetMode") == "External",
        }
        for rel in root.iter(qn("rel:Relationship"))
    }


def _core_metadata(zf: zipfile.ZipFile) -> dict:
    try:
        root, _ = read_xml(zf, "docProps/core.xml")
    except KeyError:
        return {}
    result = {}
    for name, key in [
        ("dc:title", "title"),
        ("dc:creator", "creator"),
        ("cp:lastModifiedBy", "last_modified_by"),
        ("dcterms:created", "created"),
        ("dcterms:modified", "modified"),
    ]:
        item = root.find(qn(name))
        if item is not None and item.text:
            result[key] = item.text
    return result


def _image_metadata(data: bytes, file_name: str) -> dict:
    suffix = Path(file_name).suffix.lower().lstrip(".")
    result = {
        "byte_size": len(data),
        "image_format": suffix.upper() or "UNKNOWN",
        "sha256": hashlib.sha256(data).hexdigest(),
    }
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
                result.update({
                    "height": int.from_bytes(data[offset + 5 : offset + 7], "big"),
                    "width": int.from_bytes(data[offset + 7 : offset + 9], "big"),
                })
                break
            length = int.from_bytes(data[offset + 2 : offset + 4], "big")
            offset += max(length + 2, 2)
    return result


def _extract_images(
    paragraph: ET.Element,
    relationships: dict[str, dict],
    zf: zipfile.ZipFile,
    media_dir: Path,
) -> list[dict]:
    images = []
    for blip in paragraph.iter(qn("a:blip")):
        rid = blip.get(qn("r:embed")) or blip.get(qn("r:link"))
        relationship = relationships.get(rid or "")
        if not relationship:
            continue
        if relationship["external"]:
            images.append({
                "relationship_id": rid,
                "source": relationship["target"],
                "external": True,
            })
            continue
        target = relationship["target"]
        source = f"word/{target}" if not target.startswith("word/") else target
        try:
            data = zf.read(source)
        except KeyError:
            continue
        media_dir.mkdir(parents=True, exist_ok=True)
        file_name = Path(target).name
        output = media_dir / file_name
        output.write_bytes(data)
        doc_pr = next(iter(paragraph.iter(qn("wp:docPr"))), None)
        images.append({
            "file": f"media/{file_name}",
            "source": target,
            "source_part": "/" + source,
            "relationship_id": rid,
            "external": False,
            "alt_text": doc_pr.get("descr") if doc_pr is not None else None,
            "title": doc_pr.get("title") if doc_pr is not None else None,
            **_image_metadata(data, file_name),
        })
    return images


def _table_data(table: ET.Element, numbering: dict[str, dict]) -> dict:
    rows = []
    logical_width = 0
    for row_no, tr in enumerate(table.findall(qn("w:tr"))):
        row = []
        logical_col = 0
        for tc in tr.findall(qn("w:tc")):
            paragraphs = [paragraph_data(p, numbering) for p in tc.findall(qn("w:p"))]
            tc_pr = tc.find(qn("w:tcPr"))
            grid_span = 1
            v_merge = None
            if tc_pr is not None:
                span = tc_pr.find(qn("w:gridSpan"))
                merge = tc_pr.find(qn("w:vMerge"))
                grid_span = int(span.get(qn("w:val"), "1")) if span is not None else 1
                v_merge = merge.get(qn("w:val"), "continue") if merge is not None else None
            cell = {
                "text": "\n".join(p["text"] for p in paragraphs if p["text"]),
                "row": row_no,
                "column": logical_col,
                "colspan": grid_span,
                "v_merge": v_merge,
                "paragraphs": paragraphs,
                "nested_tables": [_table_data(nested, numbering) for nested in tc.findall(qn("w:tbl"))],
            }
            row.append(cell)
            logical_col += grid_span
        logical_width = max(logical_width, logical_col)
        rows.append(row)
    return {"rows": rows, "row_count": len(rows), "column_count": logical_width}


def extract_word(file_path: str, work_dir: str, feature_overrides: dict | None = None) -> dict:
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    media_dir = work / "media"
    features = {**FEATURE_DEFAULTS, **(feature_overrides or {})}
    elements: list[dict] = []
    seq = 0

    def next_id() -> str:
        nonlocal seq
        seq += 1
        return f"e{seq}"

    with zipfile.ZipFile(file_path) as zf:
        validate_package(zf)
        outline_levels = _style_outline_levels(zf)
        relationships = _document_relationships(zf)
        metadata = _core_metadata(zf)
        numbering = parse_numbering(zf)
        parts, rels_by_owner = package_inventory(zf, work / "raw_xml" if features["preserve_raw_xml"] else None)
        root, _ = read_xml(zf, "word/document.xml")
        body = root.find(qn("w:body"))
        if body is None:
            raise ValueError("word/document.xml に w:body がありません")

        heading_stack: list[str] = []
        page_no = 1
        for child in body:
            if child.tag == qn("w:p"):
                paragraph = paragraph_data(child, numbering)
                anchor_uid = next_id()
                images = _extract_images(child, relationships, zf, media_dir)
                for image in images:
                    image_uid = next_id()
                    elements.append({
                        "id": image_uid,
                        "uid": image_uid,
                        "type": "figure",
                        "element_type": "figure",
                        "image": image.get("file"),
                        "caption": None,
                        "section_path": "/".join(heading_stack),
                        "story_type": "main",
                        "page_no": page_no,
                        "anchor_paragraph_uid": anchor_uid,
                        **image,
                    })
                shapes = drawing_elements(child, next_id, anchor_uid, numbering, features)
                if paragraph["text"] or paragraph["fields"] or paragraph["bookmarks"]:
                    common = {
                        "id": anchor_uid,
                        "uid": anchor_uid,
                        "text": paragraph["text"],
                        "style": paragraph["style"],
                        "section_path": "/".join(heading_stack),
                        "story_type": "main",
                        "page_no": page_no,
                        "source_part": "/word/document.xml",
                        "runs": paragraph["runs"],
                        "paragraph_format": paragraph["paragraph_format"],
                        "fields": paragraph["fields"] if features["extract_fields"] else [],
                        "bookmarks": paragraph["bookmarks"],
                    }
                    level = outline_levels.get(paragraph["style"] or "", 0)
                    if level:
                        del heading_stack[level - 1 :]
                        common["section_path"] = "/".join(heading_stack)
                        heading_stack.append(paragraph["text"])
                        common.update({"type": "heading", "element_type": "heading", "level": level})
                    elif paragraph["list_info"] is not None:
                        common.update({
                            "type": "list_item",
                            "element_type": "list_item",
                            "level": paragraph["list_info"]["level"],
                            "list_info": paragraph["list_info"],
                        })
                    elif paragraph["style"] and paragraph["style"].lower() in {"caption", "図表番号"}:
                        common.update({"type": "caption", "element_type": "caption"})
                    else:
                        common.update({"type": "paragraph", "element_type": "paragraph"})
                    elements.append(common)
                elements.extend(shapes)
                if any(br.get(qn("w:type")) == "page" for br in child.iter(qn("w:br"))) or next(
                    iter(child.iter(qn("w:lastRenderedPageBreak"))), None
                ) is not None:
                    page_no += 1
            elif child.tag == qn("w:tbl"):
                uid = next_id()
                elements.append({
                    "id": uid,
                    "uid": uid,
                    "type": "table",
                    "element_type": "table",
                    "section_path": "/".join(heading_stack),
                    "story_type": "main",
                    "page_no": page_no,
                    "source_part": "/word/document.xml",
                    **_table_data(child, numbering),
                })

        auxiliary = extract_auxiliary(zf, numbering, next_id, features)
        unsupported = unsupported_report(parts, zf)

    counts: dict[str, int] = {}
    for element in elements:
        counts[element["type"]] = counts.get(element["type"], 0) + 1
    result = {
        "metadata": {
            **metadata,
            "extractor_name": EXTRACTOR_NAME,
            "extractor_version": EXTRACTOR_VERSION,
            "source_file": Path(file_path).name,
            "source_sha256": hashlib.sha256(Path(file_path).read_bytes()).hexdigest(),
            "feature_flags": features,
        },
        "statistics": {
            "element_count": len(elements),
            "by_type": counts,
            "story_count": len(auxiliary["stories"]),
            "comment_count": len(auxiliary["comments"]),
            "revision_count": len(auxiliary["revisions"]),
            "unsupported_kind_count": len(unsupported),
        },
        "elements": elements,
        **auxiliary,
        "package": {"parts": parts, "relationships": rels_by_owner},
        "unsupported_elements": unsupported,
        "review_hints": {
            "warnings": [
                f"未対応OOXML要素 {sum(item['count'] for item in unsupported)} 件（Raw XML保持済み）"
            ] if unsupported else [],
        },
    }
    output = work / "extract.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return {
        "output_ref": str(output),
        "element_count": len(elements),
        "image_count": counts.get("figure", 0),
        "shape_count": sum(counts.get(kind, 0) for kind in ("shape", "group_shape", "connector")),
        "unsupported_count": sum(item["count"] for item in unsupported),
    }


def run(job_id: str, parameters: dict, emit_progress, emit_result, emit_error) -> None:
    file_path = parameters.get("file_path")
    work_dir = parameters.get("work_dir")
    features = parameters.get("features")
    if not file_path or not work_dir:
        emit_error(job_id, "invalid_parameters", "file_path と work_dir は必須です")
        return
    if features is not None and not isinstance(features, dict):
        emit_error(job_id, "invalid_parameters", "features はオブジェクトで指定してください")
        return
    emit_progress(job_id, 10, "DOCXパッケージとOOXMLを解析中")
    summary = extract_word(str(file_path), str(work_dir), features)
    emit_progress(job_id, 90, f"要素 {summary['element_count']} 件を抽出")
    emit_result(job_id, "success", output=summary, output_ref=summary["output_ref"])
