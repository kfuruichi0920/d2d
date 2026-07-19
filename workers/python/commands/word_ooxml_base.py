"""Word OOXML 高度抽出（P5-17、EXT-042〜048）。

python-docx で取得できない保存情報を標準ライブラリだけで補完する。表示レイアウトは
復元せず、Part、Relationship、原本 XML、構造、書式、Story、描画要素を保持する。
"""

from __future__ import annotations

import hashlib
import json
import posixpath
import re
import zipfile
from collections.abc import Callable
from pathlib import Path, PurePosixPath
from xml.etree import ElementTree as ET

MAX_ENTRIES = 4096
MAX_ENTRY_SIZE = 32 * 1024 * 1024
MAX_TOTAL_SIZE = 256 * 1024 * 1024
MAX_XML_DEPTH = 256

NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "wp": "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing",
    "wps": "http://schemas.microsoft.com/office/word/2010/wordprocessingShape",
    "wpg": "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup",
    "pic": "http://schemas.openxmlformats.org/drawingml/2006/picture",
    "v": "urn:schemas-microsoft-com:vml",
    "mc": "http://schemas.openxmlformats.org/markup-compatibility/2006",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "ct": "http://schemas.openxmlformats.org/package/2006/content-types",
    "cp": "http://schemas.openxmlformats.org/package/2006/metadata/core-properties",
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcterms": "http://purl.org/dc/terms/",
}

FEATURE_DEFAULTS = {
    "extract_shapes": True,
    "extract_shape_text": True,
    "extract_connectors": True,
    "extract_smartart": True,
    "extract_charts": True,
    "extract_ole": True,
    "extract_revisions": True,
    "extract_comments": True,
    "extract_fields": True,
    "extract_content_controls": True,
    "preserve_raw_xml": True,
}

SUPPORTED_TAGS = {
    "document", "body", "p", "pPr", "r", "rPr", "t", "tab", "br", "cr",
    "tbl", "tblPr", "tblGrid", "gridCol", "tr", "trPr", "tc", "tcPr",
    "pStyle", "numPr", "numId", "ilvl", "sectPr", "drawing", "pict",
    "bookmarkStart", "bookmarkEnd", "hyperlink", "fldSimple", "fldChar", "instrText",
    "ins", "del", "moveFrom", "moveTo", "sdt", "sdtPr", "sdtContent",
    "commentRangeStart", "commentRangeEnd", "commentReference",
}


def qn(name: str) -> str:
    prefix, local = name.split(":")
    return f"{{{NS[prefix]}}}{local}"


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def bool_value(element: ET.Element | None) -> bool | None:
    if element is None:
        return None
    value = element.get(qn("w:val"))
    return value is None or value.lower() not in {"0", "false", "off", "none"}


def validate_package(zf: zipfile.ZipFile) -> None:
    infos = zf.infolist()
    if len(infos) > MAX_ENTRIES:
        raise ValueError(f"DOCX の ZIP エントリ数が上限を超えています: {len(infos)}")
    total = 0
    for info in infos:
        path = PurePosixPath(info.filename)
        if path.is_absolute() or ".." in path.parts:
            raise ValueError(f"DOCX に不正な ZIP パスがあります: {info.filename}")
        if info.file_size > MAX_ENTRY_SIZE:
            raise ValueError(f"DOCX の ZIP エントリが大きすぎます: {info.filename}")
        total += info.file_size
        if total > MAX_TOTAL_SIZE:
            raise ValueError("DOCX の展開後サイズが上限を超えています")


def read_xml(zf: zipfile.ZipFile, name: str) -> tuple[ET.Element, bytes]:
    data = zf.read(name)
    upper = data[:4096].upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise ValueError(f"DTD または外部実体を含む XML は解析できません: {name}")
    root = ET.fromstring(data)
    stack = [(root, 1)]
    while stack:
        node, depth = stack.pop()
        if depth > MAX_XML_DEPTH:
            raise ValueError(f"XML 階層が上限を超えています: {name}")
        stack.extend((child, depth + 1) for child in node)
    return root, data


def _content_types(zf: zipfile.ZipFile) -> tuple[dict[str, str], dict[str, str]]:
    defaults: dict[str, str] = {}
    overrides: dict[str, str] = {}
    try:
        root, _ = read_xml(zf, "[Content_Types].xml")
    except KeyError:
        return defaults, overrides
    for item in root:
        if item.tag == qn("ct:Default"):
            defaults[item.get("Extension", "").lower()] = item.get("ContentType", "")
        elif item.tag == qn("ct:Override"):
            overrides[item.get("PartName", "").lstrip("/")] = item.get("ContentType", "")
    return defaults, overrides


