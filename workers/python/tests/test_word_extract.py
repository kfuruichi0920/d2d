"""Word 抽出コマンドのテスト（P5-4）。生成した検証用 docx から構造を検証する。"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from commands.word import extract_word  # noqa: E402
from make_docx import make_docx  # noqa: E402


def _extract(tmp_path: Path) -> dict:
    docx = make_docx(str(tmp_path / "spec.docx"))
    extract_word(docx, str(tmp_path / "work"))
    return json.loads((tmp_path / "work" / "extract.json").read_text(encoding="utf-8"))


def test_metadata(tmp_path: Path):
    result = _extract(tmp_path)
    assert result["metadata"]["title"] == "テスト仕様書"
    assert result["metadata"]["creator"] == "d2d-test"
    assert result["metadata"]["extractor_name"] == "d2d-word-extractor"
    assert result["metadata"]["extractor_version"]


def test_heading_hierarchy_and_section_path(tmp_path: Path):
    """EXT-001: 章・節の抽出と階層（section_path）"""
    result = _extract(tmp_path)
    headings = [e for e in result["elements"] if e["type"] == "heading"]
    assert [h["text"] for h in headings] == ["1. 概要", "1.1 対象範囲", "2. 構成"]
    assert [h["level"] for h in headings] == [1, 2, 1]

    # 節配下の段落は親見出しの section_path を持つ
    para = next(e for e in result["elements"] if e["type"] == "paragraph" and "REQ-001" in e["text"])
    assert para["section_path"] == "1. 概要"
    lists = [e for e in result["elements"] if e["type"] == "list_item"]
    assert lists[0]["section_path"] == "1. 概要/1.1 対象範囲"


def test_list_items_with_levels(tmp_path: Path):
    """EXT-003: 箇条書きと階層"""
    result = _extract(tmp_path)
    lists = [e for e in result["elements"] if e["type"] == "list_item"]
    assert [item["text"] for item in lists] == ["対象項目その1", "対象項目その2", "詳細項目"]
    assert [item["level"] for item in lists] == [0, 0, 1]


def test_table_with_merged_cells(tmp_path: Path):
    """EXT-004 / EXT-017: 表（結合セル含む）"""
    result = _extract(tmp_path)
    tables = [e for e in result["elements"] if e["type"] == "table"]
    assert len(tables) == 1
    table = tables[0]
    assert table["row_count"] == 3
    assert table["rows"][0][0]["text"] == "項目"
    assert table["rows"][1][1]["text"] == "100ms以内"
    assert table["rows"][2][0]["colspan"] == 2


def test_figure_and_captions(tmp_path: Path):
    """EXT-005 / EXT-006: 図の切り出しとキャプション"""
    result = _extract(tmp_path)
    figures = [e for e in result["elements"] if e["type"] == "figure"]
    assert len(figures) == 1
    assert figures[0]["image"] == "media/image1.png"
    assert figures[0]["width"] == 1
    assert figures[0]["height"] == 1
    assert figures[0]["byte_size"] > 0
    assert figures[0]["image_format"] == "PNG"
    assert (tmp_path / "work" / "media" / "image1.png").exists()

    captions = [e for e in result["elements"] if e["type"] == "caption"]
    assert [c["text"] for c in captions] == ["表1 性能要件一覧", "図1 システム構成図"]


def test_element_ids_unique_and_ordered(tmp_path: Path):
    """EXT-013: 重複しない ID 付与"""
    result = _extract(tmp_path)
    ids = [e["id"] for e in result["elements"]]
    assert len(ids) == len(set(ids))
    assert ids[0] == "e1"
