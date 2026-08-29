"""
extraction.py
-------------
PDF extraction, selective Hebrew OCR fallback, extraction-record schema,
cache I/O, and cache validation for the passed-laws corpus.

This is the single, tested implementation shared by both the v1 baseline
notebook and the v2 notebook. The deterministic behavior (Docling extraction
with a PyPdfium backend, an OCR fallback that re-processes only low-text pages
with Tesseract Hebrew, and incremental JSON caching keyed by bill id) is
preserved from the original v1 notebook so cached records stay compatible.

Versioned extraction-record schema
===================================
A *successful* record is a dict with these fields:

- ``schema_version``: int - the record shape version (see EXTRACTION_SCHEMA_VERSION)
- ``bill_id``: the bill identifier
- ``name``: the bill title
- ``status``: ``"success"``
- ``markdown``: the full Docling markdown export (whole-document view)
- ``blocks``: an ordered list of block dicts, each with:
    - ``block_id``: stable, bill-local identifier ``"{bill_id}:b{ordinal}"``
    - ``kind``: ``"heading"`` | ``"text"`` | ``"table"``
    - ``text``: the block text (markdown for tables)
    - ``page_no``: 1-based source page number (or ``None``)
    - ``heading_path``: list[str] heading hierarchy at this block
    - ``source``: ``"docling"`` | ``"ocr"`` - provenance of the block text
- ``page_count``: number of physical PDF pages
- ``hebrew_ratio``: fraction of Hebrew characters across extracted text
- ``ocr_fallback_used``: bool - whether any page went through OCR
- ``extracted_at``: ISO-8601 UTC timestamp

A *failed* record is a dict with:

- ``schema_version``, ``bill_id``, ``name``, ``status="failed"``, ``error``,
  ``extracted_at``.

Older cached records written before this schema existed (no ``schema_version``,
no per-block ``block_id``) are still recognised and are upgraded in memory when
loaded via :func:`load_record`, without rewriting the cache on disk unless a
re-extraction happens.
"""

from __future__ import annotations

import json
import re
import subprocess
import tempfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Optional

# Current on-disk record shape. Kept in sync with lawsofisrael.EXTRACTION_SCHEMA_VERSION.
EXTRACTION_SCHEMA_VERSION = 1

# A page whose stripped (whitespace-removed) text length is <= this is treated
# as "low text" and routed through the OCR fallback.
LOW_TEXT_CHAR_THRESHOLD = 32

BLOCK_KINDS = ("heading", "text", "table")
BLOCK_SOURCES = ("docling", "ocr")


# ---------------------------------------------------------------------------
# Hebrew ratio helper
# ---------------------------------------------------------------------------
_HEBREW_RE = re.compile(r"[\u0590-\u05FF]")
_NON_SPACE_RE = re.compile(r"\S")


def hebrew_ratio(text: str) -> float:
    """Fraction of non-whitespace characters in ``text`` that are Hebrew.

    Returns 0.0 for empty/whitespace-only input.
    """
    non_space = _NON_SPACE_RE.findall(text or "")
    if not non_space:
        return 0.0
    hebrew = _HEBREW_RE.findall(text or "")
    return len(hebrew) / len(non_space)


def _blocks_hebrew_ratio(blocks: list[dict]) -> float:
    joined = " ".join(b.get("text", "") for b in blocks)
    return hebrew_ratio(joined)


# ---------------------------------------------------------------------------
# Block IDs
# ---------------------------------------------------------------------------
def make_block_id(bill_id: Any, ordinal: int) -> str:
    """Stable, bill-local block identifier, e.g. ``"1042100:b0007"``."""
    return f"{bill_id}:b{ordinal:04d}"


def assign_block_ids(bill_id: Any, blocks: list[dict]) -> list[dict]:
    """Return ``blocks`` with a stable ``block_id`` on each (in order).

    Existing ``block_id`` values are overwritten so IDs are always contiguous
    and match block order; this keeps IDs deterministic after OCR reordering.
    """
    out = []
    for i, b in enumerate(blocks):
        nb = dict(b)
        nb["block_id"] = make_block_id(bill_id, i)
        out.append(nb)
    return out


