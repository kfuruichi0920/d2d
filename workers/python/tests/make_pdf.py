"""テスト・E2E用の最小PDF設計文書を生成する（P5-20A）。

外部ライブラリを使わず PDF 1.4 のオブジェクトを直接書き出す。
3ページ構成: 見出し＋本文＋リスト / 罫線表＋キャプション / 埋込み画像＋キャプション。
全ページに同位置のヘッダ「D2D SPEC」とページ番号を持つ（ヘッダ・フッタ候補の検証用）。
文字は標準14フォント（Helvetica）で表現できる ASCII のみとする。
"""

from __future__ import annotations

import sys
import zlib
from pathlib import Path

PAGE_WIDTH = 612
PAGE_HEIGHT = 792


class _Builder:
    def __init__(self) -> None:
        self.objects: list[bytes] = []

    def add(self, body: bytes) -> int:
        self.objects.append(body)
        return len(self.objects)

    def add_stream(self, dictionary: str, data: bytes) -> int:
        compressed = zlib.compress(data)
        head = f"<< {dictionary} /Length {len(compressed)} /Filter /FlateDecode >>\nstream\n".encode("ascii")
        return self.add(head + compressed + b"\nendstream")

    def build(self, root_ref: int) -> bytes:
        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets = [0]
        for number, body in enumerate(self.objects, start=1):
            offsets.append(len(out))
            out += f"{number} 0 obj\n".encode("ascii") + body + b"\nendobj\n"
        xref_at = len(out)
        out += f"xref\n0 {len(self.objects) + 1}\n".encode("ascii")
        out += b"0000000000 65535 f \n"
        for offset in offsets[1:]:
            out += f"{offset:010d} 00000 n \n".encode("ascii")
        out += (
            f"trailer\n<< /Size {len(self.objects) + 1} /Root {root_ref} 0 R >>\nstartxref\n{xref_at}\n%%EOF\n"
        ).encode("ascii")
        return bytes(out)


def _text(font: str, size: int, x: int, y: int, value: str) -> str:
    escaped = value.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
    return f"BT /{font} {size} Tf {x} {y} Td ({escaped}) Tj ET\n"


def _chrome(page_number: int) -> str:
    ops = _text("F1", 8, 72, 762, "D2D SPEC")
    ops += _text("F1", 8, 300, 30, str(page_number))
    return ops


def _page1() -> str:
    ops = _chrome(1)
    ops += _text("F2", 16, 72, 700, "1. System Configuration")
    ops += _text("F1", 10, 72, 660, "This system consists of a controller and a sensor unit.")
    ops += _text("F1", 10, 72, 646, "The controller polls the sensor every second and stores")
    ops += _text("F1", 10, 72, 632, "the measured values into the local database.")
    ops += _text("F1", 10, 90, 596, "- stop the heater on abnormal temperature")
    ops += _text("F1", 10, 90, 582, "- raise an alarm to the operator console")
    return ops


def _page2() -> str:
    ops = _chrome(2)
    ops += _text("F2", 14, 72, 700, "2. Components")
    # 罫線格子（3行×3列）: 水平線4本＋垂直線4本
    for y in (680, 650, 620, 590):
        ops += f"72 {y} m 522 {y} l S\n"
    for x in (72, 222, 372, 522):
        ops += f"{x} 590 m {x} 680 l S\n"
    cells = [
        ("ID", "Name", "Role"),
        ("C-1", "Controller", "Main control unit"),
        ("C-2", "Sensor", "Temperature input"),
    ]
    for row_index, row in enumerate(cells):
        y = 680 - 30 * row_index - 20
        for column_index, value in enumerate(row):
            ops += _text("F1", 10, 80 + 150 * column_index, y, value)
    ops += _text("F1", 9, 72, 570, "Table 1 Component list")
    return ops


def _page3() -> str:
    ops = _chrome(3)
    ops += _text("F2", 14, 72, 700, "3. Overview Diagram")
    ops += "q 200 0 0 150 200 500 cm /Im1 Do Q\n"
    ops += _text("F1", 9, 220, 480, "Figure 1 Overview")
    return ops


def make_pdf(path: Path) -> None:
    builder = _Builder()
    font_regular = builder.add(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"
    )
    font_bold = builder.add(
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
    )
    # 4x4 の赤系RGB画像（フィルタなし）
    pixels = bytes([200, 40, 40] * 16)
    image = builder.add_stream(
        "/Type /XObject /Subtype /Image /Width 4 /Height 4 /ColorSpace /DeviceRGB /BitsPerComponent 8",
        pixels,
    )
    contents = [builder.add_stream("", ops.encode("ascii")) for ops in (_page1(), _page2(), _page3())]
    resources = (
        f"/Resources << /Font << /F1 {font_regular} 0 R /F2 {font_bold} 0 R >> "
        f"/XObject << /Im1 {image} 0 R >> >>"
    )
    pages_ref = len(builder.objects) + len(contents) + 1
    page_refs = []
    for content in contents:
        page_refs.append(
            builder.add(
                (
                    f"<< /Type /Page /Parent {pages_ref} 0 R /MediaBox [0 0 {PAGE_WIDTH} {PAGE_HEIGHT}] "
                    f"{resources} /Contents {content} 0 R >>"
                ).encode("ascii")
            )
        )
    kids = " ".join(f"{ref} 0 R" for ref in page_refs)
    pages = builder.add(f"<< /Type /Pages /Kids [{kids}] /Count {len(page_refs)} >>".encode("ascii"))
    assert pages == pages_ref
    root = builder.add(f"<< /Type /Catalog /Pages {pages} 0 R >>".encode("ascii"))
    path.write_bytes(builder.build(root))


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("sample-design.pdf")
    make_pdf(target)
    print(target.resolve())
