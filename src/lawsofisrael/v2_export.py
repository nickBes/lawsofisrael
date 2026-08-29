"""
v2_export.py
------------
Build the v2 label + provenance artifacts for manual exploration, and guard
against any scoring having leaked into a v2 run.

v2 ends after generation, review, and selection. There is no apply/score stage,
no ``scores_df``, and no ``scores.parquet``. This module turns the selected
LLooM concepts (the compact, condition-faithful Hebrew labels) into two
inspectable tables:

- ``concepts_table``: one row per selected concept - ``concept_id``, ``label``
  (the Hebrew ``name``), ``criterion`` (the internal inclusion criterion), and
  the list of representative chunk ids.
- ``membership_table``: one row per (concept, representative chunk) pair, joined
  to the chunk table so every label links directly to its evidence -
  ``bill_id``, ``bill_title``, legacy ``heading_path``/``page_no``, the ordered
  ``source_spans`` provenance, and the source text/excerpt.

Every selected label is required to carry at least one resolvable representative
chunk (:func:`validate_provenance`), so no label is exported without evidence.

A cluster label represents a SHARED LEGAL PATTERN across enacted-law text - not
necessarily shared legislative intent. :data:`CLUSTER_LABEL_CAVEAT` states this
and is embedded in the exported artifact metadata.
"""

from __future__ import annotations

from typing import Any, Optional

CLUSTER_LABEL_CAVEAT = (
    "Cluster labels describe a shared legal PATTERN (operative effect and "
    "explicit scope/conditions) across the enacted-law text of multiple bills. "
    "They do NOT establish shared legislative INTENT: final enacted-law text "
    "can support statements about legal effect and explicit scope, but cannot "
    "independently establish the government's unexpressed purpose. Trace each "
    "label to its exported source spans before drawing conclusions."
)


def selected_concepts(session) -> dict:
    """Return the mapping of selected (active) concept_id -> Concept.

    ``session.select_auto`` / manual selection flips ``concept.active``; only
    active concepts are exported.
    """
    return {c_id: c for c_id, c in session.concepts.items() if getattr(c, "active", False)}


def _rep_chunk_ids(concept) -> list[str]:
    return [str(x) for x in getattr(concept, "example_ids", [])]


def build_concepts_table(session) -> list[dict]:
    """One row per selected concept: id, Hebrew label, internal criterion, rep ids."""
    rows = []
    for c_id, c in selected_concepts(session).items():
        rows.append({
            "concept_id": c_id,
            "label": c.name,
            "criterion": c.prompt,
            "rep_chunk_ids": _rep_chunk_ids(c),
        })
    return rows


def build_membership_table(
    session,
    chunk_lookup: dict[str, dict],
    quotes_lookup: Optional[dict[str, list]] = None,
    bullets_lookup: Optional[dict[str, list]] = None,
) -> list[dict]:
    """One row per (concept, representative chunk), joined to chunk provenance.

    ``chunk_lookup`` maps ``chunk_id`` -> a chunk dict (as produced by
    :func:`lawsofisrael.chunking.chunks_to_records`), providing ``bill_id``,
    ``name``, ``heading_path``, ``page_no``, ``text`` and ``source_spans``.

    ``quotes_lookup`` / ``bullets_lookup`` optionally map ``chunk_id`` -> the
    LLooM-generated filter *quotes* and summarize *bullets* for that chunk (see
    :func:`distill_lookups`). These are the intermediate artifacts the label was
    actually synthesized from, so exporting them lets a reader see the pipeline's
    reasoning path. They are provided *in addition to* the authoritative
    ``source_text`` (raw enacted-law text), not instead of it: the source text
    is ground truth for checking condition-faithfulness, while quotes/bullets are
    model outputs that could themselves have dropped a qualifier.

    Representative chunk ids that are not present in ``chunk_lookup`` are still
    emitted (with ``resolved=False``) so gaps are visible rather than silently
    dropped; :func:`validate_provenance` enforces overall integrity.
    """
    quotes_lookup = quotes_lookup or {}
    bullets_lookup = bullets_lookup or {}
    rows = []
    for c_id, c in selected_concepts(session).items():
        for chunk_id in _rep_chunk_ids(c):
            chunk = chunk_lookup.get(chunk_id)
            quotes = quotes_lookup.get(chunk_id, [])
            bullets = bullets_lookup.get(chunk_id, [])
            if chunk is None:
                rows.append({
                    "concept_id": c_id,
                    "label": c.name,
                    "criterion": c.prompt,
                    "chunk_id": chunk_id,
                    "resolved": False,
                    "bill_id": None,
                    "bill_title": None,
                    "heading_path": None,
                    "page_no": None,
                    "source_spans": None,
                    "source_text": None,
                    "quotes": quotes,
                    "bullets": bullets,
                })
                continue
            rows.append({
                "concept_id": c_id,
                "label": c.name,
                "criterion": c.prompt,
                "chunk_id": chunk_id,
                "resolved": True,
                "bill_id": chunk.get("bill_id"),
                "bill_title": chunk.get("name"),
                "heading_path": chunk.get("heading_path"),
                "page_no": chunk.get("page_no"),
                "source_spans": chunk.get("source_spans"),
                "source_text": chunk.get("text"),
                # LLooM-generated intermediate artifacts (reasoning path).
                "quotes": quotes,
                "bullets": bullets,
            })
    return rows


