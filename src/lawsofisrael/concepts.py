"""Mechanical helpers for the full-bill LLooM concept pipeline.

This module holds only the long, pure, uninteresting-to-read plumbing that would
be noise inside the driver notebook:

- parquet checkpoint + content-hash helpers;
- ``select_documents``   : deterministic one-PDF-per-bill selection policy;
- ``download_pdfs``      : local content-addressed PDF cache (explicit network);
- ``extract_pdfs`` / ``build_chunks`` : thin wrappers over ``extraction`` /
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
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import pandas as pd

from . import chunking, extraction


# ---------------------------------------------------------------------------
# Checkpoint + hashing plumbing
# ---------------------------------------------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def canonical_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


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
    "bill_id", "bill_document_id", "document_label", "document_url",
    "document_format", "selection_state", "selection_rule",
    "selection_reason", "candidate_count", "selection_rank",
]


def _is_passed(status: Any) -> bool:
    return "התקבלה בקריאה שלישית" in str(status or "")


def _label_rank(label: str, patterns: list[str]) -> int:
    for index, pattern in enumerate(patterns, start=1):
        if re.search(pattern, label, flags=re.IGNORECASE):
            return index
    return len(patterns) + 1


def select_documents(
    bills: pd.DataFrame,
    documents: pd.DataFrame,
    *,
    official_law_label: str = "חוק - פרסום ברשומות",
    fallback_label_patterns: Iterable[str] = ("נוסח", "הצעת חוק", "פרסום", "חוק"),
) -> pd.DataFrame:
    """Choose one deterministic PDF candidate per bill; keep unresolved bills.

    Passed bills prefer the exact official published-law document; otherwise the
    first candidate by configured label priority wins. Bills with no usable PDF
    stay in the output with ``selection_state='no_supported_pdf'`` so coverage
    is never silently reduced.
    """
    patterns = list(fallback_label_patterns)
    docs = documents.copy()
    for column in ("document_label", "document_url", "document_format"):
        if column not in docs:
            docs[column] = None
    docs["document_label"] = docs["document_label"].fillna("").astype(str).str.strip()
    docs["document_url"] = docs["document_url"].fillna("").astype(str).str.strip()
    url_lower = docs["document_url"].str.lower().str.split("?").str[0]
    docs["is_pdf"] = docs["document_format"].fillna("").str.lower().eq("pdf") | url_lower.str.endswith(".pdf")

    rows: list[dict[str, Any]] = []
    for bill in bills.itertuples(index=False):
        bill_id = bill.bill_id
        candidates = docs[(docs["bill_id"] == bill_id) & docs["is_pdf"] & docs["document_url"].ne("")].copy()
        count = len(candidates)
        if count == 0:
            rows.append({
                "bill_id": bill_id, "bill_document_id": None, "document_label": None,
                "document_url": None, "document_format": None,
                "selection_state": "no_supported_pdf", "selection_rule": None,
                "selection_reason": "no LegalDocuments PDF with a usable URL",
                "candidate_count": 0, "selection_rank": None,
            })
            continue
        passed = _is_passed(getattr(bill, "status", None))
        candidates["official"] = passed & candidates["document_label"].eq(official_law_label)
        candidates["fallback_rank"] = candidates["document_label"].map(lambda value: _label_rank(value, patterns))
        candidates = candidates.sort_values(
            ["official", "fallback_rank", "document_ordinal", "bill_document_id"],
            ascending=[False, True, True, True], kind="stable",
        )
        selected = candidates.iloc[0]
        rule = "passed_official_law_exact" if selected["official"] else "ranked_document_label"
        rows.append({
            "bill_id": bill_id, "bill_document_id": selected["bill_document_id"],
            "document_label": selected["document_label"], "document_url": selected["document_url"],
            "document_format": selected["document_format"], "selection_state": "selected",
            "selection_rule": rule,
            "selection_reason": f"selected rank {int(selected['fallback_rank'])} of {count} PDF candidates",
            "candidate_count": count, "selection_rank": int(selected["fallback_rank"]),
        })
    return pd.DataFrame(rows, columns=SELECTION_COLUMNS)


# ---------------------------------------------------------------------------
# Local content-addressed PDF cache (explicit network action)
# ---------------------------------------------------------------------------
PDF_COLUMNS = [
    "bill_id", "bill_document_id", "document_url", "download_state",
    "http_status", "pdf_sha256", "byte_count", "local_storage_key",
    "retrieved_at", "error",
]


def _pdf_target(store: Path, digest: str) -> Path:
    return store / digest[:2] / f"{digest}.pdf"


def download_pdfs(
    selections: pd.DataFrame,
    store_dir: Path | str,
    *, timeout_seconds: int = 60, retries: int = 4, delay_seconds: float = 0.2,
    prior: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Download selected PDFs into a SHA-256 store. Calling this hits the network.

    Reuses prior manifest rows whose file still exists so reruns do not refetch.
    PDF bytes are never written to parquet; only the manifest (url, hash, byte
    count, local key, status) is returned.
    """
    import requests
    from requests.adapters import HTTPAdapter
    from urllib3.util.retry import Retry

    store = Path(store_dir)
    prior_by_doc: dict[Any, dict] = {}
    if prior is not None and not prior.empty:
        prior_by_doc = {row.bill_document_id: row._asdict() for row in prior.itertuples(index=False)}

    session = requests.Session()
    session.headers.update({"User-Agent": "lawsofisrael-concepts/0.2", "Accept": "application/pdf"})
    session.mount("https://", HTTPAdapter(max_retries=Retry(
        total=retries, backoff_factor=0.5,
        status_forcelist=(429, 500, 502, 503, 504), allowed_methods={"GET"},
    )))

    rows: list[dict[str, Any]] = []
    for selected in selections.itertuples(index=False):
        if selected.selection_state != "selected":
            rows.append({
                "bill_id": selected.bill_id, "bill_document_id": selected.bill_document_id,
                "document_url": selected.document_url, "download_state": "not_selected",
                "http_status": None, "pdf_sha256": None, "byte_count": None,
                "local_storage_key": None, "retrieved_at": None,
                "error": selected.selection_reason,
            })
            continue
        prior_row = prior_by_doc.get(selected.bill_document_id)
        if prior_row and prior_row.get("download_state") == "available" and prior_row.get("local_storage_key") and Path(prior_row["local_storage_key"]).exists():
            rows.append(prior_row)
            continue
        try:
            response = session.get(selected.document_url, timeout=timeout_seconds)
            response.raise_for_status()
            payload = response.content
            if not payload.startswith(b"%PDF"):
                raise ValueError("response does not start with a PDF header")
            digest = hashlib.sha256(payload).hexdigest()
            path = _pdf_target(store, digest)
            path.parent.mkdir(parents=True, exist_ok=True)
            if not path.exists():
                staged = path.with_suffix(".pdf.part")
                staged.write_bytes(payload)
                staged.replace(path)
            rows.append({
                "bill_id": selected.bill_id, "bill_document_id": selected.bill_document_id,
                "document_url": selected.document_url, "download_state": "available",
                "http_status": response.status_code, "pdf_sha256": digest,
                "byte_count": len(payload), "local_storage_key": str(path),
                "retrieved_at": now_iso(), "error": None,
            })
        except Exception as error:  # noqa: BLE001 - keep per-row failure, allow rerun
            rows.append({
                "bill_id": selected.bill_id, "bill_document_id": selected.bill_document_id,
                "document_url": selected.document_url, "download_state": "failed",
                "http_status": getattr(getattr(error, "response", None), "status_code", None),
                "pdf_sha256": None, "byte_count": None, "local_storage_key": None,
                "retrieved_at": now_iso(), "error": str(error),
            })
        time.sleep(delay_seconds)
    return pd.DataFrame(rows, columns=PDF_COLUMNS)


