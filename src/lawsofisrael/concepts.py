"""Mechanical helpers for the full-bill LLooM concept pipeline.

This module holds only the long, pure, uninteresting-to-read plumbing that would
be noise inside the driver notebook:

- parquet checkpoint + content-hash helpers;
- ``select_documents``   : deterministic one-authoritative-document-per-bill selection;
- ``download_documents`` : local content-addressed PDF/DOCX/DOC cache (explicit network);
- ``extract_documents`` / ``build_chunks`` : thin wrappers over ``extraction`` /
  ``chunking`` that emit parquet-ready document/block/chunk tables;
- ``build_analysis``     : bill-level cluster/concept marts (pure pandas);
- ``quality_report``     : integrity checks.

The *interesting* pipeline flow -- the actual LLooM ``distill_filter`` /
``distill_summarize`` / ``synthesize`` / ``review`` calls, the Gemini embedding
loop, and the UMAP/HDBSCAN clustering -- lives in ``notebooks/concept_pipeline.ipynb``
as visible cells, exactly like ``lloom_experiment_v2.ipynb``. Nothing here hides
an API call.

Design rules: no KNN stage, no LLooM scoring. Cluster membership is the result;
concept labels are semantic descriptions of clusters.
"""

from __future__ import annotations

import hashlib
import io
import json
import random
import re
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import pandas as pd

from . import chunking, extraction


# ---------------------------------------------------------------------------
# Checkpoint + hashing plumbing
# ---------------------------------------------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json(value: Any) -> str:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str
    )


def content_hash(value: Any) -> str:
    """Stable sha256 of any JSON-able value; used for cost-safe cache keys."""
    return hashlib.sha256(canonical_json(value).encode("utf-8")).hexdigest()