# ---------------------------------------------------------------------------
# Record construction / validation
# ---------------------------------------------------------------------------
def build_success_record(
    *,
    bill_id: Any,
    name: str,
    blocks: list[dict],
    page_count: int,
    markdown: str = "",
    ocr_fallback_used: bool = False,
    extracted_at: Optional[str] = None,
) -> dict:
    """Assemble a versioned successful extraction record.

    Block IDs are (re)assigned and ``hebrew_ratio`` is computed from the
    blocks' text so the derived fields always match the stored blocks.
    """
    blocks = assign_block_ids(bill_id, blocks)
    return {
        "schema_version": EXTRACTION_SCHEMA_VERSION,
        "bill_id": bill_id,
        "name": name,
        "status": "success",
        "markdown": markdown,
        "blocks": blocks,
        "page_count": page_count,
        "hebrew_ratio": _blocks_hebrew_ratio(blocks),
        "ocr_fallback_used": bool(ocr_fallback_used),
        "extracted_at": extracted_at or datetime.now(timezone.utc).isoformat(),
    }


def build_failed_record(*, bill_id: Any, name: str, error: str,
                        extracted_at: Optional[str] = None) -> dict:
    """Assemble a versioned failed extraction record."""
    return {
        "schema_version": EXTRACTION_SCHEMA_VERSION,
        "bill_id": bill_id,
        "name": name,
        "status": "failed",
        "error": error,
        "extracted_at": extracted_at or datetime.now(timezone.utc).isoformat(),
    }


class InvalidRecordError(ValueError):
    """Raised when an extraction record fails structural validation."""


def validate_record(record: Any) -> dict:
    """Validate an extraction record, returning it unchanged if valid.

    Raises :class:`InvalidRecordError` with a specific message otherwise.
    Accepts both current-schema and legacy records (legacy records lack
    ``schema_version`` and per-block ``block_id``); use :func:`is_current_schema`
    to distinguish. Successful records must carry well-formed blocks.
    """
    if not isinstance(record, dict):
        raise InvalidRecordError("record must be a dict")

    for key in ("bill_id", "name", "status"):
        if key not in record:
            raise InvalidRecordError(f"record missing required field: {key!r}")

    status = record["status"]
    if status not in ("success", "failed"):
        raise InvalidRecordError(f"unknown status: {status!r}")

    if status == "failed":
        if not record.get("error"):
            raise InvalidRecordError("failed record missing 'error'")
        return record

    # success
    if "blocks" not in record or not isinstance(record["blocks"], list):
        raise InvalidRecordError("success record must have a 'blocks' list")
    if "page_count" not in record:
        raise InvalidRecordError("success record missing 'page_count'")

    for i, b in enumerate(record["blocks"]):
        if not isinstance(b, dict):
            raise InvalidRecordError(f"block {i} is not a dict")
        for key in ("kind", "text", "heading_path"):
            if key not in b:
                raise InvalidRecordError(f"block {i} missing field: {key!r}")
        if b["kind"] not in BLOCK_KINDS:
            raise InvalidRecordError(f"block {i} has invalid kind: {b['kind']!r}")
        if not isinstance(b["heading_path"], list):
            raise InvalidRecordError(f"block {i} heading_path must be a list")
        if "page_no" not in b:
            raise InvalidRecordError(f"block {i} missing field: 'page_no'")
    return record


def is_valid_record(record: Any) -> bool:
    """Non-raising variant of :func:`validate_record`."""
    try:
        validate_record(record)
        return True
    except InvalidRecordError:
        return False


def is_current_schema(record: dict) -> bool:
    """True if ``record`` already matches the current on-disk schema version."""
    return record.get("schema_version") == EXTRACTION_SCHEMA_VERSION


