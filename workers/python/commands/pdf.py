"""PDF物理抽出・抽出領域候補生成（P5-20A、IMP-005/EXT-012/EXT-027）。

pdfplumber で PDF 内部の物理情報（文字・座標・フォント・線・矩形・画像・リンク）を
取得し、pypdfium2 でページ画像をレンダリングする。論理構造（見出し・本文・表・図・
ヘッダ等）はルールベースの「抽出領域候補」として生成し、確定はユーザーレビュー後に
Local Backend が行う（②正本と分離。物理抽出層と論理構造化層の分離）。

安全方針: PDF 内 JavaScript・埋込みファイルを実行しない。外部リンクへアクセスしない。
暗号化 PDF は解析せずエラーとする。ページ数・要素数・画像サイズに上限を設ける。
"""

from __future__ import annotations

import json
import math
import re
import statistics
from pathlib import Path

EXTRACTOR_NAME = "d2d-pdf-extractor"
EXTRACTOR_VERSION = "0.1.0"

# 安全上限（メモリ枯渇・巨大画像対策）
MAX_FILE_SIZE = 256 * 1024 * 1024
MAX_PAGES = 300
MAX_WORDS_PER_PAGE = 20_000
MAX_DRAWINGS_PER_PAGE = 3_000
MAX_TABLE_CELLS = 5_000
RENDER_SCALE = 2.0  # 144dpi 相当
MAX_RENDER_WIDTH_PX = 4_000

# 論理構造化層の領域種別（②へ変換しない除外系は EXCLUDED_TYPES）
REGION_TYPES = (
    "heading",
    "text",
    "list",
    "table",
    "figure",
    "caption",
    "formula",
    "header",
    "footer",
    "page_number",
    "decoration",
    "unknown",
)
EXCLUDED_TYPES = ("header", "footer", "page_number", "decoration")

CAPTION_RE = re.compile(r"^(図|表|Fig(?:ure)?\.?|Table)[\s　]*([0-9０-９][0-9０-９.\-]*)?", re.IGNORECASE)
NUMBERING_RE = re.compile(r"^[0-9０-９]{1,3}([.．][0-9０-９]{1,3})*[.．\s)）]")
BULLET_RE = re.compile(r"^([-*•・◦▪‣]|[(（]?[0-9a-zA-Z０-９]{1,3}[)）.、]|[①-⑳])\s*")
PAGE_NUMBER_RE = re.compile(r"^[\s\-−–—ー]*([0-9０-９]{1,5}|#)([\s/／]*(of|／|/)?[\s]*([0-9０-９]{1,5}|#))?[\s\-−–—ー]*$")


def _load_pdfplumber():
    try:
        import pdfplumber  # noqa: PLC0415
    except ImportError as e:  # pragma: no cover - 環境依存
        raise ValueError(
            "pdfplumber がインストールされていません。workers/python/requirements.txt の依存を導入してください"
        ) from e
    return pdfplumber


def _load_pdfium():
    try:
        import pypdfium2  # noqa: PLC0415
    except ImportError as e:  # pragma: no cover - 環境依存
        raise ValueError(
            "pypdfium2 がインストールされていません。workers/python/requirements.txt の依存を導入してください"
        ) from e
    return pypdfium2


def _round_bbox(x0: float, top: float, x1: float, bottom: float) -> list[float]:
    return [round(x0, 2), round(top, 2), round(x1, 2), round(bottom, 2)]


def _color_hex(value) -> str | None:
    """pdfminer の non_stroking_color をおおよその #RRGGBB へ変換する（1/3成分のみ対応）。"""
    if value is None:
        return None
    if isinstance(value, (int, float)):
        value = (value, value, value)
    if isinstance(value, (list, tuple)):
        try:
            if len(value) == 1:
                value = (value[0], value[0], value[0])
            if len(value) == 3:
                rgb = [max(0, min(255, round(float(component) * 255))) for component in value]
                return "#{:02x}{:02x}{:02x}".format(*rgb)
        except (TypeError, ValueError):
            return None
    return None


def _font_style(fontname: str) -> tuple[bool, bool]:
    lower = (fontname or "").lower()
    bold = any(mark in lower for mark in ("bold", "black", "heavy", "semibold"))
    italic = any(mark in lower for mark in ("italic", "oblique"))
    return bold, italic