def write_parquet(frame: pd.DataFrame, path: Path | str) -> Path:
    """Atomically write ``frame`` to ``path`` via a ``.part`` staging file."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    staged = path.with_name(f"{path.name}.part")
    frame.to_parquet(staged, index=False)
    staged.replace(path)
    return path


def read_parquet(path: Path | str) -> pd.DataFrame | None:
    """Read a checkpoint parquet, or ``None`` if it does not exist yet."""
    path = Path(path)
    return pd.read_parquet(path) if path.exists() else None


# ---------------------------------------------------------------------------
# Document selection (one PDF per bill, failures retained)
# ---------------------------------------------------------------------------
SELECTION_COLUMNS = [
    "bill_id",
    "bill_document_id",
    "source_field",
    "document_label",
    "document_url",
    "document_format",
    "document_date",
    "selected_stage",
    "selection_state",
    "selection_rule",
    "selection_reason",
    "candidate_count",
    "selection_rank",
]
SUPPORTED_DOCUMENT_FORMATS = ("pdf", "docx", "doc", "rtf")
DOCUMENT_SOURCE_FIELDS = ("LegalDocuments", "DraftLaws")


def _document_format(url: str, declared_format: Any) -> str:
    declared = str(declared_format or "").lower().strip()
    if declared in SUPPORTED_DOCUMENT_FORMATS:
        return declared
    suffix = str(url or "").lower().split("?", 1)[0].rsplit(".", 1)[-1]
    return suffix if suffix in SUPPORTED_DOCUMENT_FORMATS else ""


def _stage_rank(source_field: str, label: str) -> tuple[int, str] | None:
    """Return an authority/stage rank for an allowlisted document, or None."""
    label = str(label or "").strip()
    if source_field == "LegalDocuments" and label == "חוק - פרסום ברשומות":
        return 0, "official_law"
    if source_field == "LegalDocuments" and label == "חוק - נוסח לא רשמי":
        return 1, "unofficial_law"
    if source_field == "DraftLaws" and "לוח תיקונים" in label:
        return None
    if source_field == "DraftLaws" and "קריאה השנייה והשלישית" in label:
        return 2, "second_third_reading"
    if source_field == "DraftLaws" and "קריאה הראשונה" in label:
        return 3, "first_reading"
    if source_field == "DraftLaws" and "דיון מוקדם" in label:
        return 4, "preliminary_reading"
    return None


def select_documents(bills: pd.DataFrame, documents: pd.DataFrame) -> pd.DataFrame:
    """Choose one legal text per bill from LegalDocuments or DraftLaws.

    The explicit source allowlist excludes all background and procedural
    collections. Legal authority/stage outranks file format, so a later DOCX
    draft beats an earlier PDF draft; PDF/DOCX/DOC only break ties.
    """
    docs = documents.copy()
    for column in (
        "source_field",
        "document_label",
        "document_url",
        "document_format",
        "document_date",
    ):
        if column not in docs:
            docs[column] = None
    docs["source_field"] = docs["source_field"].fillna("").astype(str)
    docs["document_label"] = docs["document_label"].fillna("").astype(str).str.strip()
    docs["document_url"] = docs["document_url"].fillna("").astype(str).str.strip()
    docs["normalized_format"] = [
        _document_format(url, declared)
        for url, declared in zip(docs["document_url"], docs["document_format"])
    ]
    docs["stage"] = [
        _stage_rank(source, label)
        for source, label in zip(docs["source_field"], docs["document_label"])
    ]
    docs["stage_rank"] = docs["stage"].map(lambda value: value[0] if value else None)
    docs["selected_stage"] = docs["stage"].map(
        lambda value: value[1] if value else None
    )
    docs["format_rank"] = docs["normalized_format"].map(
        {"pdf": 0, "docx": 1, "doc": 2, "rtf": 3}
    )
    docs["document_date_sort"] = pd.to_datetime(
        docs["document_date"], errors="coerce", utc=True
    )

    rows: list[dict[str, Any]] = []
    for bill_id in bills["bill_id"]:
        candidates = docs[
            (docs["bill_id"] == bill_id)
            & docs["source_field"].isin(DOCUMENT_SOURCE_FIELDS)
            & docs["document_url"].ne("")
            & docs["normalized_format"].isin(SUPPORTED_DOCUMENT_FORMATS)
            & docs["stage_rank"].notna()
        ].copy()
        count = len(candidates)
        if count == 0:
            rows.append(
                {
                    "bill_id": bill_id,
                    "bill_document_id": None,
                    "source_field": None,
                    "document_label": None,
                    "document_url": None,
                    "document_format": None,
                    "document_date": None,
                    "selected_stage": None,
                    "selection_state": "no_supported_document",
                    "selection_rule": None,
                    "selection_reason": "no eligible LegalDocuments or DraftLaws PDF/DOCX/DOC with a usable URL",
                    "candidate_count": 0,
                    "selection_rank": None,
                }
            )
            continue
        candidates = candidates.sort_values(
            [
                "stage_rank",
                "format_rank",
                "document_date_sort",
                "document_ordinal",
                "bill_document_id",
            ],
            ascending=[True, True, False, True, True],
            kind="stable",
        )
        selected = candidates.iloc[0]
        rows.append(
            {
                "bill_id": bill_id,
                "bill_document_id": selected["bill_document_id"],
                "source_field": selected["source_field"],
                "document_label": selected["document_label"],
                "document_url": selected["document_url"],
                "document_format": selected["normalized_format"],
                "document_date": selected["document_date"],
                "selected_stage": selected["selected_stage"],
                "selection_state": "selected",
                "selection_rule": "legal_stage_then_format",
                "selection_reason": (
                    f"selected {selected['selected_stage']} ({selected['normalized_format']}) "
                    f"from {count} eligible candidates"
                ),
                "candidate_count": count,
                "selection_rank": int(selected["stage_rank"]),
            }
        )
    return pd.DataFrame(rows, columns=SELECTION_COLUMNS)


# ---------------------------------------------------------------------------
# Local content-addressed document cache (explicit network action)
# ---------------------------------------------------------------------------
DOCUMENT_MANIFEST_COLUMNS = [
    "bill_id",
    "bill_document_id",
    "document_url",
    "document_format",
    "download_state",
    "http_status",
    "content_sha256",
    "byte_count",
    "local_storage_key",
    "retrieved_at",
    "error",
]


def _document_target(store: Path, digest: str, document_format: str) -> Path:
    return store / digest[:2] / f"{digest}.{document_format}"


def _canonical_document_url(url: str) -> str:
    """Normalize Knesset ``FilePath`` URLs without corrupting ``https://``."""
    parts = urlsplit(str(url).strip().replace("\\", "/"))
    return urlunsplit(
        (
            parts.scheme,
            parts.netloc,
            re.sub(r"/{2,}", "/", parts.path),
            parts.query,
            parts.fragment,
        )
    )


def _is_docx_payload(payload: bytes) -> bool:
    try:
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            return "word/document.xml" in archive.namelist()
    except zipfile.BadZipFile:
        return False


