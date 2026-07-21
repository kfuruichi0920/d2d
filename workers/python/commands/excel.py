"""Excel (.xlsx) 物理抽出・抽出グループ候補生成（P5-19、EXT-009/049〜055）。

Excelファイルを実行せず、OOXML ZIP/XMLに保存された事実だけを読み取る。
外部リンク・マクロ・ActiveX・埋込オブジェクトへのアクセスや実行は行わない。
"""

from __future__ import annotations

import html
import json
import posixpath
import re
import zipfile
from collections import deque
from pathlib import Path
from xml.etree import ElementTree as ET

EXTRACTOR_NAME = "d2d-excel-extractor"
EXTRACTOR_VERSION = "0.1.0"

NS = {
    "x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "c": "http://schemas.openxmlformats.org/drawingml/2006/chart",
}
MAX_ENTRIES = 20_000
MAX_TOTAL_SIZE = 256 * 1024 * 1024
MAX_XML_SIZE = 32 * 1024 * 1024
MAX_CELLS = 200_000


def qn(prefix_name: str) -> str:
    prefix, name = prefix_name.split(":", 1)
    return f"{{{NS[prefix]}}}{name}"


def _validate_package(zf: zipfile.ZipFile) -> None:
    infos = zf.infolist()
    if len(infos) > MAX_ENTRIES:
        raise ValueError(f"ZIPエントリ数が上限を超えています: {len(infos)}")
    total = 0
    for info in infos:
        normalized = posixpath.normpath(info.filename.replace("\\", "/"))
        if normalized.startswith("../") or normalized.startswith("/") or ":" in normalized:
            raise ValueError(f"不正なZIPエントリ名です: {info.filename}")
        total += info.file_size
        if info.filename.lower().endswith(".xml") and info.file_size > MAX_XML_SIZE:
            raise ValueError(f"XMLパートが上限を超えています: {info.filename}")
    if total > MAX_TOTAL_SIZE:
        raise ValueError(f"ZIP展開後サイズが上限を超えています: {total}")


def _read_xml(zf: zipfile.ZipFile, name: str) -> ET.Element:
    data = zf.read(name)
    upper = data[:4096].upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise ValueError(f"DTD/外部実体を含むXMLは解析できません: {name}")
    return ET.fromstring(data)


def _rels(zf: zipfile.ZipFile, rel_path: str, owner_path: str) -> dict[str, dict]:
    try:
        root = _read_xml(zf, rel_path)
    except KeyError:
        return {}
    base = posixpath.dirname(owner_path)
    result = {}
    for rel in root.findall("rel:Relationship", NS):
        target = rel.get("Target", "")
        result[rel.get("Id", "")] = {
            "type": rel.get("Type", "").rsplit("/", 1)[-1],
            "target": target if rel.get("TargetMode") == "External" else posixpath.normpath(posixpath.join(base, target)),
            "external": rel.get("TargetMode") == "External",
        }
    return result


def _cell_position(address: str) -> tuple[int, int]:
    match = re.fullmatch(r"([A-Z]+)([0-9]+)", address.upper())
    if not match:
        return 0, 0
    col = 0
    for char in match.group(1):
        col = col * 26 + ord(char) - 64
    return int(match.group(2)), col


def _cell_address(row: int, col: int) -> str:
    letters = ""
    while col:
        col, rem = divmod(col - 1, 26)
        letters = chr(65 + rem) + letters
    return f"{letters}{row}"


def _shared_strings(zf: zipfile.ZipFile) -> list[dict]:
    try:
        root = _read_xml(zf, "xl/sharedStrings.xml")
    except KeyError:
        return []
    values = []
    for si in root.findall("x:si", NS):
        runs = []
        rich_runs = si.findall("x:r", NS)
        if rich_runs:
            for run in rich_runs:
                text = "".join((node.text or "") for node in run.findall(".//x:t", NS))
                props = run.find("x:rPr", NS)
                runs.append(
                    {
                        "text": text,
                        "style": {
                            "bold": props is not None and props.find("x:b", NS) is not None,
                            "italic": props is not None and props.find("x:i", NS) is not None,
                            "underline": props is not None and props.find("x:u", NS) is not None,
                        },
                    }
                )
        else:
            runs.append({"text": "".join((node.text or "") for node in si.findall(".//x:t", NS)), "style": {}})
        values.append({"text": "".join(run["text"] for run in runs), "runs": runs})
    return values


