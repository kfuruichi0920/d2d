"""E2E用の最小Excel設計文書を生成する（P5-19）。"""

from __future__ import annotations

import sys
from pathlib import Path
import zipfile


def make_xlsx(path: Path) -> None:
    workbook = """<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <bookViews><workbookView activeTab="0"/></bookViews>
 <sheets>
  <sheet name="要求" sheetId="1" state="visible" r:id="rId1"/>
  <sheet name="秘密" sheetId="2" state="hidden" r:id="rId2"/>
 </sheets>
</workbook>"""
    rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
</Relationships>"""
    sheet1 = """<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <dimension ref="A1:B3"/>
 <sheetData>
  <row r="1"><c r="A1" t="inlineStr"><is><t>ID</t></is></c><c r="B1" t="inlineStr"><is><t>要求</t></is></c></row>
  <row r="2"><c r="A2" t="inlineStr"><is><t>REQ-EX-1</t></is></c><c r="B2" t="inlineStr"><is><t>温度異常時に停止する</t></is></c></row>
  <row r="3"><c r="A3"><f>COUNTA(A2:A2)</f><v>1</v></c><c r="B3" t="inlineStr"><is><t>件数</t></is></c></row>
 </sheetData>
 <mergeCells count="1"><mergeCell ref="A1:B1"/></mergeCells>
</worksheet>"""
    sheet2 = """<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
 <dimension ref="A1"/>
 <sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>LLMへ送信してはいけない秘密</t></is></c></row></sheetData>
</worksheet>"""
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("[Content_Types].xml", "<Types/>")
        zf.writestr("xl/workbook.xml", workbook)
        zf.writestr("xl/_rels/workbook.xml.rels", rels)
        zf.writestr("xl/worksheets/sheet1.xml", sheet1)
        zf.writestr("xl/worksheets/sheet2.xml", sheet2)


if __name__ == "__main__":
    make_xlsx(Path(sys.argv[1]))
