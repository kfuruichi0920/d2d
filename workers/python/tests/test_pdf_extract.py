"""PDF抽出ワーカーのテスト（P5-20A、IMP-005/EXT-012/EXT-027）。

pdfplumber / pypdfium2 が未導入の環境ではスキップする
（実行時依存は workers/python/requirements.txt を参照）。
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
    import pdfplumber  # noqa: F401
    import pypdfium2  # noqa: F401

    HAS_PDF_LIBS = True
except ImportError:  # pragma: no cover - 環境依存
    HAS_PDF_LIBS = False

from make_pdf import make_pdf  # noqa: E402

if HAS_PDF_LIBS:
    from commands.pdf import extract_pdf, reanalyze_regions  # noqa: E402


@unittest.skipUnless(HAS_PDF_LIBS, "pdfplumber / pypdfium2 が未導入")
class PdfExtractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls._tmp = tempfile.TemporaryDirectory()
        base = Path(cls._tmp.name)
        cls.pdf_path = base / "sample-design.pdf"
        make_pdf(cls.pdf_path)
        cls.work_dir = base / "work"
        cls.summary = extract_pdf(str(cls.pdf_path), str(cls.work_dir))
        cls.result = json.loads(Path(cls.summary["output_ref"]).read_text(encoding="utf-8"))

    @classmethod
    def tearDownClass(cls) -> None:
        cls._tmp.cleanup()

    def _candidates(self, region_type: str) -> list[dict]:
        return [item for item in self.result["candidates"] if item["region_type"] == region_type]

    def test_metadata_and_pages(self) -> None:
        metadata = self.result["metadata"]
        self.assertEqual(metadata["page_count"], 3)
        self.assertTrue(metadata["has_text_layer"])
        pages = self.result["document"]["pages"]
        self.assertEqual(len(pages), 3)
        for page in pages:
            self.assertAlmostEqual(page["width"], 612, delta=1)
            self.assertAlmostEqual(page["height"], 792, delta=1)
            image_path = Path(self.work_dir) / page["image_file"]
            self.assertTrue(image_path.exists(), image_path)
            self.assertGreater(page["image_width"], 0)
            self.assertAlmostEqual(page["image_width"] / page["width"], page["image_scale"], places=2)

    def test_blocks_hold_font_and_bbox(self) -> None:
        page1 = self.result["document"]["pages"][0]
        heading_line = next(
            line
            for block in page1["blocks"]
            for line in block["lines"]
            if "System Configuration" in line["text"]
        )
        self.assertGreaterEqual(heading_line["size"], 15)
        self.assertTrue(heading_line["bold"])
        self.assertEqual(len(heading_line["bbox"]), 4)

    def test_heading_candidate(self) -> None:
        headings = self._candidates("heading")
        self.assertTrue(any("System Configuration" in item["title"] for item in headings))
        target = next(item for item in headings if "System Configuration" in item["title"])
        self.assertEqual(target["review_status"], "approved")
        self.assertIn("font-size", target["detection_methods"])
        self.assertEqual(target.get("level"), 1)

    def test_text_and_list_candidates(self) -> None:
        texts = self._candidates("text")
        self.assertTrue(any("controller polls" in item["text_preview"] for item in texts))
        lists = self._candidates("list")
        self.assertTrue(any("stop the heater" in item["text_preview"] for item in lists))

    def test_table_candidate_with_rows(self) -> None:
        tables = self._candidates("table")
        self.assertEqual(len(tables), 1)
        table = tables[0]
        self.assertEqual(table["page_index"], 1)
        self.assertEqual(table["table_data"]["row_count"], 3)
        self.assertEqual(table["table_data"]["column_count"], 3)
        self.assertEqual(table["table_data"]["rows"][0][0], "ID")
        self.assertEqual(table["table_data"]["rows"][2][1], "Sensor")

    def test_figure_candidate_from_embedded_image(self) -> None:
        figures = self._candidates("figure")
        self.assertTrue(any(item["page_index"] == 2 for item in figures))
        figure = next(item for item in figures if item["page_index"] == 2)
        self.assertIn("embedded-image", figure["detection_methods"])
        x0, top, x1, bottom = figure["bbox"]
        self.assertGreater(x1 - x0, 100)
        self.assertGreater(bottom - top, 80)

    def test_caption_candidates(self) -> None:
        captions = self._candidates("caption")
        self.assertTrue(any("Table 1" in item["title"] for item in captions))
        self.assertTrue(any("Figure 1" in item["title"] for item in captions))
        figure_caption = next(item for item in captions if "Figure 1" in item["title"])
        self.assertTrue(figure_caption.get("caption_of_key"))

    def test_header_and_page_number_rejected_by_default(self) -> None:
        headers = self._candidates("header")
        self.assertEqual(len(headers), 3)
        self.assertTrue(all(item["review_status"] == "rejected" for item in headers))
        page_numbers = self._candidates("page_number")
        self.assertEqual(len(page_numbers), 3)
        self.assertTrue(all(item["review_status"] == "rejected" for item in page_numbers))

    def test_reading_order_heading_before_body(self) -> None:
        page1 = [item for item in self.result["candidates"] if item["page_index"] == 0]
        heading = next(item for item in page1 if item["region_type"] == "heading")
        body = next(item for item in page1 if item["region_type"] == "text")
        lst = next(item for item in page1 if item["region_type"] == "list")
        self.assertLess(heading["reading_order"], body["reading_order"])
        self.assertLess(body["reading_order"], lst["reading_order"])

    def test_candidate_keys_are_unique(self) -> None:
        keys = [item["candidate_key"] for item in self.result["candidates"]]
        self.assertEqual(len(keys), len(set(keys)))

    def test_reanalyze_table_region(self) -> None:
        table = self._candidates("table")[0]
        result = reanalyze_regions(
            str(self.pdf_path),
            str(Path(self._tmp.name) / "region"),
            [{"page_index": 1, "bbox": table["bbox"], "mode": "table"}],
        )
        entry = result["results"][0]
        self.assertEqual(entry["table"]["row_count"], 3)
        self.assertEqual(entry["table"]["rows"][1][0], "C-1")

    def test_reanalyze_text_and_crop(self) -> None:
        work = Path(self._tmp.name) / "region2"
        result = reanalyze_regions(
            str(self.pdf_path),
            str(work),
            [
                {"page_index": 0, "bbox": [60, 70, 550, 220], "mode": "text"},
                {"page_index": 2, "bbox": [200, 490, 400, 650], "mode": "crop"},
                {"page_index": 9, "bbox": [0, 0, 10, 10], "mode": "text"},
            ],
        )
        text_entry, crop_entry, invalid_entry = result["results"]
        self.assertIn("System Configuration", text_entry["text"])
        self.assertTrue((work / crop_entry["image_file"]).exists())
        self.assertGreater(crop_entry["width"], 100)
        self.assertIn("error", invalid_entry)


if __name__ == "__main__":
    unittest.main()