def _detected_document_format(payload: bytes, expected_format: str) -> str:
    """Validate payload magic and return its actual supported document format.

    Knesset's legacy ``.doc`` URLs sometimes serve a DOCX package with an
    ``application/msword`` content type, so DOCX detection deliberately precedes
    legacy-DOC validation for those URLs.
    """
    expected_format = str(expected_format or "").lower()
    if expected_format == "pdf":
        if payload.startswith(b"%PDF"):
            return "pdf"
        raise ValueError("response does not start with a PDF header")
    if expected_format == "docx":
        if _is_docx_payload(payload):
            return "docx"
        raise ValueError("response is not a valid DOCX archive")
    if expected_format in {"doc", "rtf"}:
        if _is_docx_payload(payload):
            return "docx"
        if payload.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
            return "doc"
        if payload.lstrip().startswith(b"{\\rtf"):
            return "rtf"
        raise ValueError("response is neither a DOCX, legacy DOC, nor RTF document")
    raise ValueError(f"unsupported document format: {expected_format!r}")


def _reusable_manifest_row(prior_row: dict[str, Any], document_url: str) -> bool:
    path = Path(str(prior_row.get("local_storage_key") or ""))
    if (
        prior_row.get("download_state") != "available"
        or _canonical_document_url(str(prior_row.get("document_url") or ""))
        != document_url
        or not path.is_file()
    ):
        return False
    return hashlib.sha256(path.read_bytes()).hexdigest() == prior_row.get(
        "content_sha256"
    )


def _retryable_download_error(error: Exception) -> bool:
    import requests

    status = getattr(getattr(error, "response", None), "status_code", None)
    if status in {408, 425, 429, 500, 502, 503, 504}:
        return True
    return isinstance(
        error,
        (
            requests.ConnectionError,
            requests.Timeout,
            requests.exceptions.ChunkedEncodingError,
        ),
    )