# ---------------------------------------------------------------------------
# Extraction + chunking (thin wrappers over extraction/ chunking modules)
# ---------------------------------------------------------------------------
EXTRACTION_DOC_COLUMNS = [
    "extraction_id", "bill_id", "bill_document_id", "pdf_sha256",
    "extraction_state", "page_count", "hebrew_ratio", "ocr_fallback_used",
    "extracted_at", "error",
]
EXTRACTION_BLOCK_COLUMNS = [
    "extraction_id", "bill_id", "bill_document_id", "pdf_sha256", "block_id",
    "block_ordinal", "kind", "text", "page_no", "heading_path", "source",
]
CHUNK_COLUMNS = [
    "chunk_id", "chunk_key", "chunk_ordinal", "bill_id", "bill_document_id",
    "extraction_id", "pdf_sha256", "bill_title", "heading_path", "page_no",
    "text", "tokens", "source_spans",
]


def extract_pdfs(
    pdf_manifest: pd.DataFrame,
    bills: pd.DataFrame,
    *, document_timeout_seconds: int = 120,
    prior_documents: pd.DataFrame | None = None,
    prior_blocks: pd.DataFrame | None = None,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Extract available local PDFs, reusing records keyed by content identity."""
    names = dict(zip(bills["bill_id"], bills.get("name", pd.Series([""] * len(bills)))))
    prior_docs = {row.extraction_id: row._asdict() for row in prior_documents.itertuples(index=False)} if prior_documents is not None and not prior_documents.empty else {}
    prior_block_groups = {k: g.to_dict("records") for k, g in prior_blocks.groupby("extraction_id", sort=False)} if prior_blocks is not None and not prior_blocks.empty else {}

    doc_rows: list[dict[str, Any]] = []
    block_rows: list[dict[str, Any]] = []
    for pdf in pdf_manifest.itertuples(index=False):
        if pdf.download_state != "available" or not pdf.pdf_sha256:
            extraction_id = f"extract_{content_hash({'document': pdf.bill_document_id, 'pdf': None})[:24]}"
            doc_rows.append({
                "extraction_id": extraction_id, "bill_id": pdf.bill_id,
                "bill_document_id": pdf.bill_document_id, "pdf_sha256": pdf.pdf_sha256,
                "extraction_state": "not_available", "page_count": None, "hebrew_ratio": None,
                "ocr_fallback_used": None, "extracted_at": None,
                "error": pdf.error or pdf.download_state,
            })
            continue
        extraction_id = f"extract_{content_hash({'pdf_sha256': pdf.pdf_sha256, 'schema': extraction.EXTRACTION_SCHEMA_VERSION, 'timeout': document_timeout_seconds})[:24]}"
        reuse = prior_docs.get(extraction_id)
        if reuse and reuse.get("extraction_state") == "success":
            doc_rows.append(reuse)
            block_rows.extend(prior_block_groups.get(extraction_id, []))
            continue
        record = extraction.extract_pdf_bytes(
            Path(pdf.local_storage_key).read_bytes(), bill_id=pdf.bill_id,
            name=str(names.get(pdf.bill_id) or ""), document_timeout=document_timeout_seconds,
        )
        doc_rows.append({
            "extraction_id": extraction_id, "bill_id": pdf.bill_id,
            "bill_document_id": pdf.bill_document_id, "pdf_sha256": pdf.pdf_sha256,
            "extraction_state": record["status"], "page_count": record.get("page_count"),
            "hebrew_ratio": record.get("hebrew_ratio"),
            "ocr_fallback_used": record.get("ocr_fallback_used"),
            "extracted_at": record.get("extracted_at"), "error": record.get("error"),
        })
        for ordinal, block in enumerate(record.get("blocks", [])):
            block_rows.append({
                "extraction_id": extraction_id, "bill_id": pdf.bill_id,
                "bill_document_id": pdf.bill_document_id, "pdf_sha256": pdf.pdf_sha256,
                "block_id": block.get("block_id"), "block_ordinal": ordinal,
                "kind": block.get("kind"), "text": block.get("text"),
                "page_no": block.get("page_no"),
                "heading_path": block.get("heading_path") or [],
                "source": block.get("source", "docling"),
            })
    return (
        pd.DataFrame(doc_rows, columns=EXTRACTION_DOC_COLUMNS),
        pd.DataFrame(block_rows, columns=EXTRACTION_BLOCK_COLUMNS),
    )


def build_chunks(
    extraction_documents: pd.DataFrame,
    extraction_blocks: pd.DataFrame,
    bills: pd.DataFrame,
    *, chunk_tokens: int = 3000,
) -> pd.DataFrame:
    """Build provenance-preserving chunks from successful extractions."""
    if chunk_tokens <= 0:
        raise ValueError("chunk_tokens must be positive")
    names = dict(zip(bills["bill_id"], bills.get("name", pd.Series([""] * len(bills)))))
    groups = {k: g.sort_values("block_ordinal").to_dict("records") for k, g in extraction_blocks.groupby("extraction_id", sort=False)}
    rows: list[dict[str, Any]] = []
    for doc in extraction_documents.itertuples(index=False):
        if doc.extraction_state != "success":
            continue
        blocks = [{
            "block_id": b["block_id"], "kind": b["kind"], "text": b["text"],
            "page_no": b["page_no"], "heading_path": b["heading_path"] or [],
            "source": b["source"],
        } for b in groups.get(doc.extraction_id, [])]
        record = {"bill_id": doc.bill_id, "name": str(names.get(doc.bill_id) or ""), "status": "success", "blocks": blocks}
        for ordinal, built in enumerate(chunking.chunk_bill(record, chunk_tokens)):
            spans = []
            for span_ordinal, span in enumerate(built.source_spans):
                value = span.to_dict()
                value.update({
                    "span_ordinal": span_ordinal, "bill_document_id": doc.bill_document_id,
                    "extraction_id": doc.extraction_id, "pdf_sha256": doc.pdf_sha256,
                })
                spans.append(value)
            rows.append({
                "chunk_id": f"{doc.bill_id}:{str(doc.bill_document_id)[-8:]}:{ordinal:04d}",
                "chunk_key": content_hash({"extraction_id": doc.extraction_id, "chunk_tokens": chunk_tokens, "ordinal": ordinal, "text": built.text}),
                "chunk_ordinal": ordinal, "bill_id": doc.bill_id,
                "bill_document_id": doc.bill_document_id, "extraction_id": doc.extraction_id,
                "pdf_sha256": doc.pdf_sha256, "bill_title": str(names.get(doc.bill_id) or ""),
                "heading_path": built.heading_path, "page_no": built.page_no,
                "text": built.text, "tokens": built.tokens, "source_spans": spans,
            })
    return pd.DataFrame(rows, columns=CHUNK_COLUMNS)


# ---------------------------------------------------------------------------
# Query-ready bill-level marts
# ---------------------------------------------------------------------------
BRIDGE_CLUSTER_COLUMNS = ["bill_id", "cluster_run_id", "cluster_id", "is_noise", "n_bullets", "n_chunks", "bill_bullet_share", "cluster_bullet_share", "mean_cluster_membership_probability", "max_cluster_membership_probability", "bullet_ids", "chunk_ids", "primary_bullet_id", "primary_chunk_id"]
BRIDGE_CONCEPT_COLUMNS = ["bill_id", "concept_id", "cluster_run_id", "cluster_id", "concept_label", "concept_criterion", "relation_type", "n_cluster_bullets", "n_representative_bullets", "mean_cluster_membership_probability", "bill_bullet_share", "bullet_ids", "chunk_ids", "primary_evidence_bullet_id", "primary_evidence_chunk_id"]


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
    bullet_bill = bullets.merge(chunks[["chunk_id", "bill_id"]], on="chunk_id", how="left", validate="many_to_one")
    detailed = assignments.merge(bullet_bill[["bullet_row_id", "chunk_id", "bill_id"]], on="bullet_row_id", how="left", validate="one_to_one")

    dim_cluster_rows = []
    for (run_id, cluster_id), group in detailed.groupby(["cluster_run_id", "cluster_id"], sort=True):
        reps = group.sort_values(["membership_probability", "outlier_score"], ascending=[False, True])["bullet_row_id"].head(10).tolist()
        dim_cluster_rows.append({"cluster_run_id": run_id, "cluster_id": int(cluster_id), "is_noise": int(cluster_id) == -1, "n_bullets": len(group), "n_chunks": group["chunk_id"].nunique(), "n_bills": group["bill_id"].nunique(), "mean_membership_probability": float(group["membership_probability"].mean()), "representative_bullet_ids": reps})
    dim_clusters = pd.DataFrame(dim_cluster_rows, columns=["cluster_run_id", "cluster_id", "is_noise", "n_bullets", "n_chunks", "n_bills", "mean_membership_probability", "representative_bullet_ids"])

    total_by_bill = detailed.groupby("bill_id").size().to_dict()
    total_by_cluster = detailed.groupby(["cluster_run_id", "cluster_id"]).size().to_dict()
    bridge_rows = []
    for (bill_id, run_id, cluster_id), group in detailed.groupby(["bill_id", "cluster_run_id", "cluster_id"], sort=True):
        ordered = group.sort_values(["membership_probability", "outlier_score"], ascending=[False, True])
        primary = ordered.iloc[0]
        bridge_rows.append({"bill_id": bill_id, "cluster_run_id": run_id, "cluster_id": int(cluster_id), "is_noise": int(cluster_id) == -1, "n_bullets": len(group), "n_chunks": group["chunk_id"].nunique(), "bill_bullet_share": len(group) / total_by_bill[bill_id], "cluster_bullet_share": len(group) / total_by_cluster[(run_id, cluster_id)], "mean_cluster_membership_probability": float(group["membership_probability"].mean()), "max_cluster_membership_probability": float(group["membership_probability"].max()), "bullet_ids": group["bullet_row_id"].tolist(), "chunk_ids": sorted(set(group["chunk_id"])), "primary_bullet_id": primary["bullet_row_id"], "primary_chunk_id": primary["chunk_id"]})
    bridge_bill_clusters = pd.DataFrame(bridge_rows, columns=BRIDGE_CLUSTER_COLUMNS)

    chunk_of_bullet = dict(zip(bullet_bill["bullet_row_id"], bullet_bill["chunk_id"]))
    concept_rows = []
    non_noise = bridge_bill_clusters[~bridge_bill_clusters["is_noise"]]
    if not concepts.empty and not non_noise.empty:
        for relation in non_noise.merge(concepts, on=["cluster_run_id", "cluster_id"], how="inner").itertuples(index=False):
            reps = set(relation.representative_bullet_ids or [])
            represented = [v for v in relation.bullet_ids if v in reps]
            primary_bullet = represented[0] if represented else relation.primary_bullet_id
            concept_rows.append({"bill_id": relation.bill_id, "concept_id": relation.concept_id, "cluster_run_id": relation.cluster_run_id, "cluster_id": relation.cluster_id, "concept_label": relation.concept_label, "concept_criterion": relation.concept_criterion, "relation_type": "representative" if represented else "cluster_member", "n_cluster_bullets": relation.n_bullets, "n_representative_bullets": len(represented), "mean_cluster_membership_probability": relation.mean_cluster_membership_probability, "bill_bullet_share": relation.bill_bullet_share, "bullet_ids": relation.bullet_ids, "chunk_ids": relation.chunk_ids, "primary_evidence_bullet_id": primary_bullet, "primary_evidence_chunk_id": chunk_of_bullet.get(primary_bullet, relation.primary_chunk_id)})
    bridge_bill_concepts = pd.DataFrame(concept_rows, columns=BRIDGE_CONCEPT_COLUMNS)

    cluster_nested = {b: g.to_dict("records") for b, g in bridge_bill_clusters.groupby("bill_id", sort=False)} if not bridge_bill_clusters.empty else {}
    concept_nested = {b: g.to_dict("records") for b, g in bridge_bill_concepts.groupby("bill_id", sort=False)} if not bridge_bill_concepts.empty else {}
    bill_rows = []
    for bill in bills.to_dict("records"):
        bill_id = bill["bill_id"]
        clusters = cluster_nested.get(bill_id, [])
        bconcepts = concept_nested.get(bill_id, [])
        total = sum(c["n_bullets"] for c in clusters)
        noise = sum(c["n_bullets"] for c in clusters if c["is_noise"])
        bill_rows.append({**bill, "n_bullets": total, "n_noise_bullets": noise, "noise_ratio": (noise / total) if total else None, "n_clusters": len({c["cluster_id"] for c in clusters if not c["is_noise"]}), "n_concepts": len({c["concept_id"] for c in bconcepts}), "cluster_ids": sorted({c["cluster_id"] for c in clusters if not c["is_noise"]}), "concept_ids": sorted({c["concept_id"] for c in bconcepts}), "concept_labels": sorted({c["concept_label"] for c in bconcepts}), "clusters_json": json.dumps(clusters, ensure_ascii=False, default=str), "concepts_json": json.dumps(bconcepts, ensure_ascii=False, default=str)})
    bill_concepts = pd.DataFrame(bill_rows)
    return {"dim_clusters": dim_clusters, "dim_concepts": concepts.copy(), "bridge_bill_clusters": bridge_bill_clusters, "bridge_bill_concepts": bridge_bill_concepts, "bill_concepts": bill_concepts}


# ---------------------------------------------------------------------------
# Integrity checks
# ---------------------------------------------------------------------------
def quality_report(bills: pd.DataFrame, bullets: pd.DataFrame, assignments: pd.DataFrame, marts: dict[str, pd.DataFrame]) -> pd.DataFrame:
    """One-row-per-check integrity report over the selected run's marts."""
    bbc = marts["bridge_bill_concepts"]
    checks = [
        ("duplicate source bill_id", int(bills["bill_id"].duplicated().sum())),
        ("bill_concepts not one row per bill", abs(len(bills) - len(marts["bill_concepts"]))),
        ("duplicate bullet assignment", int(assignments["bullet_row_id"].duplicated().sum())),
        ("bullets missing assignment", int((~bullets["bullet_row_id"].isin(assignments["bullet_row_id"])).sum())),
        ("concept from noise cluster", int(bbc["cluster_id"].eq(-1).sum()) if not bbc.empty else 0),
        ("concept references missing concept", int((~bbc["concept_id"].isin(marts["dim_concepts"]["concept_id"])).sum()) if not bbc.empty else 0),
        ("scoring column present", sum("score" in c.lower() and "outlier" not in c.lower() for c in bbc.columns)),
    ]
    report = pd.DataFrame(checks, columns=["check", "violations"])
    report["status"] = report["violations"].map(lambda v: "pass" if v == 0 else "fail")
    return report