def make_chunk_lookup(chunk_records: list[dict]) -> dict[str, dict]:
    """Index chunk dicts by ``chunk_id`` for provenance joins."""
    return {str(r["chunk_id"]): r for r in chunk_records}


def _group_texts_by_id(df, id_col: str, text_col: str) -> dict[str, list]:
    """Group a distill dataframe's text column into ``{id: [text, ...]}``."""
    lookup: dict[str, list] = {}
    if df is None:
        return lookup
    for _, row in df.iterrows():
        lookup.setdefault(str(row[id_col]), []).append(row[text_col])
    return lookup


def distill_lookups(session) -> tuple[dict[str, list], dict[str, list]]:
    """Extract per-chunk filter *quotes* and summarize *bullets* from a session.

    Returns ``(quotes_lookup, bullets_lookup)``, each mapping ``chunk_id`` -> a
    list of strings. LLooM stores the filtered quotes on ``session.df_filtered``
    and the summary bullets on ``session.df_bullets``, both keyed by the doc-id
    column and holding their text in the doc column. Missing attributes yield
    empty lookups, so this is safe to call before/without those stages.
    """
    id_col = getattr(session, "doc_id_col", "chunk_id")
    text_col = getattr(session, "doc_col", "text")
    quotes = _group_texts_by_id(getattr(session, "df_filtered", None), id_col, text_col)
    bullets = _group_texts_by_id(getattr(session, "df_bullets", None), id_col, text_col)
    return quotes, bullets


class ProvenanceError(ValueError):
    """Raised when a selected label lacks resolvable evidence."""


def validate_provenance(concepts_table: list[dict], membership_table: list[dict]) -> None:
    """Ensure every selected label has at least one resolved representative chunk.

    Raises :class:`ProvenanceError` if a concept has no representative chunk ids
    or if none of its representative chunks resolve to the chunk table. This is
    the "evidence required for every selected label" guarantee.
    """
    resolved_by_concept: dict[Any, int] = {}
    for row in membership_table:
        if row.get("resolved"):
            resolved_by_concept[row["concept_id"]] = resolved_by_concept.get(row["concept_id"], 0) + 1

    for c in concepts_table:
        c_id = c["concept_id"]
        if not c.get("rep_chunk_ids"):
            raise ProvenanceError(f"concept {c_id!r} ({c.get('label')!r}) has no representative chunk ids")
        if resolved_by_concept.get(c_id, 0) == 0:
            raise ProvenanceError(
                f"concept {c_id!r} ({c.get('label')!r}) has no representative chunk that resolves to the chunk table"
            )


def assert_no_scoring(session) -> None:
    """Guard: fail if any score results exist on the session.

    v2 must never call ``session.score``; if it had, ``session.results`` would
    be populated. This is called at the end of a v2 run and in tests.
    """
    results = getattr(session, "results", None)
    if results:
        raise AssertionError(
            "v2 must not score: session.results is non-empty "
            f"({len(results)} concept result set(s) found). Remove any session.score(...) call."
        )


def build_run_manifest(
    *,
    corpus_id: str,
    n_bills: Optional[int],
    n_chunks: int,
    chat_model: str,
    embed_model: str,
    lloom_version: str,
    gen_params: dict,
    prompt_info: dict,
    timestamp: str,
    experiment: str = "lloom_v2_condition_faithful_labels",
    bullet_accounting: Optional[dict] = None,
    nearest_neighbor_info: Optional[dict] = None,
    clustering_info: Optional[dict] = None,
    artifact_paths: Optional[dict] = None,
) -> dict:
    """Assemble the reproducible v2 / v2.1 run manifest (embeds the label caveat).

    ``prompt_info`` may carry either just the synthesis prompt version/hash (v2)
    or both the summarize and synthesis prompt metadata (v2.1). The optional
    v2.1 blocks record how the pre-clustering bullets were accounted for, the
    nearest-neighbor explorer settings, the manually chosen clustering
    configuration (including the reproducibility seed), and where each artifact
    was written, so a set of labels can be traced back through the diagnostic
    workflow that produced them.
    """
    manifest = {
        "experiment": experiment,
        "corpus_id": corpus_id,
        "n_bills": n_bills,
        "n_chunks": n_chunks,
        "chat_model": chat_model,
        "embed_model": embed_model,
        "lloom_version": lloom_version,
        "gen_params": gen_params,
        "scored": False,
        "cluster_label_caveat": CLUSTER_LABEL_CAVEAT,
        "timestamp": timestamp,
    }
    manifest.update(prompt_info)
    if bullet_accounting is not None:
        manifest["bullet_accounting"] = bullet_accounting
    if nearest_neighbor_info is not None:
        manifest["nearest_neighbor"] = nearest_neighbor_info
    if clustering_info is not None:
        manifest["clustering"] = clustering_info
    if artifact_paths is not None:
        manifest["artifacts"] = artifact_paths
    return manifest