def _rels_owner(name: str) -> str:
    if name == "_rels/.rels":
        return "/"
    folder, rel_name = posixpath.split(name)
    owner_folder = posixpath.dirname(folder)
    return "/" + posixpath.join(owner_folder, rel_name.removesuffix(".rels"))


def _relationships_for(zf: zipfile.ZipFile, rel_name: str) -> list[dict]:
    try:
        root, _ = read_xml(zf, rel_name)
    except KeyError:
        return []
    owner = _rels_owner(rel_name)
    base = posixpath.dirname(owner)
    result = []
    for rel in root.iter(qn("rel:Relationship")):
        target = rel.get("Target", "")
        external = rel.get("TargetMode") == "External"
        resolved = target if external else "/" + posixpath.normpath(posixpath.join(base.lstrip("/"), target))
        result.append({
            "id": rel.get("Id"),
            "type": rel.get("Type", "").rsplit("/", 1)[-1],
            "target": target,
            "target_part": resolved,
            "external": external,
        })
    return result


def package_inventory(zf: zipfile.ZipFile, raw_dir: Path | None) -> tuple[list[dict], dict[str, list[dict]]]:
    defaults, overrides = _content_types(zf)
    rels_by_owner: dict[str, list[dict]] = {}
    for name in zf.namelist():
        if name.endswith(".rels"):
            rels_by_owner[_rels_owner(name)] = _relationships_for(zf, name)
    inbound: dict[str, list[str]] = {}
    for owner, rels in rels_by_owner.items():
        for rel in rels:
            if not rel["external"]:
                inbound.setdefault(rel["target_part"], []).append(owner)

    parts = []
    for info in zf.infolist():
        if info.is_dir():
            continue
        data = zf.read(info.filename)
        content_type = overrides.get(info.filename, defaults.get(PurePosixPath(info.filename).suffix.lstrip(".").lower()))
        part_uri = "/" + info.filename
        raw_ref = None
        if raw_dir is not None and info.filename.lower().endswith((".xml", ".rels")):
            raw_dir.mkdir(parents=True, exist_ok=True)
            raw_name = hashlib.sha256(info.filename.encode("utf-8")).hexdigest()[:16] + ".xml"
            (raw_dir / raw_name).write_bytes(data)
            raw_ref = f"raw_xml/{raw_name}"
        parts.append({
            "part_uri": part_uri,
            "content_type": content_type,
            "kind": "xml" if info.filename.lower().endswith((".xml", ".rels")) else "binary",
            "byte_size": info.file_size,
            "sha256": hashlib.sha256(data).hexdigest(),
            "parent_parts": inbound.get(part_uri, []),
            "relationships": rels_by_owner.get(part_uri, []),
            "raw_xml_ref": raw_ref,
            "parse_status": "preserved" if raw_ref else "inventoried",
        })
    return parts, rels_by_owner


def parse_numbering(zf: zipfile.ZipFile) -> dict[str, dict]:
    try:
        root, _ = read_xml(zf, "word/numbering.xml")
    except KeyError:
        return {}
    abstracts: dict[str, dict[int, dict]] = {}
    for abstract in root.findall(qn("w:abstractNum")):
        aid = abstract.get(qn("w:abstractNumId"), "")
        levels: dict[int, dict] = {}
        for level in abstract.findall(qn("w:lvl")):
            ilvl = int(level.get(qn("w:ilvl"), "0"))
            fmt = level.find(qn("w:numFmt"))
            text = level.find(qn("w:lvlText"))
            start = level.find(qn("w:start"))
            ppr = level.find(qn("w:pPr"))
            ind = ppr.find(qn("w:ind")) if ppr is not None else None
            levels[ilvl] = {
                "number_format": fmt.get(qn("w:val")) if fmt is not None else None,
                "level_text": text.get(qn("w:val")) if text is not None else None,
                "start": int(start.get(qn("w:val"), "1")) if start is not None else 1,
                "indent_left": ind.get(qn("w:left")) if ind is not None else None,
                "hanging": ind.get(qn("w:hanging")) if ind is not None else None,
            }
        abstracts[aid] = levels
    result: dict[str, dict] = {}
    for num in root.findall(qn("w:num")):
        num_id = num.get(qn("w:numId"), "")
        aid = num.find(qn("w:abstractNumId"))
        abstract_id = aid.get(qn("w:val"), "") if aid is not None else ""
        overrides = {}
        for override in num.findall(qn("w:lvlOverride")):
            ilvl = int(override.get(qn("w:ilvl"), "0"))
            start = override.find(qn("w:startOverride"))
            if start is not None:
                overrides[ilvl] = int(start.get(qn("w:val"), "1"))
        result[num_id] = {"abstract_num_id": abstract_id, "levels": abstracts.get(abstract_id, {}), "start_overrides": overrides}
    return result


