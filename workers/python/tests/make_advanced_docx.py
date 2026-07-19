"""P5-17 Word高度抽出の機能別DOCX試験データ生成。"""

from __future__ import annotations

import zipfile
from pathlib import Path

from make_docx import CORE, ROOT_RELS, STYLES

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
WPS = "http://schemas.microsoft.com/office/word/2010/wordprocessingShape"
WPG = "http://schemas.microsoft.com/office/word/2010/wordprocessingGroup"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
V = "urn:schemas-microsoft-com:vml"
W14 = "http://schemas.microsoft.com/office/word/2010/wordml"

CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
 <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
 <Default Extension="xml" ContentType="application/xml"/>
 <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
 <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
 <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
 <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
 <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
 <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
 <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>"""

DOC_RELS = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rIdHeader" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
 <Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
 <Relationship Id="rIdComments" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
</Relationships>"""

NUMBERING = f"""<w:numbering xmlns:w="{W}">
 <w:abstractNum w:abstractNumId="10">
  <w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl>
  <w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl>
 </w:abstractNum>
 <w:num w:numId="7"><w:abstractNumId w:val="10"/><w:lvlOverride w:ilvl="1"><w:startOverride w:val="3"/></w:lvlOverride></w:num>
</w:numbering>"""

HEADER = f"""<w:hdr xmlns:w="{W}">
 <w:p><w:r><w:t>機密ヘッダ</w:t></w:r></w:p>
</w:hdr>"""

FOOTER = f"""<w:ftr xmlns:w="{W}">
 <w:p><w:fldSimple w:instr=" PAGE "><w:r><w:t>2</w:t></w:r></w:fldSimple></w:p>
</w:ftr>"""

COMMENTS = f"""<w:comments xmlns:w="{W}">
 <w:comment w:id="0" w:author="確認者" w:initials="KK" w:date="2026-07-19T00:00:00Z">
  <w:p><w:r><w:t>確認コメント</w:t></w:r></w:p>
 </w:comment>
</w:comments>"""

DOCUMENT = f"""<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="{W}" xmlns:r="{R}" xmlns:a="{A}" xmlns:wp="{WP}"
 xmlns:wps="{WPS}" xmlns:wpg="{WPG}" xmlns:mc="{MC}" xmlns:v="{V}" xmlns:w14="{W14}">
 <w:body>
  <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>高度抽出</w:t></w:r></w:p>
  <w:p>
   <w:pPr><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr></w:pPr>
   <w:r><w:rPr><w:b/><w:u w:val="double"/><w:strike/><w:color w:val="FF0000"/><w:highlight w:val="yellow"/></w:rPr><w:t>書式付きリスト</w:t></w:r>
  </w:p>
  <w:p>
   <w:bookmarkStart w:id="4" w:name="Target"/><w:r><w:t>参照先</w:t></w:r><w:bookmarkEnd w:id="4"/>
   <w:fldSimple w:instr=" REF Target "><w:r><w:t>参照先</w:t></w:r></w:fldSimple>
  </w:p>
  <w:p>
   <w:r><w:drawing><wp:anchor relativeHeight="3"><wp:positionH relativeFrom="column"><wp:posOffset>100</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>200</wp:posOffset></wp:positionV><wp:extent cx="4000" cy="2000"/><a:graphic><a:graphicData>
    <wpg:wgp>
     <wps:wsp><a:cNvPr id="11" name="Process"/><a:spPr><a:prstGeom prst="flowChartProcess"/></a:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>入力処理</w:t></w:r></w:p><w:p><w:r><w:t>二段落目</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>
     <a:cxnSp><a:nvCxnSpPr><a:cNvPr id="12" name="Connector"/><a:cNvCxnSpPr><a:stCxn id="11" idx="1"/><a:endCxn id="13" idx="3"/></a:cNvCxnSpPr></a:nvCxnSpPr><a:spPr><a:prstGeom prst="bentConnector2"/><a:ln><a:tailEnd type="triangle"/></a:ln></a:spPr></a:cxnSp>
     <wps:wsp><a:cNvPr id="13" name="Output"/><a:spPr><a:prstGeom prst="roundRect"/></a:spPr><wps:txbx><w:txbxContent><w:p><w:r><w:t>出力</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>
    </wpg:wgp>
   </a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>
  </w:p>
  <w:p><w:r><w:pict><v:rect id="vml-1"><v:textbox><w:txbxContent><w:p><w:r><w:t>VML文字</w:t></w:r></w:p></w:txbxContent></v:textbox></v:rect></w:pict></w:r></w:p>
  <w:p><mc:AlternateContent><mc:Choice Requires="wps"><w:r><w:drawing><wp:inline><wp:extent cx="1" cy="1"/><a:graphic><a:graphicData><wps:wsp><a:cNvPr id="20" name="Choice"/><a:spPr><a:prstGeom prst="rect"/></a:spPr></wps:wsp></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></mc:Choice><mc:Fallback><w:r><w:pict><v:rect id="duplicate"/></w:pict></w:r></mc:Fallback></mc:AlternateContent></w:p>
  <w:ins w:id="9" w:author="編集者" w:date="2026-07-19T00:00:00Z"><w:r><w:t>追加文</w:t></w:r></w:ins>
  <w14:contentPart r:id="missing"/>
  <w:sectPr><w:headerReference w:type="default" r:id="rIdHeader"/><w:footerReference w:type="default" r:id="rIdFooter"/></w:sectPr>
 </w:body>
</w:document>"""


def make_advanced_docx(path: str) -> str:
    output = Path(path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, value in {
            "[Content_Types].xml": CONTENT_TYPES,
            "_rels/.rels": ROOT_RELS,
            "docProps/core.xml": CORE,
            "word/document.xml": DOCUMENT,
            "word/styles.xml": STYLES,
            "word/numbering.xml": NUMBERING,
            "word/header1.xml": HEADER,
            "word/footer1.xml": FOOTER,
            "word/comments.xml": COMMENTS,
            "word/_rels/document.xml.rels": DOC_RELS,
        }.items():
            zf.writestr(name, value)
    return str(output)