def _styles(zf: zipfile.ZipFile) -> list[dict]:
    try:
        root = _read_xml(zf, "xl/styles.xml")
    except KeyError:
        return []
    fonts = []
    for font in root.findall("x:fonts/x:font", NS):
        color = font.find("x:color", NS)
        size = font.find("x:sz", NS)
        name = font.find("x:name", NS)
        fonts.append(
            {
                "name": name.get("val") if name is not None else None,
                "size": float(size.get("val", "0")) if size is not None else None,
                "bold": font.find("x:b", NS) is not None,
                "italic": font.find("x:i", NS) is not None,
                "underline": font.find("x:u", NS) is not None,
                "strike": font.find("x:strike", NS) is not None,
                "color": dict(color.attrib) if color is not None else None,
            }
        )
    fills = []
    for fill in root.findall("x:fills/x:fill", NS):
        pattern = fill.find("x:patternFill", NS)
        fg = pattern.find("x:fgColor", NS) if pattern is not None else None
        bg = pattern.find("x:bgColor", NS) if pattern is not None else None
        fills.append(
            {
                "pattern": pattern.get("patternType") if pattern is not None else None,
                "foreground": dict(fg.attrib) if fg is not None else None,
                "background": dict(bg.attrib) if bg is not None else None,
            }
        )
    borders = []
    for border in root.findall("x:borders/x:border", NS):
        borders.append(
            {
                side: dict(node.attrib) if node is not None else {}
                for side in ("left", "right", "top", "bottom")
                for node in [border.find(f"x:{side}", NS)]
            }
        )
    result = []
    for xf in root.findall("x:cellXfs/x:xf", NS):
        alignment = xf.find("x:alignment", NS)
        font_id = int(xf.get("fontId", "0"))
        fill_id = int(xf.get("fillId", "0"))
        border_id = int(xf.get("borderId", "0"))
        result.append(
            {
                "style_id": len(result),
                "num_fmt_id": int(xf.get("numFmtId", "0")),
                "font": fonts[font_id] if font_id < len(fonts) else {},
                "fill": fills[fill_id] if fill_id < len(fills) else {},
                "border": borders[border_id] if border_id < len(borders) else {},
                "alignment": dict(alignment.attrib) if alignment is not None else {},
            }
        )
    return result


def _comments(zf: zipfile.ZipFile, target: str) -> dict[str, dict]:
    try:
        root = _read_xml(zf, target)
    except KeyError:
        return {}
    authors = [(node.text or "") for node in root.findall("x:authors/x:author", NS)]
    result = {}
    for comment in root.findall("x:commentList/x:comment", NS):
        author_id = int(comment.get("authorId", "0"))
        result[comment.get("ref", "")] = {
            "author": authors[author_id] if author_id < len(authors) else "",
            "text": "".join((node.text or "") for node in comment.findall(".//x:t", NS)),
        }
    return result


def _table(zf: zipfile.ZipFile, target: str) -> dict | None:
    try:
        root = _read_xml(zf, target)
    except KeyError:
        return None
    return {
        "name": root.get("displayName") or root.get("name"),
        "range": root.get("ref"),
        "header_row_count": int(root.get("headerRowCount", "1")),
        "totals_row_count": int(root.get("totalsRowCount", "0")),
        "columns": [item.get("name", "") for item in root.findall("x:tableColumns/x:tableColumn", NS)],
    }


def _marker_cell(anchor: ET.Element, name: str, fallback: tuple[int, int]) -> tuple[int, int]:
    marker = anchor.find(f"xdr:{name}", NS)
    if marker is None:
        return fallback
    row = marker.find("xdr:row", NS)
    col = marker.find("xdr:col", NS)
    return (int(row.text or "0") + 1, int(col.text or "0") + 1) if row is not None and col is not None else fallback