def _group_lines(words: list[dict]) -> list[dict]:
    """単語を行へまとめる（ベースライン近接。検討資料 §8.1）。"""
    lines: list[dict] = []
    for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
        height = word["bottom"] - word["top"]
        center = (word["top"] + word["bottom"]) / 2
        target = None
        for line in lines:
            line_center = (line["top"] + line["bottom"]) / 2
            line_height = line["bottom"] - line["top"]
            if abs(center - line_center) <= 0.45 * max(height, line_height, 1.0):
                target = line
                break
        if target is None:
            bold, italic = _font_style(word.get("fontname", ""))
            lines.append(
                {
                    "words": [word],
                    "x0": word["x0"],
                    "x1": word["x1"],
                    "top": word["top"],
                    "bottom": word["bottom"],
                    "size": float(word.get("size", 0) or 0),
                    "fontname": word.get("fontname", ""),
                    "bold": bold,
                    "italic": italic,
                    "color": _color_hex(word.get("non_stroking_color")),
                }
            )
        else:
            target["words"].append(word)
            target["x0"] = min(target["x0"], word["x0"])
            target["x1"] = max(target["x1"], word["x1"])
            target["top"] = min(target["top"], word["top"])
            target["bottom"] = max(target["bottom"], word["bottom"])
            target["size"] = max(target["size"], float(word.get("size", 0) or 0))
    for line in lines:
        line["text"] = " ".join(word["text"] for word in sorted(line["words"], key=lambda item: item["x0"]))
        del line["words"]
    return lines


def _group_blocks(lines: list[dict], page_number: int) -> list[dict]:
    """行を段落ブロックへまとめる（行間・横方向重なり。検討資料 §8.1）。"""
    blocks: list[dict] = []
    current: list[dict] = []

    def flush() -> None:
        if not current:
            return
        x0 = min(line["x0"] for line in current)
        x1 = max(line["x1"] for line in current)
        top = min(line["top"] for line in current)
        bottom = max(line["bottom"] for line in current)
        blocks.append(
            {
                "block_id": f"p{page_number}-b{len(blocks) + 1}",
                "bbox": _round_bbox(x0, top, x1, bottom),
                "text": "\n".join(line["text"] for line in current),
                "lines": [
                    {
                        "text": line["text"],
                        "bbox": _round_bbox(line["x0"], line["top"], line["x1"], line["bottom"]),
                        "size": round(line["size"], 2),
                        "fontname": line["fontname"],
                        "bold": line["bold"],
                        "italic": line["italic"],
                        "color": line["color"],
                    }
                    for line in current
                ],
            }
        )
        current.clear()

    for line in sorted(lines, key=lambda item: (item["top"], item["x0"])):
        if current:
            previous = current[-1]
            gap = line["top"] - previous["bottom"]
            height = max(min(previous["bottom"] - previous["top"], line["bottom"] - line["top"]), 1.0)
            x_overlap = min(previous["x1"], line["x1"]) - max(previous["x0"], line["x0"])
            same_style = abs(line["size"] - previous["size"]) <= 0.6
            if gap > 0.9 * height or x_overlap <= 0 or not same_style:
                flush()
        current.append(line)
    flush()
    return blocks


def _bbox_area(bbox: list[float]) -> float:
    return max(0.0, bbox[2] - bbox[0]) * max(0.0, bbox[3] - bbox[1])


def _overlap_ratio(inner: list[float], outer: list[float]) -> float:
    """inner のうち outer と重なる面積比。"""
    x0 = max(inner[0], outer[0])
    top = max(inner[1], outer[1])
    x1 = min(inner[2], outer[2])
    bottom = min(inner[3], outer[3])
    if x1 <= x0 or bottom <= top:
        return 0.0
    area = _bbox_area(inner)
    if area <= 0:
        return 0.0
    return ((x1 - x0) * (bottom - top)) / area


def _merge_bboxes(bboxes: list[list[float]], gap: float) -> list[list[float]]:
    """近接する bbox を反復的に統合する（図候補クラスタリング用）。"""
    merged = [list(bbox) for bbox in bboxes]
    changed = True
    while changed:
        changed = False
        result: list[list[float]] = []
        for bbox in merged:
            hit = None
            for existing in result:
                if (
                    bbox[0] - gap <= existing[2]
                    and existing[0] - gap <= bbox[2]
                    and bbox[1] - gap <= existing[3]
                    and existing[1] - gap <= bbox[3]
                ):
                    hit = existing
                    break
            if hit is None:
                result.append(bbox)
            else:
                hit[0] = min(hit[0], bbox[0])
                hit[1] = min(hit[1], bbox[1])
                hit[2] = max(hit[2], bbox[2])
                hit[3] = max(hit[3], bbox[3])
                changed = True
        merged = result
    return merged