def download_documents(
    selections: pd.DataFrame,
    store_dir: Path | str,
    *,
    connect_timeout_seconds: int = 10,
    read_timeout_seconds: int = 20,
    max_attempts: int = 8,
    retry_backoff_seconds: float = 1.0,
    delay_seconds: float = 0.05,
    max_bytes: int = 100 * 1024 * 1024,
    prior: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Download selected files with progress and resumable whole-transfer retries.

    Failed prior rows are retried on the next invocation. Retries cover both the
    initial request and streamed-body reads, which ``HTTPAdapter`` alone cannot
    reliably retry. Knesset URLs are canonicalized before fetching so a raw
    backslash path never becomes a double-slash URL.
    """
    import requests
    from tqdm.auto import tqdm

    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")
    store = Path(store_dir)
    prior_by_doc = (
        {row.bill_document_id: row._asdict() for row in prior.itertuples(index=False)}
        if prior is not None and not prior.empty
        else {}
    )
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "lawsofisrael-concepts/0.4",
            "Accept": "application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/msword,application/rtf,text/rtf,*/*",
        }
    )

    rows: list[dict[str, Any]] = []
    available = reused = failed = retried = 0
    progress = tqdm(
        selections.itertuples(index=False),
        total=len(selections),
        desc="Downloading documents",
        unit="document",
    )
    for selected in progress:
        document_url = (
            _canonical_document_url(selected.document_url)
            if selected.document_url
            else None
        )
        base = {
            "bill_id": selected.bill_id,
            "bill_document_id": selected.bill_document_id,
            "document_url": document_url,
            "document_format": selected.document_format,
        }
        if selected.selection_state != "selected":
            rows.append(
                {
                    **base,
                    "download_state": "not_selected",
                    "http_status": None,
                    "content_sha256": None,
                    "byte_count": None,
                    "local_storage_key": None,
                    "retrieved_at": None,
                    "error": selected.selection_reason,
                }
            )
            continue
        prior_row = prior_by_doc.get(selected.bill_document_id)
        if prior_row and _reusable_manifest_row(prior_row, document_url):
            rows.append(prior_row)
            reused += 1
            progress.set_postfix(
                available=available, reused=reused, retried=retried, failed=failed
            )
            continue

        last_error: Exception | None = None
        last_status = None
        for attempt in range(1, max_attempts + 1):
            try:
                with session.get(
                    document_url,
                    timeout=(connect_timeout_seconds, read_timeout_seconds),
                    stream=True,
                ) as response:
                    last_status = response.status_code
                    response.raise_for_status()
                    payload = bytearray()
                    for part in response.iter_content(chunk_size=1024 * 1024):
                        payload.extend(part)
                        if len(payload) > max_bytes:
                            raise ValueError(
                                f"document exceeds {max_bytes:,}-byte limit"
                            )
                payload_bytes = bytes(payload)
                detected_format = _detected_document_format(
                    payload_bytes, selected.document_format
                )
                digest = hashlib.sha256(payload_bytes).hexdigest()
                path = _document_target(store, digest, detected_format)
                path.parent.mkdir(parents=True, exist_ok=True)
                if not path.exists():
                    staged = path.with_suffix(f".{detected_format}.part")
                    staged.write_bytes(payload_bytes)
                    staged.replace(path)
                rows.append(
                    {
                        **base,
                        "document_format": detected_format,
                        "download_state": "available",
                        "http_status": last_status,
                        "content_sha256": digest,
                        "byte_count": len(payload_bytes),
                        "local_storage_key": str(path),
                        "retrieved_at": now_iso(),
                        "error": None,
                    }
                )
                available += 1
                last_error = None
                break
            except (
                Exception
            ) as error:  # noqa: BLE001 - retain row-level failure and retry only transient errors
                last_error = error
                last_status = getattr(
                    getattr(error, "response", None), "status_code", last_status
                )
                if attempt == max_attempts or not _retryable_download_error(error):
                    break
                retried += 1
                time.sleep(
                    retry_backoff_seconds * (2 ** (attempt - 1))
                    + random.uniform(0, retry_backoff_seconds)
                )
        if last_error is not None:
            failed += 1
            rows.append(
                {
                    **base,
                    "download_state": "failed",
                    "http_status": last_status,
                    "content_sha256": None,
                    "byte_count": None,
                    "local_storage_key": None,
                    "retrieved_at": now_iso(),
                    "error": f"after {attempt}/{max_attempts} attempts: {last_error}",
                }
            )
        progress.set_postfix(
            available=available, reused=reused, retried=retried, failed=failed
        )
        time.sleep(delay_seconds)
    progress.close()
    return pd.DataFrame(rows, columns=DOCUMENT_MANIFEST_COLUMNS)


# ---------------------------------------------------------------------------
# Extraction + chunking (thin wrappers over extraction/ chunking modules)
# ---------------------------------------------------------------------------
EXTRACTION_DOC_COLUMNS = [
    "extraction_id",
    "bill_id",
    "bill_document_id",
    "content_sha256",
    "document_format",
    "extraction_state",
    "page_count",
    "hebrew_ratio",
    "ocr_fallback_used",
    "extracted_at",
    "error",
]
EXTRACTION_BLOCK_COLUMNS = [
    "extraction_id",
    "bill_id",
    "bill_document_id",
    "content_sha256",
    "document_format",
    "block_id",
    "block_ordinal",
    "kind",
    "text",
    "page_no",
    "heading_path",
    "source",
]
CHUNK_COLUMNS = [
    "chunk_id",
    "chunk_key",
    "chunk_ordinal",
    "bill_id",
    "bill_document_id",
    "extraction_id",
    "content_sha256",
    "document_format",
    "bill_title",
    "heading_path",
    "page_no",
    "text",
    "tokens",
    "source_spans",
]


def extract_documents(
    document_manifest: pd.DataFrame,
    bills: pd.DataFrame,
    *,
    document_timeout_seconds: int = 120,
    max_workers: int = 2,
    prior_documents: pd.DataFrame | None = None,
    prior_blocks: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Extract documents concurrently with progress and deterministic row order.

    Each worker owns its Docling conversion call. Completed work is assembled by
    original manifest order, not completion order, so checkpoint output stays
    stable across runs regardless of worker scheduling.
    """
    from tqdm.auto import tqdm

    if max_workers < 1:
        raise ValueError("max_workers must be at least 1")
    names = dict(zip(bills["bill_id"], bills.get("name", pd.Series([""] * len(bills)))))
    prior_docs = (
        {
            row.extraction_id: row._asdict()
            for row in prior_documents.itertuples(index=False)
        }
        if prior_documents is not None and not prior_documents.empty
        else {}
    )
    prior_block_groups = (
        {
            key: group.to_dict("records")
            for key, group in prior_blocks.groupby("extraction_id", sort=False)
        }
        if prior_blocks is not None and not prior_blocks.empty
        else {}
    )

    def rows_for(
        base: dict[str, Any], record: dict[str, Any]
    ) -> tuple[dict[str, Any], list[dict[str, Any]]]:
        document_row = {
            **base,
            "extraction_state": record["status"],
            "page_count": record.get("page_count"),
            "hebrew_ratio": record.get("hebrew_ratio"),
            "ocr_fallback_used": record.get("ocr_fallback_used"),
            "extracted_at": record.get("extracted_at"),
            "error": record.get("error"),
        }
        blocks = [
            {
                **base,
                "block_id": block.get("block_id"),
                "block_ordinal": ordinal,
                "kind": block.get("kind"),
                "text": block.get("text"),
                "page_no": block.get("page_no"),
                "heading_path": block.get("heading_path") or [],
                "source": block.get("source", "docling"),
            }
            for ordinal, block in enumerate(record.get("blocks", []))
        ]
        return document_row, blocks

    results: dict[int, tuple[dict[str, Any], list[dict[str, Any]]]] = {}
    pending: dict[Any, int] = {}
    reused = unavailable = extracted = failed = 0
    documents = list(document_manifest.itertuples(index=False))
    progress = tqdm(total=len(documents), desc="Extracting documents", unit="document")
    with ThreadPoolExecutor(
        max_workers=max_workers, thread_name_prefix="document-extract"
    ) as executor:
        for index, document in enumerate(documents):
            identity = {
                "bill_id": document.bill_id,
                "document_id": document.bill_document_id,
                "content_sha256": document.content_sha256,
                "document_format": document.document_format,
                "schema": extraction.EXTRACTION_SCHEMA_VERSION,
                "timeout": document_timeout_seconds,
            }
            extraction_id = f"extract_{content_hash(identity)[:24]}"
            base = {
                "extraction_id": extraction_id,
                "bill_id": document.bill_id,
                "bill_document_id": document.bill_document_id,
                "content_sha256": document.content_sha256,
                "document_format": document.document_format,
            }
            if document.download_state != "available" or not document.content_sha256:
                results[index] = (
                    {
                        **base,
                        "extraction_state": "not_available",
                        "page_count": None,
                        "hebrew_ratio": None,
                        "ocr_fallback_used": None,
                        "extracted_at": None,
                        "error": document.error or document.download_state,
                    },
                    [],
                )
                unavailable += 1
                progress.update(1)
                continue
            reuse = prior_docs.get(extraction_id)
            if reuse and reuse.get("extraction_state") == "success":
                results[index] = (reuse, prior_block_groups.get(extraction_id, []))
                reused += 1
                progress.update(1)
                continue
            future = executor.submit(
                extraction.extract_document_bytes,
                Path(document.local_storage_key).read_bytes(),
                document_format=document.document_format,
                bill_id=document.bill_id,
                name=str(names.get(document.bill_id) or ""),
                document_timeout=document_timeout_seconds,
            )
            future.base = base
            pending[future] = index

        for future in as_completed(pending):
            index = pending[future]
            base = future.base
            try:
                record = future.result()
            except (
                Exception
            ) as error:  # noqa: BLE001 - retain unexpected worker failure per document
                record = extraction.build_failed_record(
                    bill_id=base["bill_id"],
                    name=str(names.get(base["bill_id"]) or ""),
                    error=str(error),
                )
            results[index] = rows_for(base, record)
            if record["status"] == "success":
                extracted += 1
            else:
                failed += 1
            progress.update(1)
            progress.set_postfix(
                extracted=extracted,
                reused=reused,
                unavailable=unavailable,
                failed=failed,
            )
    progress.close()

    doc_rows: list[dict[str, Any]] = []
    block_rows: list[dict[str, Any]] = []
    for index in range(len(documents)):
        document_row, blocks = results[index]
        doc_rows.append(document_row)
        block_rows.extend(blocks)
    return (
        pd.DataFrame(doc_rows, columns=EXTRACTION_DOC_COLUMNS),
        pd.DataFrame(block_rows, columns=EXTRACTION_BLOCK_COLUMNS),
    )


def build_chunks(
    extraction_documents: pd.DataFrame,
    extraction_blocks: pd.DataFrame,
    bills: pd.DataFrame,
    *,
    chunk_tokens: int = 3000,
    max_workers: int = 4,
) -> pd.DataFrame:
    """Build chunks concurrently with progress and deterministic document ordering."""
    from tqdm.auto import tqdm

    if chunk_tokens <= 0:
        raise ValueError("chunk_tokens must be positive")
    if max_workers < 1:
        raise ValueError("max_workers must be at least 1")
    names = dict(zip(bills["bill_id"], bills.get("name", pd.Series([""] * len(bills)))))
    groups = {
        key: group.sort_values("block_ordinal").to_dict("records")
        for key, group in extraction_blocks.groupby("extraction_id", sort=False)
    }
    successful = [
        doc
        for doc in extraction_documents.itertuples(index=False)
        if doc.extraction_state == "success"
    ]

    def heading_path_for(value: Any) -> list[str]:
        """Convert Arrow/NumPy list values restored from Parquet to a plain list."""
        if isinstance(value, list):
            return value
        if isinstance(value, tuple):
            return list(value)
        if hasattr(value, "tolist"):
            converted = value.tolist()
            return converted if isinstance(converted, list) else []
        return []

    def chunks_for(doc: Any) -> list[dict[str, Any]]:
        blocks = [
            {
                "block_id": block["block_id"],
                "kind": block["kind"],
                "text": block["text"],
                "page_no": block["page_no"],
                "heading_path": heading_path_for(block["heading_path"]),
                "source": block["source"],
            }
            for block in groups.get(doc.extraction_id, [])
        ]
        record = {
            "bill_id": doc.bill_id,
            "name": str(names.get(doc.bill_id) or ""),
            "status": "success",
            "blocks": blocks,
        }
        rows: list[dict[str, Any]] = []
        for ordinal, built in enumerate(chunking.chunk_bill(record, chunk_tokens)):
            spans = []
            for span_ordinal, span in enumerate(built.source_spans):
                value = span.to_dict()
                value.update(
                    {
                        "span_ordinal": span_ordinal,
                        "bill_document_id": doc.bill_document_id,
                        "extraction_id": doc.extraction_id,
                        "content_sha256": doc.content_sha256,
                        "document_format": doc.document_format,
                    }
                )
                spans.append(value)
            rows.append(
                {
                    "chunk_id": f"{doc.bill_id}:{str(doc.bill_document_id)[-8:]}:{ordinal:04d}",
                    "chunk_key": content_hash(
                        {
                            "extraction_id": doc.extraction_id,
                            "chunk_tokens": chunk_tokens,
                            "ordinal": ordinal,
                            "text": built.text,
                        }
                    ),
                    "chunk_ordinal": ordinal,
                    "bill_id": doc.bill_id,
                    "bill_document_id": doc.bill_document_id,
                    "extraction_id": doc.extraction_id,
                    "content_sha256": doc.content_sha256,
                    "document_format": doc.document_format,
                    "bill_title": str(names.get(doc.bill_id) or ""),
                    "heading_path": built.heading_path,
                    "page_no": built.page_no,
                    "text": built.text,
                    "tokens": built.tokens,
                    "source_spans": spans,
                }
            )
        return rows

    results: dict[int, list[dict[str, Any]]] = {}
    progress = tqdm(total=len(successful), desc="Building chunks", unit="document")
    with ThreadPoolExecutor(
        max_workers=max_workers, thread_name_prefix="chunk-build"
    ) as executor:
        pending = {
            executor.submit(chunks_for, doc): index
            for index, doc in enumerate(successful)
        }
        for future in as_completed(pending):
            results[pending[future]] = future.result()
            progress.update(1)
            progress.set_postfix(chunks=sum(len(rows) for rows in results.values()))
    progress.close()
    return pd.DataFrame(
        [row for index in range(len(successful)) for row in results[index]],
        columns=CHUNK_COLUMNS,
    )


# ---------------------------------------------------------------------------
# Query-ready bill-level marts
# ---------------------------------------------------------------------------
BRIDGE_CLUSTER_COLUMNS = [
    "bill_id",
    "cluster_run_id",
    "cluster_id",
    "is_noise",
    "n_bullets",
    "n_chunks",
    "bill_bullet_share",
    "cluster_bullet_share",
    "mean_cluster_membership_probability",
    "max_cluster_membership_probability",
    "bullet_ids",
    "chunk_ids",
    "primary_bullet_id",
    "primary_chunk_id",
]
BRIDGE_CONCEPT_COLUMNS = [
    "bill_id",
    "concept_id",
    "cluster_run_id",
    "cluster_id",
    "concept_label",
    "concept_criterion",
    "relation_type",
    "n_cluster_bullets",
    "n_representative_bullets",
    "mean_cluster_membership_probability",
    "bill_bullet_share",
    "bullet_ids",
    "chunk_ids",
    "primary_evidence_bullet_id",
    "primary_evidence_chunk_id",
]


def build_analysis(
    bills: pd.DataFrame,
    chunks: pd.DataFrame,
    bullets: pd.DataFrame,
    assignments: pd.DataFrame,
    concepts: pd.DataFrame,
) -> dict[str, pd.DataFrame]:
    """Build dim/bridge/one-row-per-bill marts from the selected run's assignments.

    ``assignments`` is the chosen clustering run's per-bullet table
    (``bullet_row_id, cluster_run_id, cluster_id, is_noise,
    membership_probability, outlier_score``). ``concepts`` is the synthesized
    concept table. Probability columns are HDBSCAN membership strengths, not
    concept scores; concepts are inherited from cluster membership
    (``relation_type`` records whether a bill supplied a synthesis example).
    """
    bullet_bill = bullets.merge(
        chunks[["chunk_id", "bill_id"]],
        on="chunk_id",
        how="left",
        validate="many_to_one",
    )
    detailed = assignments.merge(
        bullet_bill[["bullet_row_id", "chunk_id", "bill_id"]],
        on="bullet_row_id",
        how="left",
        validate="one_to_one",
    )

    dim_cluster_rows = []
    for (run_id, cluster_id), group in detailed.groupby(
        ["cluster_run_id", "cluster_id"], sort=True
    ):
        reps = (
            group.sort_values(
                ["membership_probability", "outlier_score"], ascending=[False, True]
            )["bullet_row_id"]
            .head(10)
            .tolist()
        )
        dim_cluster_rows.append(
            {
                "cluster_run_id": run_id,
                "cluster_id": int(cluster_id),
                "is_noise": int(cluster_id) == -1,
                "n_bullets": len(group),
                "n_chunks": group["chunk_id"].nunique(),
                "n_bills": group["bill_id"].nunique(),
                "mean_membership_probability": float(
                    group["membership_probability"].mean()
                ),
                "representative_bullet_ids": reps,
            }
        )
    dim_clusters = pd.DataFrame(
        dim_cluster_rows,
        columns=[
            "cluster_run_id",
            "cluster_id",
            "is_noise",
            "n_bullets",
            "n_chunks",
            "n_bills",
            "mean_membership_probability",
            "representative_bullet_ids",
        ],
    )

    total_by_bill = detailed.groupby("bill_id").size().to_dict()
    total_by_cluster = (
        detailed.groupby(["cluster_run_id", "cluster_id"]).size().to_dict()
    )
    bridge_rows = []
    for (bill_id, run_id, cluster_id), group in detailed.groupby(
        ["bill_id", "cluster_run_id", "cluster_id"], sort=True
    ):
        ordered = group.sort_values(
            ["membership_probability", "outlier_score"], ascending=[False, True]
        )
        primary = ordered.iloc[0]
        bridge_rows.append(
            {
                "bill_id": bill_id,
                "cluster_run_id": run_id,
                "cluster_id": int(cluster_id),
                "is_noise": int(cluster_id) == -1,
                "n_bullets": len(group),
                "n_chunks": group["chunk_id"].nunique(),
                "bill_bullet_share": len(group) / total_by_bill[bill_id],
                "cluster_bullet_share": len(group)
                / total_by_cluster[(run_id, cluster_id)],
                "mean_cluster_membership_probability": float(
                    group["membership_probability"].mean()
                ),
                "max_cluster_membership_probability": float(
                    group["membership_probability"].max()
                ),
                "bullet_ids": group["bullet_row_id"].tolist(),
                "chunk_ids": sorted(set(group["chunk_id"])),
                "primary_bullet_id": primary["bullet_row_id"],
                "primary_chunk_id": primary["chunk_id"],
            }
        )
    bridge_bill_clusters = pd.DataFrame(bridge_rows, columns=BRIDGE_CLUSTER_COLUMNS)

    chunk_of_bullet = dict(zip(bullet_bill["bullet_row_id"], bullet_bill["chunk_id"]))
    concept_rows = []
    non_noise = bridge_bill_clusters[~bridge_bill_clusters["is_noise"]]
    if not concepts.empty and not non_noise.empty:
        for relation in non_noise.merge(
            concepts, on=["cluster_run_id", "cluster_id"], how="inner"
        ).itertuples(index=False):
            reps = set(relation.representative_bullet_ids or [])
            represented = [v for v in relation.bullet_ids if v in reps]
            primary_bullet = (
                represented[0] if represented else relation.primary_bullet_id
            )
            concept_rows.append(
                {
                    "bill_id": relation.bill_id,
                    "concept_id": relation.concept_id,
                    "cluster_run_id": relation.cluster_run_id,
                    "cluster_id": relation.cluster_id,
                    "concept_label": relation.concept_label,
                    "concept_criterion": relation.concept_criterion,
                    "relation_type": (
                        "representative" if represented else "cluster_member"
                    ),
                    "n_cluster_bullets": relation.n_bullets,
                    "n_representative_bullets": len(represented),
                    "mean_cluster_membership_probability": relation.mean_cluster_membership_probability,
                    "bill_bullet_share": relation.bill_bullet_share,
                    "bullet_ids": relation.bullet_ids,
                    "chunk_ids": relation.chunk_ids,
                    "primary_evidence_bullet_id": primary_bullet,
                    "primary_evidence_chunk_id": chunk_of_bullet.get(
                        primary_bullet, relation.primary_chunk_id
                    ),
                }
            )
    bridge_bill_concepts = pd.DataFrame(concept_rows, columns=BRIDGE_CONCEPT_COLUMNS)

    cluster_nested = (
        {
            b: g.to_dict("records")
            for b, g in bridge_bill_clusters.groupby("bill_id", sort=False)
        }
        if not bridge_bill_clusters.empty
        else {}
    )
    concept_nested = (
        {
            b: g.to_dict("records")
            for b, g in bridge_bill_concepts.groupby("bill_id", sort=False)
        }
        if not bridge_bill_concepts.empty
        else {}
    )
    bill_rows = []
    for bill in bills.to_dict("records"):
        bill_id = bill["bill_id"]
        clusters = cluster_nested.get(bill_id, [])
        bconcepts = concept_nested.get(bill_id, [])
        total = sum(c["n_bullets"] for c in clusters)
        noise = sum(c["n_bullets"] for c in clusters if c["is_noise"])
        bill_rows.append(
            {
                **bill,
                "n_bullets": total,
                "n_noise_bullets": noise,
                "noise_ratio": (noise / total) if total else None,
                "n_clusters": len(
                    {c["cluster_id"] for c in clusters if not c["is_noise"]}
                ),
                "n_concepts": len({c["concept_id"] for c in bconcepts}),
                "cluster_ids": sorted(
                    {c["cluster_id"] for c in clusters if not c["is_noise"]}
                ),
                "concept_ids": sorted({c["concept_id"] for c in bconcepts}),
                "concept_labels": sorted({c["concept_label"] for c in bconcepts}),
                "clusters_json": json.dumps(clusters, ensure_ascii=False, default=str),
                "concepts_json": json.dumps(bconcepts, ensure_ascii=False, default=str),
            }
        )
    bill_concepts = pd.DataFrame(bill_rows)
    return {
        "dim_clusters": dim_clusters,
        "dim_concepts": concepts.copy(),
        "bridge_bill_clusters": bridge_bill_clusters,
        "bridge_bill_concepts": bridge_bill_concepts,
        "bill_concepts": bill_concepts,
    }


# ---------------------------------------------------------------------------
# Integrity checks
# ---------------------------------------------------------------------------
def quality_report(
    bills: pd.DataFrame,
    bullets: pd.DataFrame,
    assignments: pd.DataFrame,
    marts: dict[str, pd.DataFrame],
) -> pd.DataFrame:
    """One-row-per-check integrity report over the selected run's marts."""
    bbc = marts["bridge_bill_concepts"]
    checks = [
        ("duplicate source bill_id", int(bills["bill_id"].duplicated().sum())),
        (
            "bill_concepts not one row per bill",
            abs(len(bills) - len(marts["bill_concepts"])),
        ),
        (
            "duplicate bullet assignment",
            int(assignments["bullet_row_id"].duplicated().sum()),
        ),
        (
            "bullets missing assignment",
            int((~bullets["bullet_row_id"].isin(assignments["bullet_row_id"])).sum()),
        ),
        (
            "concept from noise cluster",
            int(bbc["cluster_id"].eq(-1).sum()) if not bbc.empty else 0,
        ),
        (
            "concept references missing concept",
            (
                int(
                    (~bbc["concept_id"].isin(marts["dim_concepts"]["concept_id"])).sum()
                )
                if not bbc.empty
                else 0
            ),
        ),
        (
            "scoring column present",
            sum(
                "score" in c.lower() and "outlier" not in c.lower() for c in bbc.columns
            ),
        ),
    ]
    report = pd.DataFrame(checks, columns=["check", "violations"])
    report["status"] = report["violations"].map(lambda v: "pass" if v == 0 else "fail")
    return report
