"""テスト用 .docx 生成ユーティリティ（P5-4 検証用文書、sdd_tech_stack §7）。

外部ライブラリなしで最小の OpenXML パッケージを構築する。
pytest と E2E（Node から CLI 起動）の両方から使う。

CLI: python make_docx.py <出力パス>
"""

from __future__ import annotations

import base64
import sys
import zipfile

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

# 1x1 透明 PNG
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Default Extension="png" ContentType="image/png"/>
 <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
 <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
 <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>"""

ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>"""

CORE = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
 xmlns:dc="http://purl.org/dc/elements/1.1/">
 <dc:title>テスト仕様書</dc:title>
 <dc:creator>d2d-test</dc:creator>
</cp:coreProperties>"""

STYLES = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="{W}">
 <w:style w:type="paragraph" w:styleId="Heading1">
  <w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr>
 </w:style>
 <w:style w:type="paragraph" w:styleId="Heading2">
  <w:name w:val="heading 2"/><w:pPr><w:outlineLvl w:val="1"/></w:pPr>
 </w:style>
 <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/></w:style>
</w:styles>"""


def _p(text: str, style: str | None = None, ilvl: int | None = None) -> str:
    ppr = ""
    if style or ilvl is not None:
        num = f'<w:numPr><w:ilvl w:val="{ilvl}"/><w:numId w:val="1"/></w:numPr>' if ilvl is not None else ""
        st = f'<w:pStyle w:val="{style}"/>' if style else ""
        ppr = f"<w:pPr>{st}{num}</w:pPr>"
    return f"<w:p>{ppr}<w:r><w:t>{text}</w:t></w:r></w:p>"


def _tc(text: str, colspan: int | None = None) -> str:
    pr = f'<w:tcPr><w:gridSpan w:val="{colspan}"/></w:tcPr>' if colspan else ""
    return f"<w:tc>{pr}<w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:tc>"


DOCUMENT = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="{W}" xmlns:r="{R}"
 xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
 xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
 xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
 <w:body>
  {_p("1. 概要", "Heading1")}
  {_p("本書はテスト用の仕様書である。要求REQ-001を含む。")}
  {_p("1.1 対象範囲", "Heading2")}
  {_p("対象項目その1", ilvl=0)}
  {_p("対象項目その2", ilvl=0)}
  {_p("詳細項目", ilvl=1)}
  <w:tbl>
   <w:tr>{_tc("項目")}{_tc("値")}</w:tr>
   <w:tr>{_tc("応答時間")}{_tc("100ms以内")}</w:tr>
   <w:tr>{_tc("結合セル", colspan=2)}</w:tr>
  </w:tbl>
  {_p("表1 性能要件一覧", "Caption")}
  {_p("2. 構成", "Heading1")}
  <w:p><w:r><w:drawing><wp:inline>
   <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
    <pic:pic><pic:blipFill><a:blip r:embed="rId10"/></pic:blipFill></pic:pic>
   </a:graphicData></a:graphic>
  </wp:inline></w:drawing></w:r></w:p>
  {_p("図1 システム構成図", "Caption")}
  {_p("システムは2つのモジュールで構成される。")}
 </w:body>
</w:document>"""


def make_docx(path: str) -> str:
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", CONTENT_TYPES)
        zf.writestr("_rels/.rels", ROOT_RELS)
        zf.writestr("word/document.xml", DOCUMENT)
        zf.writestr("word/_rels/document.xml.rels", DOC_RELS)
        zf.writestr("word/styles.xml", STYLES)
        zf.writestr("word/media/image1.png", PNG_1PX)
        zf.writestr("docProps/core.xml", CORE)
    return path


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "test.docx"
    make_docx(out)
    print(out)