def _normalize_recurring_text(text: str) -> str:
    return re.sub(r"[0-9０-９]+", "#", text).strip()


def _detect_recurring(pages: list[dict]) -> dict[int, list[dict]]:
    """複数ページの同位置に繰り返す行をヘッダ・フッタ・ページ番号候補にする（検討資料 §8.4）。"""
    page_count = len(pages)
    occurrences: dict[tuple, list[tuple[int, dict]]] = {}
    for page in pages:
        height = page["height"]
        for block in page["blocks"]:
            for line in block["lines"]:
                bbox = line["bbox"]
                in_top = bbox[3] <= height * 0.09
                in_bottom = bbox[1] >= height * 0.91
                if not in_top and not in_bottom:
                    continue
                band = "top" if in_top else "bottom"
                key = (band, _normalize_recurring_text(line["text"]), round(bbox[0] / 20), round(bbox[1] / 20))
                occurrences.setdefault(key, []).append((page["page_index"], line))
    threshold = max(2, math.ceil(page_count * 0.6))
    results: dict[int, list[dict]] = {}
    for key, entries in occurrences.items():
        band, normalized, _, _ = key
        pages_seen = {page_index for page_index, _ in entries}
        is_page_number = bool(PAGE_NUMBER_RE.fullmatch(normalized))
        if len(pages_seen) < threshold and not (is_page_number and page_count >= 2 and len(pages_seen) >= 2):
            continue
        if is_page_number:
            region_type = "page_number"
        else:
            region_type = "header" if band == "top" else "footer"
        for page_index, line in entries:
            results.setdefault(page_index, []).append(
                {
                    "region_type": region_type,
                    "bbox": line["bbox"],
                    "text": line["text"],
                    "pages_seen": len(pages_seen),
                }
            )
    return results


