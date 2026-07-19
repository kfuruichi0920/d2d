"""Word OOXML高度抽出の公開モジュール（P5-17、EXT-042〜048）。"""

from __future__ import annotations

import zipfile
from xml.etree import ElementTree as ET

from commands.word_ooxml_base import *  # noqa: F403 - 公開契約を一箇所に集約
from commands import word_ooxml_base as _base


def unsupported_report(parts: list[dict], zf: zipfile.ZipFile) -> list[dict]:
    """既知のw要素に加え、未対応のWord拡張名前空間も欠落として報告する。"""
    counts: dict[tuple[str, str], int] = {}
    known_word_namespaces = {_base.NS["w"], _base.NS["wps"], _base.NS["wpg"]}
    for part in parts:
        name = part["part_uri"].lstrip("/")
        if not name.endswith(".xml") or name not in zf.namelist() or not name.startswith("word/"):
            continue
        try:
            root, _ = _base.read_xml(zf, name)
        except (ET.ParseError, KeyError, ValueError):  # 個別Partの欠損は文書全体を止めず、inventoryの状態で追跡する
            continue
        for node in root.iter():
            namespace = node.tag[1:].split("}", 1)[0] if node.tag.startswith("{") else ""
            local = _base.local_name(node.tag)
            unsupported_w = namespace == _base.NS["w"] and local not in _base.SUPPORTED_TAGS
            unsupported_extension = (
                ("schemas.microsoft.com/office/word" in namespace or "schemas.microsoft.com/office/word/" in namespace)
                and namespace not in known_word_namespaces
            )
            if unsupported_w or unsupported_extension:
                counts[(node.tag, part["part_uri"])] = counts.get((node.tag, part["part_uri"]), 0) + 1
    return [
        {
            "element_name": tag,
            "source_part": part,
            "count": count,
            "status": "unsupported",
            "raw_xml_preserved": bool(
                next((entry["raw_xml_ref"] for entry in parts if entry["part_uri"] == part), None)
            ),
        }
        for (tag, part), count in sorted(counts.items())
    ]