def run_format(run: ET.Element) -> dict:
    rpr = run.find(qn("w:rPr"))
    if rpr is None:
        return {"direct": {}, "effective": {}}

    def val(name: str) -> str | None:
        item = rpr.find(qn(f"w:{name}"))
        return item.get(qn("w:val")) if item is not None else None

    direct = {
        "bold": bool_value(rpr.find(qn("w:b"))),
        "italic": bool_value(rpr.find(qn("w:i"))),
        "underline": val("u"),
        "strike": bool_value(rpr.find(qn("w:strike"))),
        "double_strike": bool_value(rpr.find(qn("w:dstrike"))),
        "color": val("color"),
        "highlight": val("highlight"),
        "shading": rpr.find(qn("w:shd")).get(qn("w:fill")) if rpr.find(qn("w:shd")) is not None else None,
        "font_size_half_points": val("sz"),
        "vertical_align": val("vertAlign"),
        "hidden": bool_value(rpr.find(qn("w:vanish"))),
        "character_spacing": val("spacing"),
        "position": val("position"),
        "emphasis": val("em"),
        "east_asian_layout": val("eastAsianLayout"),
    }
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is not None:
        direct["font_ascii"] = fonts.get(qn("w:ascii"))
        direct["font_east_asia"] = fonts.get(qn("w:eastAsia"))
    direct = {key: value for key, value in direct.items() if value is not None}
    return {"direct": direct, "effective": dict(direct)}


def paragraph_data(p: ET.Element, numbering: dict[str, dict]) -> dict:
    runs = []
    fields = []
    bookmarks = []
    for bookmark in p.iter(qn("w:bookmarkStart")):
        bookmarks.append({"id": bookmark.get(qn("w:id")), "name": bookmark.get(qn("w:name"))})
    for run in p.iter(qn("w:r")):
        text = "".join((node.text or "") for node in run.iter() if node.tag in {qn("w:t"), qn("w:delText")})
        breaks = [node.get(qn("w:type"), "line") for node in run.iter(qn("w:br"))]
        tabs = len(list(run.iter(qn("w:tab"))))
        if text or breaks or tabs:
            runs.append({"text": text, "format": run_format(run), "breaks": breaks, "tab_count": tabs})
    for simple in p.iter(qn("w:fldSimple")):
        fields.append({"instruction": simple.get(qn("w:instr")), "cached_result": "".join((t.text or "") for t in simple.iter(qn("w:t")))})
    instructions = "".join((node.text or "") for node in p.iter(qn("w:instrText"))).strip()
    if instructions:
        fields.append({"instruction": instructions, "cached_result": "".join((t.text or "") for t in p.iter(qn("w:t")))})
    ppr = p.find(qn("w:pPr"))
    style = None
    list_info = None
    paragraph_format = {}
    if ppr is not None:
        style_el = ppr.find(qn("w:pStyle"))
        style = style_el.get(qn("w:val")) if style_el is not None else None
        num_pr = ppr.find(qn("w:numPr"))
        if num_pr is not None:
            num_el = num_pr.find(qn("w:numId"))
            lvl_el = num_pr.find(qn("w:ilvl"))
            num_id = num_el.get(qn("w:val"), "0") if num_el is not None else "0"
            ilvl = int(lvl_el.get(qn("w:val"), "0")) if lvl_el is not None else 0
            definition = numbering.get(num_id, {})
            level_def = definition.get("levels", {}).get(ilvl, {})
            list_info = {
                "num_id": num_id,
                "abstract_num_id": definition.get("abstract_num_id"),
                "level": ilvl,
                **level_def,
                "start": definition.get("start_overrides", {}).get(ilvl, level_def.get("start", 1)),
                "kind": "bullet" if level_def.get("number_format") == "bullet" else "numbered",
            }
        for tag, key in [("jc", "alignment"), ("textDirection", "text_direction"), ("textAlignment", "text_alignment")]:
            item = ppr.find(qn(f"w:{tag}"))
            if item is not None:
                paragraph_format[key] = item.get(qn("w:val"))
        ind = ppr.find(qn("w:ind"))
        if ind is not None:
            paragraph_format["indent"] = {local_name(k): v for k, v in ind.attrib.items()}
        spacing = ppr.find(qn("w:spacing"))
        if spacing is not None:
            paragraph_format["spacing"] = {local_name(k): v for k, v in spacing.attrib.items()}
    text_parts = []
    for run in runs:
        text_parts.append(run["text"])
        text_parts.extend("\t" for _ in range(run["tab_count"]))
        text_parts.extend("\n" for _ in run["breaks"])
    return {
        "text": "".join(text_parts),
        "style": style,
        "runs": runs,
        "list_info": list_info,
        "paragraph_format": paragraph_format,
        "fields": fields,
        "bookmarks": bookmarks,
    }