def upgrade_record(record: dict) -> dict:
    """Upgrade a legacy record to the current schema shape in memory.

    - Adds ``schema_version``.
    - Ensures each block has a stable ``block_id`` and a ``source`` (defaults to
      ``"docling"`` for legacy blocks that predate the field).
    - Fills ``hebrew_ratio`` / ``ocr_fallback_used`` / ``markdown`` if absent.

    The input is not mutated. Returns the upgraded copy. Failed records are
    returned with just ``schema_version`` added.
    """
    validate_record(record)
    rec = dict(record)
    rec["schema_version"] = EXTRACTION_SCHEMA_VERSION

    if rec["status"] == "failed":
        return rec

    blocks = [dict(b) for b in rec["blocks"]]
    for b in blocks:
        b.setdefault("source", "docling")
        b.setdefault("page_no", None)
    blocks = assign_block_ids(rec["bill_id"], blocks)
    rec["blocks"] = blocks

    rec.setdefault("markdown", "")
    if "hebrew_ratio" not in rec:
        rec["hebrew_ratio"] = _blocks_hebrew_ratio(blocks)
    rec.setdefault("ocr_fallback_used", False)
    return rec


# ---------------------------------------------------------------------------
# Cache I/O
# ---------------------------------------------------------------------------
def cache_path_for(cache_dir: Path | str, bill_id: Any) -> Path:
    """Path of the cache file for ``bill_id`` under ``cache_dir``."""
    return Path(cache_dir) / f"{bill_id}.json"