def _table_candidates(plumber_page, page_number: int, warnings: list[str]) -> list[dict]:
    """罫線格子から表候補を生成する（検討資料 §8.3。罫線のない表は第一弾では対象外）。"""
    candidates = []
    try:
        tables = plumber_page.find_tables()
    except Exception as e:  # noqa: BLE001 - 1ページの表検出失敗で全体を止めない
        warnings.append(f"ページ{page_number}: 表検出に失敗しました（{e}）")
        return candidates
    for table in tables:
        rows = table.extract()
        if not rows or len(rows) < 2 or max(len(row) for row in rows) < 2:
            continue
        column_count = max(len(row) for row in rows)
        if len(rows) * column_count > MAX_TABLE_CELLS:
            rows = rows[: max(1, MAX_TABLE_CELLS // column_count)]
            warnings.append(f"ページ{page_number}: 表セル数上限 {MAX_TABLE_CELLS} で行を打ち切りました")
        normalized_rows = [[(cell if isinstance(cell, str) else "") for cell in row] for row in rows]
        candidates.append(
            {
                "region_type": "table",
                "bbox": _round_bbox(*table.bbox),
                "detection_methods": ["ruled-lines"],
                "confidence": 0.85,
                "table_data": {
                    "rows": normalized_rows,
                    "row_count": len(normalized_rows),
                    "column_count": column_count,
                    "header_row_count": 1,
                    "detection_method": "ruled-lines",
                },
            }
        )
    return candidates


def _figure_candidates(page: dict, table_bboxes: list[list[float]], page_area: float) -> list[dict]:
    """埋込み画像とベクター描画の集中から図候補を生成する（検討資料 §8.2）。"""
    candidates = []
    image_bboxes = _merge_bboxes([image["bbox"] for image in page["images"]], gap=5.0)
    for bbox in image_bboxes:
        if _bbox_area(bbox) < 24 * 24:
            continue
        candidates.append(
            {
                "region_type": "figure",
                "bbox": _round_bbox(*bbox),
                "detection_methods": ["embedded-image"],
                "confidence": 0.85,
            }
        )
    drawing_bboxes = [
        item["bbox"]
        for item in [*page["rules"]["lines"], *page["rules"]["rects"]]
        if not any(_overlap_ratio(item["bbox"], table_bbox) > 0.5 for table_bbox in table_bboxes)
    ]
    if len(drawing_bboxes) >= 10:
        for cluster in _merge_bboxes(drawing_bboxes, gap=8.0):
            area = _bbox_area(cluster)
            if cluster[2] - cluster[0] < 40 or cluster[3] - cluster[1] < 30:
                continue
            if area > page_area * 0.85:
                continue  # ページ全面の枠・装飾はクラスタにしない
            members = sum(1 for bbox in drawing_bboxes if _overlap_ratio(bbox, cluster) > 0.5)
            if members < 8:
                continue
            if any(_overlap_ratio(cluster, existing["bbox"]) > 0.6 for existing in candidates):
                continue
            candidates.append(
                {
                    "region_type": "figure",
                    "bbox": _round_bbox(*cluster),
                    "detection_methods": ["vector-cluster"],
                    "confidence": 0.5,
                }
            )
    return candidates


def _detect_recurring_images(pages: list[dict]) -> dict[int, list[list[float]]]:
    """複数ページの同位置に同サイズで繰り返す画像はロゴ等の装飾候補とする（検討資料 §9）。"""
    page_count = len(pages)
    if page_count < 3:
        return {}
    occurrences: dict[tuple, list[tuple[int, list[float]]]] = {}
    for page in pages:
        for image in page["images"]:
            bbox = image["bbox"]
            key = (round(bbox[0] / 5), round(bbox[1] / 5), round(bbox[2] / 5), round(bbox[3] / 5))
            occurrences.setdefault(key, []).append((page["page_index"], bbox))
    threshold = max(3, math.ceil(page_count * 0.6))
    results: dict[int, list[list[float]]] = {}
    for entries in occurrences.values():
        if len({page_index for page_index, _ in entries}) < threshold:
            continue
        for page_index, bbox in entries:
            results.setdefault(page_index, []).append(bbox)
    return results


def _candidate_key(page_number: int, sequence: int) -> str:
    return f"p{page_number}-r{sequence}"


def _build_candidates(pages: list[dict], plumber_pages: dict[int, object], warnings: list[str]) -> list[dict]:
    """ページ物理情報からルールベースの抽出領域候補を生成する（検討資料 §8〜§10）。"""
    all_sizes = [
        line["size"] for page in pages for block in page["blocks"] for line in block["lines"] if line["size"] > 0
    ]
    body_size = statistics.median(all_sizes) if all_sizes else 10.0
    recurring = _detect_recurring(pages)
    recurring_images = _detect_recurring_images(pages)
    candidates: list[dict] = []
    heading_sizes: set[float] = set()
    sequence = 0

    def append(page: dict, item: dict, review_status: str | None = None) -> dict:
        nonlocal sequence
        sequence += 1
        entry = {
            "candidate_key": _candidate_key(page["page_number"], sequence),
            "page_index": page["page_index"],
            "review_status": review_status
            or ("rejected" if item.get("region_type") in EXCLUDED_TYPES else "approved"),
            "candidate_status": "detected",
            "block_ids": [],
            "title": "",
            "text_preview": "",
            **item,
        }
        candidates.append(entry)
        return entry

    for page in pages:
        page_area = page["width"] * page["height"]
        page_candidates_start = len(candidates)

        # 1) ヘッダ・フッタ・ページ番号（既定で除外扱い、非破壊）
        recurring_bboxes: list[list[float]] = []
        for item in recurring.get(page["page_index"], []):
            recurring_bboxes.append(item["bbox"])
            append(
                page,
                {
                    "region_type": item["region_type"],
                    "bbox": item["bbox"],
                    "title": item["text"][:40],
                    "text_preview": item["text"][:200],
                    "detection_methods": ["recurring-position"],
                    "confidence": 0.9,
                },
            )

        # 2) 装飾（繰り返し画像）
        decoration_bboxes = recurring_images.get(page["page_index"], [])
        for bbox in decoration_bboxes:
            append(
                page,
                {
                    "region_type": "decoration",
                    "bbox": _round_bbox(*bbox),
                    "title": "繰り返し画像",
                    "detection_methods": ["recurring-image"],
                    "confidence": 0.7,
                },
            )

        # 3) 表（罫線格子）
        plumber_page = plumber_pages.get(page["page_index"])
        table_items = _table_candidates(plumber_page, page["page_number"], warnings) if plumber_page else []
        table_bboxes = [item["bbox"] for item in table_items]
        for item in table_items:
            preview = " | ".join(cell for cell in item["table_data"]["rows"][0] if cell)[:200]
            append(page, {**item, "title": f"表候補 ({item['table_data']['row_count']}行)", "text_preview": preview})

        # 4) 図（埋込み画像・ベクター集中）
        figure_items = _figure_candidates(page, table_bboxes, page_area)
        figure_items = [
            item
            for item in figure_items
            if not any(_overlap_ratio(item["bbox"], bbox) > 0.6 for bbox in decoration_bboxes)
        ]
        figure_bboxes = [item["bbox"] for item in figure_items]
        for item in figure_items:
            append(page, {**item, "title": "図候補"})

        # 5) テキストブロックの分類（キャプション → 見出し → リスト → 本文）
        consumed = [*recurring_bboxes, *decoration_bboxes]
        for block in page["blocks"]:
            bbox = block["bbox"]
            if any(_overlap_ratio(bbox, other) > 0.6 for other in [*consumed, *table_bboxes, *figure_bboxes]):
                continue
            first_line = block["lines"][0]
            text = block["text"]
            base = {
                "bbox": bbox,
                "block_ids": [block["block_id"]],
                "title": first_line["text"][:40],
                "text_preview": text[:200],
            }
            caption_match = CAPTION_RE.match(first_line["text"])
            if caption_match and caption_match.group(2):
                target = None
                best_distance = 50.0
                for item in [*table_items, *figure_items]:
                    x_overlap = min(bbox[2], item["bbox"][2]) - max(bbox[0], item["bbox"][0])
                    if x_overlap < min(bbox[2] - bbox[0], item["bbox"][2] - item["bbox"][0]) * 0.3:
                        continue
                    distance = min(abs(bbox[1] - item["bbox"][3]), abs(item["bbox"][1] - bbox[3]))
                    if distance < best_distance:
                        best_distance = distance
                        target = item
                if target is not None:
                    entry = append(
                        page,
                        {
                            **base,
                            "region_type": "caption",
                            "detection_methods": ["caption-keyword"],
                            "confidence": 0.8,
                        },
                    )
                    entry["caption_of_key"] = next(
                        (
                            existing["candidate_key"]
                            for existing in candidates
                            if existing.get("bbox") is target["bbox"]
                        ),
                        None,
                    )
                    continue
            is_short = len(block["lines"]) <= 2 and len(text) <= 120
            is_large = first_line["size"] >= body_size * 1.12
            is_bold_lead = first_line["bold"] and first_line["size"] >= body_size * 1.02
            has_numbering = bool(NUMBERING_RE.match(first_line["text"]))
            if is_short and (is_large or is_bold_lead or (has_numbering and first_line["size"] >= body_size)):
                heading_sizes.add(round(first_line["size"], 1))
                append(
                    page,
                    {
                        **base,
                        "region_type": "heading",
                        "detection_methods": [
                            method
                            for method, hit in (
                                ("font-size", is_large),
                                ("bold", is_bold_lead),
                                ("numbering", has_numbering),
                            )
                            if hit
                        ],
                        "confidence": 0.85 if is_large and has_numbering else 0.65,
                        "font_size": round(first_line["size"], 1),
                    },
                )
                continue
            bullet_lines = sum(1 for line in block["lines"] if BULLET_RE.match(line["text"]))
            if len(block["lines"]) >= 2 and bullet_lines >= max(2, math.ceil(len(block["lines"]) * 0.6)):
                append(
                    page,
                    {**base, "region_type": "list", "detection_methods": ["bullet-marker"], "confidence": 0.7},
                )
                continue
            append(page, {**base, "region_type": "text", "detection_methods": ["text-block"], "confidence": 0.8})

        _assign_reading_order(candidates[page_candidates_start:], page["width"])

    # 見出しサイズの降順で見出しレベルを割り当てる（大きいほど上位）
    ranked = sorted(heading_sizes, reverse=True)
    for candidate in candidates:
        if candidate["region_type"] == "heading" and "font_size" in candidate:
            candidate["level"] = min(ranked.index(round(candidate["font_size"], 1)) + 1, 6)

    # ページをまたいで通し読み順を振り直す
    order = 0
    for candidate in sorted(candidates, key=lambda item: (item["page_index"], item.get("reading_order", 0))):
        order += 1
        candidate["reading_order"] = order
    return candidates


def _assign_reading_order(page_candidates: list[dict], page_width: float) -> None:
    """ページ内読み順を推定する（検討資料 §10。二段組は左列→右列）。"""
    mid = page_width / 2
    content = [item for item in page_candidates if item["region_type"] not in EXCLUDED_TYPES]
    excluded = [item for item in page_candidates if item["region_type"] in EXCLUDED_TYPES]
    left = [item for item in content if item["bbox"][2] <= mid + 20]
    right = [item for item in content if item["bbox"][0] >= mid - 20]
    full = [item for item in content if item not in left and item not in right]
    two_column = len(left) >= 2 and len(right) >= 2
    if not two_column:
        ordered = sorted(content, key=lambda item: (item["bbox"][1], item["bbox"][0]))
    else:
        # 全幅要素でページを縦に区切り、各区間で左列→右列の順とする
        boundaries = sorted(full, key=lambda item: item["bbox"][1])
        ordered = []
        segment_tops = [0.0, *[item["bbox"][1] for item in boundaries], float("inf")]
        for index in range(len(segment_tops) - 1):
            seg_top, seg_bottom = segment_tops[index], segment_tops[index + 1]
            if index > 0:
                ordered.append(boundaries[index - 1])
            for column in (left, right):
                ordered.extend(
                    sorted(
                        [item for item in column if seg_top <= item["bbox"][1] < seg_bottom],
                        key=lambda item: item["bbox"][1],
                    )
                )
    for sequence, item in enumerate([*ordered, *sorted(excluded, key=lambda item: item["bbox"][1])], start=1):
        item["reading_order"] = sequence


def _render_pages(source: Path, pages: list[dict], work_dir: Path, warnings: list[str]) -> None:
    """pypdfium2 で各ページを PNG へレンダリングする（UI オーバーレイと図切出しの基盤）。"""
    pdfium = _load_pdfium()
    pages_dir = work_dir / "pages"
    pages_dir.mkdir(parents=True, exist_ok=True)
    document = pdfium.PdfDocument(str(source))
    try:
        for page in pages:
            scale = RENDER_SCALE
            if page["width"] * scale > MAX_RENDER_WIDTH_PX:
                scale = MAX_RENDER_WIDTH_PX / page["width"]
                warnings.append(f"ページ{page['page_number']}: 画像幅上限により解像度を下げました")
            pdfium_page = document[page["page_index"]]
            bitmap = pdfium_page.render(scale=scale)
            image = bitmap.to_pil()
            file_name = f"pages/page-{page['page_number']:04d}.png"
            image.save(work_dir / file_name)
            page["image_file"] = file_name
            page["image_width"] = image.width
            page["image_height"] = image.height
            page["image_scale"] = round(scale, 4)
            pdfium_page.close()
    finally:
        document.close()


def _page_physical(plumber_page, page_index: int, warnings: list[str]) -> dict:
    """1ページ分の物理情報（検討資料 §4.1）を取得する。"""
    page_number = page_index + 1
    words = plumber_page.extract_words(
        extra_attrs=["fontname", "size", "non_stroking_color"], keep_blank_chars=False
    )
    truncated = False
    if len(words) > MAX_WORDS_PER_PAGE:
        words = words[:MAX_WORDS_PER_PAGE]
        truncated = True
        warnings.append(f"ページ{page_number}: 単語数上限 {MAX_WORDS_PER_PAGE} で打ち切りました")
    blocks = _group_blocks(_group_lines(words), page_number)

    drawings = {"lines": [], "rects": [], "curve_count": len(plumber_page.curves), "truncated": False}
    for line in plumber_page.lines[:MAX_DRAWINGS_PER_PAGE]:
        orientation = "h" if abs(line["top"] - line["bottom"]) <= abs(line["x1"] - line["x0"]) else "v"
        drawings["lines"].append(
            {"bbox": _round_bbox(line["x0"], line["top"], line["x1"], line["bottom"]), "orientation": orientation}
        )
    for rect in plumber_page.rects[:MAX_DRAWINGS_PER_PAGE]:
        drawings["rects"].append({"bbox": _round_bbox(rect["x0"], rect["top"], rect["x1"], rect["bottom"])})
    if len(plumber_page.lines) > MAX_DRAWINGS_PER_PAGE or len(plumber_page.rects) > MAX_DRAWINGS_PER_PAGE:
        drawings["truncated"] = True
        warnings.append(f"ページ{page_number}: 描画要素上限 {MAX_DRAWINGS_PER_PAGE} で打ち切りました")

    images = [
        {
            "image_id": f"p{page_number}-i{index + 1}",
            "bbox": _round_bbox(image["x0"], image["top"], image["x1"], image["bottom"]),
        }
        for index, image in enumerate(plumber_page.images)
    ]
    links = [
        {"bbox": _round_bbox(link["x0"], link["top"], link["x1"], link["bottom"]), "uri": link.get("uri", "")}
        for link in (plumber_page.hyperlinks or [])
    ]
    rotation = int(plumber_page.rotation or 0) % 360
    if rotation != 0:
        warnings.append(f"ページ{page_number}: 回転 {rotation} 度のページです（座標の目視確認を推奨）")
    return {
        "page_index": page_index,
        "page_number": page_number,
        "width": round(float(plumber_page.width), 2),
        "height": round(float(plumber_page.height), 2),
        "rotation": rotation,
        "blocks": blocks,
        "images": images,
        "rules": drawings,
        "links": links,
        "word_count": len(words),
        "truncated": truncated,
    }


def _open_pdf(pdfplumber, source: Path):
    try:
        return pdfplumber.open(source)
    except Exception as e:  # noqa: BLE001 - pdfminer の例外型はバージョン依存のため文言で判定する
        message = str(e)
        if "password" in message.lower() or "decrypt" in message.lower() or "encrypt" in message.lower():
            raise ValueError("パスワード保護・暗号化されたPDFは解析できません") from e
        raise ValueError(f"PDFを開けません: {message}") from e


def extract_pdf(file_path: str, work_dir: str) -> dict:
    source = Path(file_path)
    if source.suffix.lower() != ".pdf":
        raise ValueError(".pdf 形式だけを抽出できます")
    if source.stat().st_size > MAX_FILE_SIZE:
        raise ValueError(f"PDFファイルサイズが上限 {MAX_FILE_SIZE} バイトを超えています")
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    pdfplumber = _load_pdfplumber()
    warnings: list[str] = []

    with _open_pdf(pdfplumber, source) as pdf:
        page_total = len(pdf.pages)
        page_limit = min(page_total, MAX_PAGES)
        if page_total > MAX_PAGES:
            warnings.append(f"ページ数上限 {MAX_PAGES} を超えるため {page_total} ページ中先頭のみ解析しました")
        pages = []
        plumber_pages: dict[int, object] = {}
        for page_index in range(page_limit):
            plumber_page = pdf.pages[page_index]
            plumber_pages[page_index] = plumber_page
            pages.append(_page_physical(plumber_page, page_index, warnings))
        candidates = _build_candidates(pages, plumber_pages, warnings)

    char_count = sum(len(block["text"]) for page in pages for block in page["blocks"])
    if char_count == 0:
        warnings.append("テキストレイヤがありません（スキャンPDFの可能性。文字はLLM支援のOCRで取得できます）")
    _render_pages(source, pages, work, warnings)

    result = {
        "metadata": {
            "extractor_name": EXTRACTOR_NAME,
            "extractor_version": EXTRACTOR_VERSION,
            "file_name": source.name,
            "page_count": len(pages),
            "page_total": page_total,
            "char_count": char_count,
            "has_text_layer": char_count > 0,
        },
        "document": {"file_name": source.name, "pages": pages},
        "candidates": candidates,
        "review_hints": {"warnings": warnings},
    }
    output = work / "extract-pdf.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=1), encoding="utf-8")
    return {
        "output_ref": str(output),
        "page_count": len(pages),
        "candidate_count": len(candidates),
        "warning_count": len(warnings),
    }


def reanalyze_regions(file_path: str, work_dir: str, regions: list[dict], scale: float | None = None) -> dict:
    """領域単位の部分再解析（検討資料 §7.4/§14）。mode: table / text / crop。"""
    source = Path(file_path)
    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    pdfplumber = _load_pdfplumber()
    results: list[dict] = []
    render_scale = scale or RENDER_SCALE

    with _open_pdf(pdfplumber, source) as pdf:
        for index, region in enumerate(regions):
            page_index = int(region.get("page_index", -1))
            mode = str(region.get("mode", ""))
            bbox = region.get("bbox")
            if page_index < 0 or page_index >= len(pdf.pages) or not isinstance(bbox, list) or len(bbox) != 4:
                results.append({"mode": mode, "error": "page_index または bbox が不正です"})
                continue
            page = pdf.pages[page_index]
            clipped = [
                max(0.0, min(float(bbox[0]), page.width)),
                max(0.0, min(float(bbox[1]), page.height)),
                max(0.0, min(float(bbox[2]), page.width)),
                max(0.0, min(float(bbox[3]), page.height)),
            ]
            if clipped[2] <= clipped[0] or clipped[3] <= clipped[1]:
                results.append({"mode": mode, "error": "bbox の幅または高さが 0 です"})
                continue
            cropped = page.within_bbox(tuple(clipped))
            if mode == "table":
                tables = cropped.find_tables()
                if not tables:
                    rows = cropped.extract_table(
                        {"vertical_strategy": "text", "horizontal_strategy": "text"}
                    )
                    method = "text-alignment"
                else:
                    largest = max(tables, key=lambda item: _bbox_area(list(item.bbox)))
                    rows = largest.extract()
                    method = "ruled-lines"
                if not rows:
                    results.append({"mode": mode, "table": None, "warning": "表を検出できませんでした"})
                    continue
                normalized = [[(cell if isinstance(cell, str) else "") for cell in row] for row in rows]
                results.append(
                    {
                        "mode": mode,
                        "table": {
                            "rows": normalized,
                            "row_count": len(normalized),
                            "column_count": max(len(row) for row in normalized),
                            "header_row_count": 1,
                            "detection_method": method,
                        },
                    }
                )
            elif mode == "text":
                results.append({"mode": mode, "text": cropped.extract_text() or ""})
            elif mode == "crop":
                pdfium = _load_pdfium()
                document = pdfium.PdfDocument(str(source))
                try:
                    pdfium_page = document[page_index]
                    bitmap = pdfium_page.render(scale=render_scale)
                    image = bitmap.to_pil()
                    left = max(0, math.floor(clipped[0] * render_scale))
                    top = max(0, math.floor(clipped[1] * render_scale))
                    right = min(image.width, math.ceil(clipped[2] * render_scale))
                    bottom = min(image.height, math.ceil(clipped[3] * render_scale))
                    crop = image.crop((left, top, right, bottom))
                    file_name = f"crop-{page_index + 1:04d}-{index + 1}.png"
                    crop.save(work / file_name)
                    results.append(
                        {"mode": mode, "image_file": file_name, "width": crop.width, "height": crop.height}
                    )
                    pdfium_page.close()
                finally:
                    document.close()
            else:
                results.append({"mode": mode, "error": f"未対応のモードです: {mode}"})
    return {"results": results}


def run(job_id: str, parameters: dict, emit_progress, emit_result, emit_error) -> None:
    file_path = parameters.get("file_path")
    work_dir = parameters.get("work_dir")
    if not file_path or not work_dir:
        emit_error(job_id, "invalid_parameters", "file_path と work_dir は必須です")
        return
    emit_progress(job_id, 10, "PDFの物理情報を抽出中")
    summary = extract_pdf(str(file_path), str(work_dir))
    emit_progress(job_id, 90, f"候補 {summary['candidate_count']} 件を生成")
    emit_result(
        job_id,
        "success",
        output={key: value for key, value in summary.items() if key != "output_ref"},
        output_ref=summary["output_ref"],
    )


def run_region(job_id: str, parameters: dict, emit_progress, emit_result, emit_error) -> None:
    file_path = parameters.get("file_path")
    work_dir = parameters.get("work_dir")
    regions = parameters.get("regions")
    if not file_path or not work_dir or not isinstance(regions, list) or not regions:
        emit_error(job_id, "invalid_parameters", "file_path / work_dir / regions は必須です")
        return
    emit_progress(job_id, 20, f"領域 {len(regions)} 件を再解析中")
    scale = parameters.get("scale")
    result = reanalyze_regions(str(file_path), str(work_dir), regions, float(scale) if scale else None)
    emit_result(job_id, "success", output=result)