def _position_and_size(root: ET.Element) -> tuple[dict | None, dict | None, int | None]:
    inline = next(iter(root.iter(qn("wp:inline"))), None)
    anchor = next(iter(root.iter(qn("wp:anchor"))), None)
    frame = anchor if anchor is not None else inline
    if frame is None:
        return None, None, None
    extent = frame.find(qn("wp:extent"))
    size = {"width": int(extent.get("cx", "0")), "height": int(extent.get("cy", "0"))} if extent is not None else None
    position = None
    if anchor is not None:
        ph, pv = anchor.find(qn("wp:positionH")), anchor.find(qn("wp:positionV"))
        x = ph.find(qn("wp:posOffset")) if ph is not None else None
        y = pv.find(qn("wp:posOffset")) if pv is not None else None
        position = {
            "x": int(x.text or "0") if x is not None else None,
            "y": int(y.text or "0") if y is not None else None,
            "relative_from_x": ph.get("relativeFrom") if ph is not None else None,
            "relative_from_y": pv.get("relativeFrom") if pv is not None else None,
        }
    return position, size, int(anchor.get("relativeHeight", "0")) if anchor is not None else None


def drawing_elements(
    paragraph: ET.Element,
    next_id: Callable[[], str],
    anchor_uid: str,
    numbering: dict[str, dict],
    features: dict[str, bool],
) -> list[dict]:
    if not features["extract_shapes"]:
        return []
    roots = []

    def select(node: ET.Element) -> None:
        if node.tag == qn("mc:AlternateContent"):
            choice = node.find(qn("mc:Choice"))
            fallback = node.find(qn("mc:Fallback"))
            selected = choice if choice is not None else fallback
            if selected is not None:
                for child in selected:
                    select(child)
            return
        if node.tag in {qn("w:drawing"), qn("w:pict")}:
            roots.append(node)
            return
        for child in node:
            select(child)

    select(paragraph)
    result: list[dict] = []
    recognized = {qn("wps:wsp"), qn("a:sp"), qn("a:cxnSp"), qn("v:shape"), qn("v:rect"), qn("v:oval"), qn("v:line")}
    groups = {qn("wpg:wgp"), qn("a:grpSp")}

    def walk(node: ET.Element, parent_uid: str | None, root: ET.Element) -> None:
        current_parent = parent_uid
        if node.tag in groups:
            uid = next_id()
            result.append({
                "id": uid, "uid": uid, "type": "group_shape", "element_type": "group_shape",
                "parent_uid": parent_uid, "anchor_paragraph_uid": anchor_uid,
                "source_format": "DrawingML", "source_part": "/word/document.xml",
            })
            current_parent = uid
        elif node.tag in recognized:
            connector = node.tag in {qn("a:cxnSp"), qn("v:line")}
            if connector and not features["extract_connectors"]:
                return
            uid = next_id()
            c_nv = next(iter(node.iter(qn("a:cNvPr"))), None)
            native_id = c_nv.get("id") if c_nv is not None else node.get("id")
            name = c_nv.get("name") if c_nv is not None else node.get("id")
            geom = next(iter(node.iter(qn("a:prstGeom"))), None)
            position, size, z_order = _position_and_size(root)
            text_body = []
            if features["extract_shape_text"]:
                for p in node.iter(qn("w:p")):
                    text_body.append(paragraph_data(p, numbering))
                for p in node.iter(qn("a:p")):
                    text = "".join((t.text or "") for t in p.iter(qn("a:t")))
                    if text:
                        text_body.append({"text": text, "runs": [{"text": text, "format": {"direct": {}, "effective": {}}}], "list_info": None})
            item = {
                "id": uid, "uid": uid, "type": "connector" if connector else "shape",
                "element_type": "connector" if connector else "shape",
                "shape_type": geom.get("prst") if geom is not None else local_name(node.tag),
                "native_id": native_id, "name": name, "parent_uid": current_parent,
                "anchor_paragraph_uid": anchor_uid, "text": "\n".join(p["text"] for p in text_body),
                "text_body": {"paragraphs": text_body}, "position": position, "size": size,
                "z_order": z_order, "source_format": "VML" if node.tag.startswith("{" + NS["v"]) else "DrawingML",
                "source_part": "/word/document.xml",
            }
            if connector:
                start = next(iter(node.iter(qn("a:stCxn"))), None)
                end = next(iter(node.iter(qn("a:endCxn"))), None)
                head = next(iter(node.iter(qn("a:headEnd"))), None)
                tail = next(iter(node.iter(qn("a:tailEnd"))), None)
                item.update({
                    "start_native_id": start.get("id") if start is not None else None,
                    "end_native_id": end.get("id") if end is not None else None,
                    "start_connection_index": start.get("idx") if start is not None else None,
                    "end_connection_index": end.get("idx") if end is not None else None,
                    "begin_arrow": head.get("type") if head is not None else None,
                    "end_arrow": tail.get("type") if tail is not None else None,
                    "connection_status": "resolved" if start is not None and end is not None else "unresolved",
                    "resolution_method": "explicit_connection_id" if start is not None or end is not None else "none",
                    "confidence": 1.0 if start is not None and end is not None else 0.0,
                })
            result.append(item)
        for child in node:
            walk(child, current_parent, root)

    for root in roots:
        walk(root, None, root)
    return result


