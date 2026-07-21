"""Excel抽出ワーカーのブラックボックス相当テスト（P5-19、EXT-049〜054）。"""

from __future__ import annotations

import tempfile
import zipfile
from pathlib import Path
import os
import unittest

from commands.excel import extract_excel


def _write_xlsx(path: Path) -> None:
    workbook = """<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <bookViews><workbookView activeTab="0"/></bookViews>
 <sheets><sheet name="要求一覧" sheetId="1" state="visible" r:id="rId1"/></sheets>
 <definedNames><definedName name="Requirements">要求一覧!$A$1:$B$3</definedName></definedNames>
</workbook>"""
    workbook_rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.invalid/book.xlsx" TargetMode="External"/>
</Relationships>"""
    shared = """<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="4" uniqueCount="4">
 <si><t>ID</t></si><si><t>要求</t></si><si><t>REQ-1</t></si><si><r><rPr><b/></rPr><t>停止する</t></r></si>
</sst>"""
    styles = """<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <fonts count="1"><font><name val="Meiryo"/><sz val="11"/><b/></font></fonts>
 <fills count="1"><fill><patternFill patternType="solid"><fgColor rgb="FFF0F0F0"/></patternFill></fill></fills>
 <borders count="1"><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders>
 <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"><alignment wrapText="1"/></xf></cellXfs>
</styleSheet>"""
    sheet = """<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <dimension ref="A1:B3"/>
 <sheetViews><sheetView zoomScale="90"/></sheetViews>
 <cols><col min="1" max="2" width="18"/></cols>
 <sheetData>
  <row r="1" ht="24"><c r="A1" t="s" s="0"><v>0</v></c><c r="B1" t="s" s="0"><v>1</v></c></row>
  <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>
  <row r="3"><c r="A3"><f>LEN(B2)</f><v>4</v></c><c r="B3" t="inlineStr"><is><t>確認</t></is></c></row>
 </sheetData>
 <mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>
 <hyperlinks><hyperlink ref="A2" r:id="rIdLink"/></hyperlinks>
 <tableParts count="1"><tablePart r:id="rIdTable"/></tableParts>
</worksheet>"""
    sheet_rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rIdComment" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments1.xml"/>
 <Relationship Id="rIdTable" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/table" Target="../tables/table1.xml"/>
 <Relationship Id="rIdLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.invalid/req" TargetMode="External"/>
</Relationships>"""
    comments = """<?xml version="1.0" encoding="UTF-8"?>
<comments xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <authors><author>設計者</author></authors>
 <commentList><comment ref="B2" authorId="0"><text><t>安全要求</t></text></comment></commentList>
</comments>"""
    table = """<?xml version="1.0" encoding="UTF-8"?>
<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" id="1" name="RequirementTable" displayName="RequirementTable" ref="A1:B3">
 <tableColumns count="2"><tableColumn id="1" name="ID"/><tableColumn id="2" name="要求"/></tableColumns>
</table>"""
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        zf.writestr("xl/sharedStrings.xml", shared)
        zf.writestr("xl/styles.xml", styles)
        zf.writestr("xl/worksheets/sheet1.xml", sheet)
        zf.writestr("xl/worksheets/_rels/sheet1.xml.rels", sheet_rels)
        zf.writestr("xl/comments1.xml", comments)
        zf.writestr("xl/tables/table1.xml", table)
        zf.writestr("custom/unsupported.xml", "<custom/>")


def assert_excel_extraction() -> None:
    with tempfile.TemporaryDirectory(dir=os.environ.get("D2D_TEST_TMP")) as temp:
        root = Path(temp)
        source = root / "requirements.xlsx"
        _write_xlsx(source)

        summary = extract_excel(str(source), str(root / "work"))
        import json

        output = json.loads(Path(summary["output_ref"]).read_text(encoding="utf-8"))

    assert summary["sheet_count"] == 1
    assert summary["cell_count"] == 6
    assert output["workbook"]["active_tab"] == 0
    sheet = output["workbook"]["sheets"][0]
    assert sheet["name"] == "要求一覧"
    assert sheet["merged_ranges"] == ["A1:B1"]
    assert sheet["tables"][0]["name"] == "RequirementTable"
    by_address = {cell["address"]: cell for cell in sheet["cells"]}
    assert by_address["B2"]["display_value"] == "停止する"
    assert by_address["B2"]["rich_text_runs"][0]["style"]["bold"] is True
    assert by_address["B2"]["comment"]["text"] == "安全要求"
    assert by_address["A2"]["hyperlink"]["external"] is True
    assert by_address["A3"]["formula"] == "LEN(B2)"
    assert output["candidates"][0]["detection_methods"] == ["structured_table"]
    assert output["workbook"]["external_links"][0]["target"].startswith("https://")
    assert output["package"]["unsupported_parts"][0]["part"] == "custom/unsupported.xml"
    assert any("外部参照" in warning for warning in output["review_hints"]["warnings"])


class ExcelExtractionTest(unittest.TestCase):
    def test_preserves_physical_facts_and_generates_candidates(self) -> None:
        assert_excel_extraction()


if __name__ == "__main__":
    unittest.main()
