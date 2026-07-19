"""Word OOXML高度抽出の回帰試験（P5-17、EXT-042〜048）。"""

import json
import sys
import zipfile
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from commands.word import extract_word  # noqa: E402
from make_advanced_docx import make_advanced_docx  # noqa: E402


def _extract(tmp_path: Path) -> dict:
    source = make_advanced_docx(str(tmp_path / "advanced.docx"))
    extract_word(source, str(tmp_path / "work"))
    return json.loads((tmp_path / "work" / "extract.json").read_text(encoding="utf-8"))


def test_numbering_and_run_format_are_preserved(tmp_path: Path):
    result = _extract(tmp_path)
    item = next(e for e in result["elements"] if e["type"] == "list_item")
    assert item["list_info"] == {
        "num_id": "7",
        "abstract_num_id": "10",
        "level": 1,
        "number_format": "decimal",
        "level_text": "%1.%2",
        "start": 3,
        "indent_left": None,
        "hanging": None,
        "kind": "numbered",
    }
    direct = item["runs"][0]["format"]["direct"]
    assert direct["bold"] is True
    assert direct["underline"] == "double"
    assert direct["strike"] is True
    assert direct["color"] == "FF0000"
    assert direct["highlight"] == "yellow"


def test_shapes_groups_connectors_and_vml_text(tmp_path: Path):
    result = _extract(tmp_path)
    group = next(e for e in result["elements"] if e["type"] == "group_shape")
    shapes = [e for e in result["elements"] if e["type"] == "shape"]
    connector = next(e for e in result["elements"] if e["type"] == "connector")
    assert {shape["text"] for shape in shapes} >= {"入力処理\n二段落目", "出力", "VML文字"}
    assert next(shape for shape in shapes if shape["text"].startswith("入力処理"))["parent_uid"] == group["uid"]
    assert connector["parent_uid"] == group["uid"]
    assert connector["connection_status"] == "resolved"
    assert connector["start_native_id"] == "11"
    assert connector["end_native_id"] == "13"
    assert connector["end_arrow"] == "triangle"
    assert len([shape for shape in shapes if shape["native_id"] == "20"]) == 1
    assert not any(shape["native_id"] == "duplicate" for shape in shapes)


def test_header_footer_page_field_comment_revision_and_reference(tmp_path: Path):
    result = _extract(tmp_path)
    stories = {story["story_type"]: story for story in result["stories"]}
    assert stories["header"]["elements"][0]["text"] == "機密ヘッダ"
    assert stories["footer"]["elements"][0]["fields"][0]["instruction"].strip() == "PAGE"
    assert result["comments"][0]["text"] == "確認コメント"
    assert result["revisions"][0]["type"] == "ins"
    reference = next(e for e in result["elements"] if e["bookmarks"])
    assert reference["bookmarks"][0]["name"] == "Target"
    assert reference["fields"][0]["instruction"].strip() == "REF Target"


def test_package_inventory_raw_xml_and_unsupported_report(tmp_path: Path):
    result = _extract(tmp_path)
    document_part = next(p for p in result["package"]["parts"] if p["part_uri"] == "/word/document.xml")
    assert document_part["sha256"]
    assert document_part["raw_xml_ref"].startswith("raw_xml/")
    assert (tmp_path / "work" / document_part["raw_xml_ref"]).exists()
    unsupported = next(item for item in result["unsupported_elements"] if item["element_name"].endswith("contentPart"))
    assert unsupported["raw_xml_preserved"] is True
    assert result["statistics"]["unsupported_kind_count"] > 0


def test_feature_flags_can_disable_shapes_and_raw_xml(tmp_path: Path):
    source = make_advanced_docx(str(tmp_path / "advanced.docx"))
    extract_word(source, str(tmp_path / "work"), {"extract_shapes": False, "preserve_raw_xml": False})
    result = json.loads((tmp_path / "work" / "extract.json").read_text(encoding="utf-8"))
    assert not any(e["type"] in {"shape", "group_shape", "connector"} for e in result["elements"])
    assert all(part["raw_xml_ref"] is None for part in result["package"]["parts"])


def test_rejects_dtd_xml(tmp_path: Path):
    source = tmp_path / "unsafe.docx"
    with zipfile.ZipFile(source, "w") as zf:
        zf.writestr("[Content_Types].xml", '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>')
        zf.writestr("word/document.xml", '<!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><x>&e;</x>')
    with pytest.raises(ValueError, match="DTD"):
        extract_word(str(source), str(tmp_path / "work"))