def unsupported_report(parts: list[dict], zf: zipfile.ZipFile) -> list[dict]:
    counts: dict[tuple[str, str], int] = {}
    for part in parts:
        name = part["part_uri"].lstrip("/")
        if not name.endswith(".xml") or name not in zf.namelist():
            continue
        try:
            root, _ = read_xml(zf, name)
        except (ET.ParseError, ValueError):
            continue
        if not name.startswith("word/"):
            continue
        for node in root.iter():
            local = local_name(node.tag)
            if node.tag.startswith("{" + NS["w"]) and local not in SUPPORTED_TAGS:
                counts[(node.tag, part["part_uri"])] = counts.get((node.tag, part["part_uri"]), 0) + 1
    return [{
        "element_name": tag, "source_part": part, "count": count,
        "status": "unsupported", "raw_xml_preserved": bool(next((p["raw_xml_ref"] for p in parts if p["part_uri"] == part), None)),
    } for (tag, part), count in sorted(counts.items())]


def story_elements(root: ET.Element, story_type: str, numbering: dict[str, dict], next_id: Callable[[], str]) -> list[dict]:
    items = []
    for p in root.iter(qn("w:p")):
        data = paragraph_data(p, numbering)
        if not data["text"] and not data["fields"]:
            continue
        uid = next_id()
        items.append({"id": uid, "uid": uid, "type": "paragraph", "element_type": "paragraph", "story_type": story_type, **data})
    return items


def extract_auxiliary(zf: zipfile.ZipFile, numbering: dict[str, dict], next_id: Callable[[], str], features: dict[str, bool]) -> dict:
    stories = []
    comments = []
    revisions = []
    for name in zf.namelist():
        match = re.fullmatch(r"word/(header|footer)(\d+)\.xml", name)
        if match:
            root, _ = read_xml(zf, name)
            story_type = match.group(1)
            stories.append({"story_type": story_type, "source_part": "/" + name, "elements": story_elements(root, story_type, numbering, next_id)})
        elif name in {"word/footnotes.xml", "word/endnotes.xml"}:
            root, _ = read_xml(zf, name)
            story_type = "footnote" if "footnotes" in name else "endnote"
            stories.append({"story_type": story_type, "source_part": "/" + name, "elements": story_elements(root, story_type, numbering, next_id)})
        elif features["extract_comments"] and re.fullmatch(r"word/comments.*\.xml", name):
            root, _ = read_xml(zf, name)
            for comment in root.iter(qn("w:comment")):
                comments.append({
                    "comment_id": comment.get(qn("w:id")), "author": comment.get(qn("w:author")),
                    "initials": comment.get(qn("w:initials")), "date": comment.get(qn("w:date")),
                    "text": "\n".join(paragraph_data(p, numbering)["text"] for p in comment.iter(qn("w:p"))),
                    "source_part": "/" + name,
                })
    if features["extract_revisions"]:
        root, _ = read_xml(zf, "word/document.xml")
        for node in root.iter():
            if node.tag in {qn("w:ins"), qn("w:del"), qn("w:moveFrom"), qn("w:moveTo")}:
                revisions.append({
                    "revision_id": node.get(qn("w:id")), "type": local_name(node.tag),
                    "author": node.get(qn("w:author")), "date": node.get(qn("w:date")),
                    "text": "".join((t.text or "") for t in node.iter() if t.tag in {qn("w:t"), qn("w:delText")}),
                    "source_part": "/word/document.xml",
                })
    return {"stories": stories, "comments": comments, "revisions": revisions}


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=1), encoding="utf-8")