def write_record(cache_dir: Path | str, record: dict) -> Path:
    """Serialize ``record`` to ``{cache_dir}/{bill_id}.json`` (UTF-8, non-ASCII kept).

    The record is validated before writing. Returns the written path.
    """
    validate_record(record)
    path = cache_path_for(cache_dir, record["bill_id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, ensure_ascii=False), encoding="utf-8")
    return path


def load_record(
    cache_dir: Path | str,
    bill_id: Any,
    *,
    upgrade: bool = True,
    validate: bool = True,
) -> Optional[dict]:
    """Load a cached record for ``bill_id``, or ``None`` if not cached.

    By default the record is validated and legacy records are upgraded in
    memory (no disk rewrite). Set ``validate=False`` to skip validation, or
    ``upgrade=False`` to return the raw on-disk dict.
    """
    path = cache_path_for(cache_dir, bill_id)
    if not path.exists():
        return None
    record = json.loads(path.read_text(encoding="utf-8"))
    if validate:
        validate_record(record)
    if upgrade and not is_current_schema(record):
        record = upgrade_record(record)
    return record


def is_cache_reusable(cache_dir: Path | str, bill_id: Any) -> bool:
    """True if a cached record exists and is structurally valid (reusable).

    A corrupt/incompatible cache entry returns False so callers can choose to
    re-extract rather than silently reuse a broken record.
    """
    path = cache_path_for(cache_dir, bill_id)
    if not path.exists():
        return False
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
        return is_valid_record(record)
    except (json.JSONDecodeError, OSError):
        return False


# ---------------------------------------------------------------------------
# Docling extraction + OCR fallback
# ---------------------------------------------------------------------------
def _run_tesseract_hebrew(image_path: Path, timeout: int = 120) -> str:
    """Run Tesseract Hebrew OCR on ``image_path`` and return stdout text."""
    result = subprocess.run(
        ["tesseract", str(image_path), "stdout", "-l", "heb", "--psm", "6"],
        capture_output=True, text=True, timeout=timeout, check=True,
    )
    return result.stdout


def extract_pdf_bytes(pdf_bytes: bytes, *, bill_id: Any, name: str,
                     document_timeout: int = 120) -> dict:
    """Extract a single bill PDF into a versioned success/failure record.

    Behavior mirrors the v1 notebook:
      1. Detect low-text pages with pypdfium2.
      2. Run Docling (OCR disabled, heading hierarchy enabled, PyPdfium backend)
         to produce ordered blocks (heading/text/table) with page numbers and
         heading paths, plus a whole-document markdown export.
      3. For low-text pages, render at scale 3, OCR with Tesseract Hebrew, and
         replace that page's blocks with a single OCR text block. Blocks are
         re-sorted by page afterwards.

    Any exception is captured into a failed record.
    """
    try:
        from docling.backend.pypdfium2_backend import PyPdfiumDocumentBackend
        from docling.datamodel.base_models import DocumentStream, InputFormat
        from docling.datamodel.pipeline_options import PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption
        import pypdfium2 as pdfium

        # 1. Low-text page detection
        pdf = pdfium.PdfDocument(pdf_bytes)
        page_texts = [pdf[i].get_textpage().get_text_range() or "" for i in range(len(pdf))]
        pdf.close()
        low_text_pages = [
            i + 1 for i, t in enumerate(page_texts)
            if len(re.sub(r"\s+", "", t)) <= LOW_TEXT_CHAR_THRESHOLD
        ]

        # 2. Docling extraction
        options = PdfPipelineOptions(do_ocr=False, document_timeout=document_timeout)
        options.heading_hierarchy_options.enabled = True
        converter = DocumentConverter(format_options={
            InputFormat.PDF: PdfFormatOption(
                pipeline_options=options, backend=PyPdfiumDocumentBackend
            )
        })
        doc = converter.convert(
            DocumentStream(name=f"{bill_id}.pdf", stream=BytesIO(pdf_bytes))
        ).document
        markdown = doc.export_to_markdown()

        blocks, headings = [], []
        for item, depth in doc.iterate_items():
            label = str(getattr(item, "label", "")).lower()
            text = (
                item.export_to_markdown(doc=doc).strip()
                if "table" in label
                else str(getattr(item, "text", "")).strip()
            )
            if not text:
                continue

            prov = list(getattr(item, "prov", []) or [])
            page_no = getattr(prov[0], "page_no", None) if prov else None
            is_heading = "title" in label or "section_header" in label

            if is_heading:
                headings = headings[: max(0, depth - 1)] + [text]

            blocks.append({
                "kind": "heading" if is_heading else ("table" if "table" in label else "text"),
                "text": text,
                "page_no": page_no,
                "heading_path": headings.copy(),
                "source": "docling",
            })

        # 3. OCR fallback for low-text pages
        ocr_used = False
        if low_text_pages:
            pdf = pdfium.PdfDocument(pdf_bytes)
            for p in low_text_pages:
                try:
                    image = pdf[p - 1].render(scale=3).to_pil()
                    with tempfile.TemporaryDirectory() as tmp:
                        img_path = Path(tmp) / "page.png"
                        image.save(img_path)
                        ocr_text = _run_tesseract_hebrew(img_path)
                        if ocr_text.strip():
                            blocks = [b for b in blocks if b["page_no"] != p]
                            blocks.append({
                                "kind": "text",
                                "text": ocr_text.strip(),
                                "page_no": p,
                                "heading_path": [],
                                "source": "ocr",
                            })
                            ocr_used = True
                except Exception:
                    pass
            pdf.close()
            blocks.sort(key=lambda b: (b["page_no"] is None, b["page_no"] or 0))

        return build_success_record(
            bill_id=bill_id,
            name=name,
            blocks=blocks,
            page_count=len(page_texts),
            markdown=markdown,
            ocr_fallback_used=ocr_used,
        )
    except Exception as e:  # noqa: BLE001 - capture any extraction failure
        return build_failed_record(bill_id=bill_id, name=name, error=str(e))


def extract_bill(row: dict, cache_dir: Path | str) -> dict:
    """Extract a single bill row, using and updating the on-disk cache.

    ``row`` must provide ``bill_id``, ``name`` and ``law_pdf_bytes``. A valid
    cached record is returned as-is (upgraded in memory); an invalid/absent one
    triggers a fresh extraction that is then cached. This is resumable and
    matches the v1 notebook's incremental caching.
    """
    bill_id = row["bill_id"]
    name = row["name"]

    if is_cache_reusable(cache_dir, bill_id):
        return load_record(cache_dir, bill_id)

    record = extract_pdf_bytes(
        bytes(row["law_pdf_bytes"]), bill_id=bill_id, name=name
    )
    write_record(cache_dir, record)
    return record