def _drawing_preview_svg(name: str, text: str, drawing_type: str, style: dict) -> bytes:
    fill = style.get("fill", {}).get("rgb") or "DDEBFF"
    line = style.get("line", {}).get("rgb") or "3B82F6"
    label = html.escape(text or name or drawing_type)
    if drawing_type == "connector":
        body = f'<line x1="20" y1="90" x2="300" y2="30" stroke="#{line}" stroke-width="4"/><text x="20" y="120">{label}</text>'
    else:
        body = f'<rect x="10" y="10" width="300" height="120" rx="8" fill="#{fill}" stroke="#{line}" stroke-width="3"/><text x="24" y="75">{label}</text>'
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="140" viewBox="0 0 320 140"><style>text{font:16px sans-serif;fill:#172033}</style>' + body + '</svg>').encode("utf-8")


def _color(node: ET.Element | None) -> dict:
    if node is None:
        return {}
    srgb = node.find("a:srgbClr", NS)
    scheme = node.find("a:schemeClr", NS)
    return {"rgb": srgb.get("val") if srgb is not None else None, "scheme": scheme.get("val") if scheme is not None else None}


def _drawing_parts(zf: zipfile.ZipFile, target: str, work: Path) -> list[dict]:
    try:
        root = _read_xml(zf, target)
    except KeyError:
        return []
    rel_path = posixpath.join(posixpath.dirname(target), "_rels", posixpath.basename(target) + ".rels")
    relationships = _rels(zf, rel_path, target)
    media_dir = work / "media"
    media_dir.mkdir(parents=True, exist_ok=True)
    result = []
    for anchor_index, anchor in enumerate(list(root)):
        local_anchor = anchor.tag.rsplit("}", 1)[-1]
        if local_anchor not in ("twoCellAnchor", "oneCellAnchor", "absoluteAnchor"):
            continue
        start_row, start_col = _marker_cell(anchor, "from", (1, 1))
        end_row, end_col = _marker_cell(anchor, "to", (start_row + 1, start_col + 1))
        for element in list(anchor):
            local = element.tag.rsplit("}", 1)[-1]
            if local not in ("pic", "sp", "cxnSp", "grpSp", "graphicFrame"):
                continue
            drawing_type = {"pic": "image", "sp": "shape", "cxnSp": "connector", "grpSp": "group", "graphicFrame": "chart"}.get(local, "unknown")
            props = element.find(".//xdr:cNvPr", NS)
            drawing_id = props.get("id", str(anchor_index + 1)) if props is not None else str(anchor_index + 1)
            name = props.get("name", "") if props is not None else ""
            text = "".join((node.text or "") for node in element.findall(".//a:t", NS))
            solid_fill = element.find(".//a:solidFill", NS)
            line_fill = element.find(".//a:ln/a:solidFill", NS)
            transform = element.find(".//a:xfrm", NS)
            geometry = element.find(".//a:prstGeom", NS)
            style = {"fill": _color(solid_fill), "line": _color(line_fill), "preset_geometry": geometry.get("prst") if geometry is not None else None, "rotation": transform.get("rot") if transform is not None else None}
            rel_id = ""
            preview_file = ""
            if drawing_type == "image":
                blip = element.find(".//a:blip", NS)
                rel_id = blip.get(qn("r:embed"), "") if blip is not None else ""
                rel = relationships.get(rel_id)
                if rel and not rel.get("external"):
                    suffix = Path(rel["target"]).suffix.lower() or ".bin"
                    preview = media_dir / f"{Path(target).stem}-{drawing_id}{suffix}"
                    try:
                        preview.write_bytes(zf.read(rel["target"]))
                        preview_file = preview.relative_to(work).as_posix()
                    except KeyError:
                        preview_file = ""
            else:
                preview = media_dir / f"{Path(target).stem}-{drawing_id}.svg"
                preview.write_bytes(_drawing_preview_svg(name, text, drawing_type, style))
                preview_file = preview.relative_to(work).as_posix()
            starts = element.findall(".//a:stCxn", NS)
            ends = element.findall(".//a:endCxn", NS)
            connection_status = "resolved" if drawing_type == "connector" and starts and ends else ("unresolved" if drawing_type == "connector" else "not_applicable")
            result.append({
                "drawing_uid": f"{target}#{drawing_id}", "drawing_type": drawing_type, "name": name, "text": text,
                "start_cell": _cell_address(start_row, start_col), "end_cell": _cell_address(end_row, end_col),
                "anchor": {"kind": local_anchor, "from": {"row": start_row, "column": start_col}, "to": {"row": end_row, "column": end_col}},
                "style": style, "source_part": target, "relationship_id": rel_id or None, "preview_file": preview_file or None,
                "connection_status": connection_status,
                "child_count": len(element.findall(".//xdr:sp", NS)) + len(element.findall(".//xdr:pic", NS)),
            })
    return result


def _drawing_candidates(drawings: list[dict], sheet_name: str) -> list[dict]:
    return [{
        "sheet_name": sheet_name, "start_cell": drawing["start_cell"], "end_cell": drawing["end_cell"],
        "candidate_type": "figure", "title": drawing.get("text") or drawing.get("name") or "図",
        "detection_methods": ["drawingml_anchor", drawing["drawing_type"]],
        "confidence": 1.0 if drawing["drawing_type"] == "image" else 0.9,
        "candidate_status": "detected", "review_status": "approved", "drawing_refs": [drawing["drawing_uid"]],
    } for drawing in drawings]

def _candidate_regions(cells: list[dict], merged_ranges: list[str], tables: list[dict], sheet_name: str) -> list[dict]:
    occupied = {(cell["row"], cell["column"]): cell for cell in cells if cell.get("display_value") not in (None, "")}
    visited: set[tuple[int, int]] = set()
    candidates = []
    table_ranges = {table.get("range") for table in tables}
    for table in tables:
        if not table.get("range"):
            continue
        start, end = table["range"].split(":") if ":" in table["range"] else (table["range"], table["range"])
        candidates.append(
            {
                "sheet_name": sheet_name,
                "start_cell": start,
                "end_cell": end,
                "candidate_type": "table",
                "title": table.get("name") or "Excel Table",
                "detection_methods": ["structured_table"],
                "confidence": 1.0,
                "candidate_status": "detected",
                "review_status": "approved",
            }
        )
    for point in occupied:
        if point in visited:
            continue
        queue = deque([point])
        visited.add(point)
        component = []
        while queue:
            current = queue.popleft()
            component.append(occupied[current])
            row, col = current
            for neighbor in ((row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)):
                if neighbor in occupied and neighbor not in visited:
                    visited.add(neighbor)
                    queue.append(neighbor)
        min_row = min(cell["row"] for cell in component)
        max_row = max(cell["row"] for cell in component)
        min_col = min(cell["column"] for cell in component)
        max_col = max(cell["column"] for cell in component)
        start = _cell_address(min_row, min_col)
        end = _cell_address(max_row, max_col)
        range_ref = f"{start}:{end}"
        if range_ref in table_ranges:
            continue
        first_row = sorted((cell for cell in component if cell["row"] == min_row), key=lambda cell: cell["column"])
        title = " / ".join(str(cell.get("display_value", "")) for cell in first_row if cell.get("display_value"))[:120]
        methods = ["continuous_non_empty", "blank_boundary"]
        if any(_ranges_intersect(range_ref, merged) for merged in merged_ranges):
            methods.append("merged_header")
        style_ids = {cell.get("style_id", 0) for cell in component}
        if len(style_ids) == 1 and len(component) > 1:
            methods.append("style_similarity")
        if any(any(side for side in (cell.get("style") or {}).get("border", {}).values()) for cell in component):
            methods.append("border_continuity")
        rows = max_row - min_row + 1
        cols = max_col - min_col + 1
        values = [str(cell.get("display_value") or "").strip() for cell in component]
        obvious_list = cols == 1 and rows > 1 and all(re.match(r"^(?:[-*・]|\d+[.)、])\s*\S", value) for value in values)
        obvious_table = rows > 1 and cols > 1 and ("border_continuity" in methods or "merged_header" in methods)
        candidate_type = (
            "formula" if all(cell.get("formula") for cell in component)
            else "table" if obvious_table
            else "list" if obvious_list
            else "text"
        )
        confidence = min(0.95, 0.52 + min(len(component), 25) / 100 + (0.12 if candidate_type == "table" else 0))
        candidates.append(
            {
                "sheet_name": sheet_name,
                "start_cell": start,
                "end_cell": end,
                "candidate_type": candidate_type,
                "title": title or f"{sheet_name} {range_ref}",
                "detection_methods": methods,
                "confidence": round(confidence, 2),
                "candidate_status": "detected",
                "review_status": "approved",
            }
        )
    return candidates


def _ranges_intersect(left: str, right: str) -> bool:
    def bounds(value: str) -> tuple[int, int, int, int]:
        first, last = value.split(":") if ":" in value else (value, value)
        r1, c1 = _cell_position(first)
        r2, c2 = _cell_position(last)
        return min(r1, r2), min(c1, c2), max(r1, r2), max(c1, c2)

    a1, b1, a2, b2 = bounds(left)
    c1, d1, c2, d2 = bounds(right)
    return a1 <= c2 and c1 <= a2 and b1 <= d2 and d1 <= b2


def _sheet(
    zf: zipfile.ZipFile,
    name: str,
    state: str,
    path: str,
    shared: list[dict],
    styles: list[dict],
    work: Path,
) -> dict:
    root = _read_xml(zf, path)
    rel_path = posixpath.join(posixpath.dirname(path), "_rels", posixpath.basename(path) + ".rels")
    relationships = _rels(zf, rel_path, path)
    comment_target = next((rel["target"] for rel in relationships.values() if rel["type"] == "comments"), "")
    comments = _comments(zf, comment_target) if comment_target else {}
    hyperlink_by_cell = {}
    for link in root.findall("x:hyperlinks/x:hyperlink", NS):
        rel = relationships.get(link.get(qn("r:id"), ""), {})
        hyperlink_by_cell[link.get("ref", "")] = {
            "target": rel.get("target") if rel.get("external") else link.get("location"),
            "display": link.get("display"),
            "external": bool(rel.get("external")),
        }
    rows_meta = []
    cells = []
    truncated = False
    for row in root.findall("x:sheetData/x:row", NS):
        rows_meta.append(
            {
                "row": int(row.get("r", "0")),
                "height": float(row.get("ht")) if row.get("ht") else None,
                "hidden": row.get("hidden") == "1",
                "outline_level": int(row.get("outlineLevel", "0")),
            }
        )
        for cell in row.findall("x:c", NS):
            if len(cells) >= MAX_CELLS:
                truncated = True
                break
            address = cell.get("r", "")
            row_no, col_no = _cell_position(address)
            kind = cell.get("t", "n")
            value_node = cell.find("x:v", NS)
            raw = value_node.text if value_node is not None else None
            rich_runs = None
            if kind == "s" and raw is not None and raw.isdigit() and int(raw) < len(shared):
                display = shared[int(raw)]["text"]
                rich_runs = shared[int(raw)]["runs"]
            elif kind == "inlineStr":
                display = "".join((node.text or "") for node in cell.findall(".//x:is//x:t", NS))
            elif kind == "b":
                display = "TRUE" if raw == "1" else "FALSE"
            else:
                display = raw
            formula = cell.find("x:f", NS)
            style_id = int(cell.get("s", "0"))
            cells.append(
                {
                    "address": address,
                    "row": row_no,
                    "column": col_no,
                    "raw_value": raw,
                    "display_value": display,
                    "data_type": kind,
                    "formula": formula.text if formula is not None else None,
                    "formula_attributes": dict(formula.attrib) if formula is not None else None,
                    "style_id": style_id,
                    "style": styles[style_id] if style_id < len(styles) else {},
                    "rich_text_runs": rich_runs,
                    "comment": comments.get(address),
                    "hyperlink": hyperlink_by_cell.get(address),
                }
            )
        if truncated:
            break
    merged_ranges = [node.get("ref", "") for node in root.findall("x:mergeCells/x:mergeCell", NS)]
    columns = []
    for col in root.findall("x:cols/x:col", NS):
        columns.append(
            {
                "min": int(col.get("min", "0")),
                "max": int(col.get("max", "0")),
                "width": float(col.get("width")) if col.get("width") else None,
                "hidden": col.get("hidden") == "1",
                "outline_level": int(col.get("outlineLevel", "0")),
            }
        )
    tables = []
    for rel in relationships.values():
        if rel["type"] == "table" and not rel["external"]:
            parsed = _table(zf, rel["target"])
            if parsed:
                tables.append(parsed)
    drawing_target = next((rel["target"] for rel in relationships.values() if rel["type"] == "drawing" and not rel["external"]), "")
    drawings = _drawing_parts(zf, drawing_target, work) if drawing_target else []
    candidates = _candidate_regions(cells, merged_ranges, tables, name) + _drawing_candidates(drawings, name)
    dimension = root.find("x:dimension", NS)
    views = root.find("x:sheetViews/x:sheetView", NS)
    return {
        "name": name,
        "state": state,
        "path": path,
        "dimension": dimension.get("ref") if dimension is not None else None,
        "zoom_scale": int(views.get("zoomScale", "100")) if views is not None else 100,
        "rows": rows_meta,
        "columns": columns,
        "cells": cells,
        "merged_ranges": merged_ranges,
        "tables": tables,
        "comments": [{"cell": ref, **comment} for ref, comment in comments.items()],
        "drawings": drawings,
        "truncated": truncated,
        "candidates": candidates,
    }


def extract_excel(file_path: str, work_dir: str) -> dict:
    source = Path(file_path)
    if source.suffix.lower() != ".xlsx":
        raise ValueError(".xlsx 形式だけを抽出できます")
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(source) as zf:
        _validate_package(zf)
        workbook = _read_xml(zf, "xl/workbook.xml")
        workbook_rels = _rels(zf, "xl/_rels/workbook.xml.rels", "xl/workbook.xml")
        shared = _shared_strings(zf)
        styles = _styles(zf)
        sheets = []
        warnings = []
        for sheet in workbook.findall("x:sheets/x:sheet", NS):
            rel = workbook_rels.get(sheet.get(qn("r:id"), ""), {})
            if not rel or rel.get("external"):
                warnings.append(f"シート参照を解決できません: {sheet.get('name', '')}")
                continue
            parsed = _sheet(
                zf,
                sheet.get("name", ""),
                sheet.get("state", "visible"),
                rel["target"],
                shared,
                styles,
                work,
            )
            unresolved = [item for item in parsed["drawings"] if item.get("connection_status") == "unresolved"]
            if unresolved:
                warnings.append(f"{parsed['name']}: 未解決コネクタ {len(unresolved)} 件（接続先を推測せず保持）")
            if parsed["truncated"]:
                warnings.append(f"{parsed['name']}: セル数上限 {MAX_CELLS} 件でプレビューを打ち切りました")
            sheets.append(parsed)
        defined_names = [
            {"name": item.get("name", ""), "local_sheet_id": item.get("localSheetId"), "formula": item.text or ""}
            for item in workbook.findall("x:definedNames/x:definedName", NS)
        ]
        known_prefixes = (
            "[Content_Types].xml",
            "_rels/",
            "docProps/",
            "xl/workbook.xml",
            "xl/_rels/",
            "xl/worksheets/",
            "xl/sharedStrings.xml",
            "xl/styles.xml",
            "xl/theme/",
            "xl/tables/",
            "xl/comments",
            "xl/threadedComments/",
            "xl/persons/",
            "xl/drawings/",
            "xl/media/",
            "xl/printerSettings/",
        )
        unsupported_parts = [
            {
                "part": info.filename,
                "byte_size": info.file_size,
                "reason": "初期Excel物理モデルの専用パーサー対象外",
            }
            for info in zf.infolist()
            if not info.is_dir() and not info.filename.startswith(known_prefixes)
        ]
        external_links = [
            {"id": rel_id, "target": rel["target"], "type": rel["type"]}
            for rel_id, rel in workbook_rels.items()
            if rel["external"] or rel["type"] == "externalLink"
        ]
        if unsupported_parts:
            warnings.append(f"未対応OOXMLパート {len(unsupported_parts)} 件（一覧保持済み）")
        if external_links:
            warnings.append(f"外部参照 {len(external_links)} 件（アクセスせず参照情報のみ保持）")
        candidates = [candidate for sheet in sheets for candidate in sheet.pop("candidates")]
        book_view = workbook.find("x:bookViews/x:workbookView", NS)
        active_tab = int(book_view.get("activeTab", "0")) if book_view is not None else 0
        result = {
            "metadata": {
                "extractor_name": EXTRACTOR_NAME,
                "extractor_version": EXTRACTOR_VERSION,
                "file_name": source.name,
                "sheet_count": len(sheets),
                "cell_count": sum(len(sheet["cells"]) for sheet in sheets),
            },
            "workbook": {
                "file_name": source.name,
                "active_tab": active_tab,
                "defined_names": defined_names,
                "external_links": external_links,
                "sheets": sheets,
            },
            "candidates": candidates,
            "package": {
                "parts": [{"part": info.filename, "byte_size": info.file_size} for info in zf.infolist() if not info.is_dir()],
                "unsupported_parts": unsupported_parts,
            },
            "review_hints": {"warnings": warnings},
        }
    output = work / "extract-excel.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return {
        "output_ref": str(output),
        "sheet_count": len(result["workbook"]["sheets"]),
        "cell_count": result["metadata"]["cell_count"],
        "candidate_count": len(result["candidates"]),
        "warning_count": len(result["review_hints"]["warnings"]),
    }


def run(job_id: str, parameters: dict, emit_progress, emit_result, emit_error) -> None:
    file_path = parameters.get("file_path")
    work_dir = parameters.get("work_dir")
    if not file_path or not work_dir:
        emit_error(job_id, "invalid_parameters", "file_path と work_dir は必須です")
        return
    emit_progress(job_id, 10, "XLSXパッケージとOOXMLを解析中")
    summary = extract_excel(str(file_path), str(work_dir))
    emit_progress(job_id, 90, f"候補 {summary['candidate_count']} 件を生成")
    emit_result(job_id, "success", output=summary, output_ref=summary["output_ref"])
