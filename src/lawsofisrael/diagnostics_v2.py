"""
diagnostics_v2.py
-----------------
Project-owned diagnostics for the LLooM **v2.1** workflow. This module makes the
pre-clustering summary bullets inspectable and lets you interrogate semantic
structure *before* committing to UMAP/HDBSCAN clustering, without editing the
installed ``text_lloom`` package under ``.venv``.

It provides four capabilities, each usable independently:

1. **Bullet artifact capture** (:func:`build_bullet_artifact`): turn
   ``session.df_bullets`` into a stable, reproducible table - one row per
   pre-clustering bullet, with a stable ``bullet_row_id``, its originating
   ``chunk_id``, prompt metadata, and run metadata. It also *accounts* for the
   pipeline honestly: how many chunks entered summarization, how many produced
   at least one bullet, and how many produced none (a proxy for malformed or
   empty model JSON that LLooM otherwise drops silently).

2. **Nearest-neighbor explorer** (:func:`embed_bullets`,
   :func:`nearest_neighbors`): embed the exact bullet corpus with the local
   bge-m3 model and compute cosine nearest neighbors over the *raw* embedding
   vectors (self excluded), so you can see whether legally similar provisions
   are close before any dimensionality reduction distorts the space.

3. **Reproducible clustering diagnostics** (:class:`ClusterConfig`,
   :func:`run_clustering`): a seeded UMAP + HDBSCAN wrapper that retains the raw
   embeddings, reduced coordinates, the fitted HDBSCAN estimator, labels,
   membership probabilities, and outlier scores, all aligned to bullet ids.

4. **Condensed-tree diagnostics** (:func:`condensed_tree_table`,
   :func:`save_condensed_tree_plot`, :func:`save_umap_scatter`): tabular and
   (optionally) visual evidence for deciding whether and how to form density
   clusters.

Heavy/optional dependencies (``numpy``, ``umap``, ``hdbscan``, ``matplotlib``)
are imported lazily inside functions so this module stays importable in a plain
test environment. ``text_lloom.llm.get_embeddings`` is reused for embedding so
the diagnostic vectors are byte-for-byte the ones clustering would use.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any, Callable, Optional


# ---------------------------------------------------------------------------
# 1. Bullet artifact capture + honest accounting
# ---------------------------------------------------------------------------
def _session_cols(session) -> tuple[str, str]:
    id_col = getattr(session, "doc_id_col", "chunk_id")
    text_col = getattr(session, "doc_col", "text")
    return id_col, text_col


def bullet_row_id(chunk_id: Any, ordinal: int) -> str:
    """Stable id for a single bullet: ``{chunk_id}#b{ordinal:03d}``.

    ``ordinal`` is the 0-based position of the bullet *within its chunk*, so ids
    are stable as long as the chunk's bullet order is stable (LLooM appends
    bullets per chunk in generation order).
    """
    return f"{chunk_id}#b{ordinal:03d}"


def bill_id_of(bullet_row_id: str) -> str:
    """Recover the originating ``bill_id`` from a bullet/chunk id.

    Ids are ``{bill_id}:{chunk_ordinal:04d}#b{bullet_ordinal:03d}`` (chunk id is
    ``{bill_id}:{ordinal}``), so the bill id is the text before the first ``:``.
    Used to measure how many distinct bills a cluster spans - a cluster drawn
    from a single bill is a within-bill artifact, not a cross-bill legal concept.
    """
    return str(bullet_row_id).split(":", 1)[0]


def build_bullet_artifact(
    session,
    *,
    prompt_info: Optional[dict] = None,
    run_meta: Optional[dict] = None,
) -> list[dict]:
    """Build the pre-clustering bullet artifact from ``session.df_bullets``.

    Returns one row per bullet, each a dict with:

    - ``bullet_row_id``: stable per-bullet id (see :func:`bullet_row_id`);
    - ``chunk_id``: the originating chunk id (link back to the chunk table);
    - ``bullet_ordinal``: 0-based position of the bullet within its chunk;
    - ``bullet``: the ORIGINAL bullet text, unchanged;
    - prompt metadata keys (from ``prompt_info``, e.g. summarize prompt
      version/hash) so the corpus is traceable to the prompt that produced it;
    - run metadata keys (from ``run_meta``, e.g. corpus id / timestamp / seed).

    The original bullet text is preserved verbatim; nothing here rewrites it.
    Raises ``ValueError`` if the session has no ``df_bullets`` (summarize has
    not run yet).
    """
    df_bullets = getattr(session, "df_bullets", None)
    if df_bullets is None:
        raise ValueError("session has no df_bullets; run the summarize step first")

    id_col, text_col = _session_cols(session)
    prompt_info = dict(prompt_info or {})
    run_meta = dict(run_meta or {})

    rows: list[dict] = []
    per_chunk_counter: dict[str, int] = {}
    for _, r in df_bullets.iterrows():
        chunk_id = str(r[id_col])
        text = r[text_col]
        if text is None or str(text).strip() == "":
            # Empty placeholder row (LLooM emits [id, ""] for empty filtered
            # examples). Skip it as a bullet but it is still counted in
            # accounting via the filtered-chunk set.
            continue
        ordinal = per_chunk_counter.get(chunk_id, 0)
        per_chunk_counter[chunk_id] = ordinal + 1
        row = {
            "bullet_row_id": bullet_row_id(chunk_id, ordinal),
            "chunk_id": chunk_id,
            "bullet_ordinal": ordinal,
            "bullet": text,
        }
        row.update(prompt_info)
        row.update(run_meta)
        rows.append(row)
    return rows


def _distinct_ids(df, id_col: str) -> set:
    if df is None:
        return set()
    return {str(x) for x in df[id_col].tolist()}


def bullet_accounting(session) -> dict:
    """Account for the number of cluster inputs, surfacing silent drops.

    Compares the chunks that entered summarization (``session.df_filtered``, the
    quote-filtered corpus, or the original input) against the chunks that
    actually produced at least one non-empty bullet in ``session.df_bullets``.
    A chunk that entered but produced no bullet is counted as
    ``chunks_without_bullets`` - a proxy for malformed/empty model JSON that
    LLooM drops without warning. Returns a dict with:

    - ``n_input_chunks``: distinct chunk ids entering summarization;
    - ``n_chunks_with_bullets``: distinct chunk ids that produced >=1 bullet;
    - ``n_chunks_without_bullets``: input chunks that produced no bullet;
    - ``n_bullets``: total non-empty bullets emitted;
    - ``chunk_ids_without_bullets``: sorted list of the dropped chunk ids.
    """
    id_col, text_col = _session_cols(session)
    df_filtered = getattr(session, "df_filtered", None)
    df_bullets = getattr(session, "df_bullets", None)

    input_ids = _distinct_ids(df_filtered, id_col)
    if not input_ids:
        input_ids = _distinct_ids(getattr(session, "in_df", None), id_col)

    with_bullets: set = set()
    n_bullets = 0
    if df_bullets is not None:
        for _, r in df_bullets.iterrows():
            text = r[text_col]
            if text is None or str(text).strip() == "":
                continue
            with_bullets.add(str(r[id_col]))
            n_bullets += 1

    without = sorted(input_ids - with_bullets) if input_ids else []
    return {
        "n_input_chunks": len(input_ids),
        "n_chunks_with_bullets": len(with_bullets),
        "n_chunks_without_bullets": len(without),
        "n_bullets": n_bullets,
        "chunk_ids_without_bullets": without,
    }


def validate_bullet_artifact(bullet_rows: list[dict], chunk_ids: Optional[set] = None) -> None:
    """Validate bullet-row identity stability and chunk linkage.

    Ensures ``bullet_row_id`` values are unique and, when ``chunk_ids`` is
    provided, that every bullet links to a known input chunk. Raises
    ``ValueError`` on violation.
    """
    seen: set = set()
    for row in bullet_rows:
        rid = row["bullet_row_id"]
        if rid in seen:
            raise ValueError(f"duplicate bullet_row_id: {rid!r}")
        seen.add(rid)
        if chunk_ids is not None and str(row["chunk_id"]) not in {str(c) for c in chunk_ids}:
            raise ValueError(
                f"bullet {rid!r} references chunk {row['chunk_id']!r} not in the chunk table"
            )


# ---------------------------------------------------------------------------
# 2. Nearest-neighbor explorer (raw embeddings, cosine, self-excluded)
# ---------------------------------------------------------------------------
# Default instruction prefix (Option 1). Short Hebrew legal-rule phrases embed
# into one narrow "legal register" band unless the embedder is told the task;
# a task instruction pushes the model to represent the legal EFFECT/domain
# rather than surface phrasing. Overridable per call.
DEFAULT_EMBED_INSTRUCTION = (
    "Represent this Israeli legislative rule for grouping by legal effect "
    "and subject-matter domain: "
)


def _domain_context(context: Optional[dict]) -> str:
    """Format a compact domain hint from a chunk-context dict (Option 2).

    ``context`` may carry ``bill_title`` / ``name`` and ``heading_path``; both
    are optional. Returns a short "[domain] " prefix fragment or "" if nothing
    useful is available.
    """
    if not context:
        return ""
    parts = []
    title = context.get("bill_title") or context.get("name")
    heading = context.get("heading_path")
    if title:
        parts.append(str(title))
    if heading:
        parts.append(str(heading))
    if not parts:
        return ""
    return "[" + " | ".join(parts) + "] "


def build_embedding_input(
    bullet: str,
    *,
    instruction: Optional[str] = None,
    context: Optional[dict] = None,
) -> str:
    """Build the text actually sent to the embedder for one bullet.

    Composes (Option 1) an optional task ``instruction`` prefix and (Option 2)
    an optional domain context fragment derived from the bullet's originating
    chunk, followed by the bullet text. Passing neither reproduces the bare
    bullet, so the old behavior is available by calling with defaults disabled.
    """
    prefix = instruction if instruction is not None else ""
    return f"{prefix}{_domain_context(context)}{bullet}".strip()


def embed_bullets(
    bullet_rows: list[dict],
    embed_model,
    *,
    text_key: str = "bullet",
    instruction: Optional[str] = DEFAULT_EMBED_INSTRUCTION,
    context_by_id: Optional[dict] = None,
):
    """Embed the pre-clustering bullets, optionally with instruction + domain.

    Reuses ``text_lloom.llm.get_embeddings`` so the vectors match what the
    clustering stage would compute for the *same input text*. By default it
    applies:

    - Option 1: an ``instruction`` prefix (:data:`DEFAULT_EMBED_INSTRUCTION`);
      pass ``instruction=None`` to embed the bare bullet.
    - Option 2: per-bullet domain enrichment when ``context_by_id`` maps a
      ``chunk_id`` -> a context dict (e.g. a chunk record with ``bill_title``/
      ``name`` and ``heading_path``).

    Returns ``(ids, texts, embeddings)`` where ``texts`` is the ORIGINAL bullet
    text (for readable neighbor tables) and ``embeddings`` is the ``(n, d)``
    array of vectors over the composed input, aligned to ``ids``.
    """
    import numpy as np
    from text_lloom.llm import get_embeddings

    context_by_id = context_by_id or {}
    ids = [r["bullet_row_id"] for r in bullet_rows]
    texts = [r[text_key] for r in bullet_rows]  # original bullet, for display
    embed_inputs = [
        build_embedding_input(
            r[text_key],
            instruction=instruction,
            context=context_by_id.get(str(r.get("chunk_id"))),
        )
        for r in bullet_rows
    ]
    embeddings, _tokens = get_embeddings(embed_model, embed_inputs)
    return ids, texts, np.asarray(embeddings, dtype=float)


def _cosine_similarity_matrix(embeddings):
    """Full cosine-similarity matrix for row vectors in ``embeddings``."""
    import numpy as np

    x = np.asarray(embeddings, dtype=float)
    norms = np.linalg.norm(x, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    unit = x / norms
    return unit @ unit.T


def nearest_neighbors(
    ids: list,
    texts: list,
    embeddings,
    *,
    k: int = 5,
) -> list[dict]:
    """Compute cosine nearest neighbors for every bullet (self excluded).

    Returns one row per (query bullet, neighbor) pair, ordered per query by
    descending cosine similarity and limited to the top ``k`` neighbors:

    - ``bullet_row_id`` / ``bullet``: the query;
    - ``rank``: 1-based neighbor rank;
    - ``neighbor_id`` / ``neighbor_bullet``: the neighbor;
    - ``similarity``: cosine similarity (float).

    A query with fewer than ``k`` other bullets simply yields fewer rows. The
    query itself is never returned as its own neighbor.
    """
    import numpy as np

    if k < 1:
        raise ValueError("k must be >= 1")
    sim = _cosine_similarity_matrix(embeddings)
    n = sim.shape[0]
    rows: list[dict] = []
    for i in range(n):
        order = np.argsort(-sim[i])  # descending similarity
        rank = 0
        for j in order:
            j = int(j)
            if j == i:
                continue  # exclude self
            rank += 1
            rows.append({
                "bullet_row_id": ids[i],
                "bullet": texts[i],
                "rank": rank,
                "neighbor_id": ids[j],
                "neighbor_bullet": texts[j],
                "similarity": float(sim[i, j]),
            })
            if rank >= k:
                break
    return rows


def neighbors_for(neighbor_rows: list[dict], bullet_id) -> list[dict]:
    """Filter a neighbor table to a single query bullet (notebook convenience)."""
    return [r for r in neighbor_rows if r["bullet_row_id"] == bullet_id]


# ---------------------------------------------------------------------------
# 3. Reproducible clustering diagnostics (UMAP + HDBSCAN)
# ---------------------------------------------------------------------------
@dataclass
class ClusterConfig:
    """Explicit, versioned configuration for a clustering-diagnostics run.

    Mirrors the knobs LLooM hard-codes in ``cluster_helper`` but makes every one
    explicit and adds a ``random_state`` so UMAP output is reproducible. No
    cluster-size cutoff is imposed as a product default; the caller chooses.
    """

    # UMAP
    umap_n_neighbors: int = 15
    umap_n_components: int = 5
    umap_min_dist: float = 0.0
    umap_metric: str = "cosine"
    random_state: int = 42
    # HDBSCAN
    hdbscan_min_cluster_size: int = 5
    hdbscan_min_samples: Optional[int] = None
    hdbscan_metric: str = "euclidean"
    hdbscan_cluster_selection_method: str = "leaf"
    hdbscan_cluster_selection_epsilon: float = 0.0
    # Identity
    config_version: str = "v2.1.0"

    def validate(self) -> "ClusterConfig":
        if self.umap_n_neighbors < 2:
            raise ValueError("umap_n_neighbors must be >= 2")
        if self.umap_n_components < 2:
            raise ValueError("umap_n_components must be >= 2")
        if not (0.0 <= self.umap_min_dist <= 1.0):
            raise ValueError("umap_min_dist must be in [0, 1]")
        if self.hdbscan_min_cluster_size < 2:
            raise ValueError("hdbscan_min_cluster_size must be >= 2")
        if self.hdbscan_min_samples is not None and self.hdbscan_min_samples < 1:
            raise ValueError("hdbscan_min_samples must be >= 1 when set")
        if self.hdbscan_cluster_selection_method not in ("leaf", "eom"):
            raise ValueError("hdbscan_cluster_selection_method must be 'leaf' or 'eom'")
        if self.hdbscan_cluster_selection_epsilon < 0:
            raise ValueError("hdbscan_cluster_selection_epsilon must be >= 0")
        return self

    def to_dict(self) -> dict:
        return asdict(self)

    def run_id(self) -> str:
        """Short, filename-safe identifier encoding the salient config knobs."""
        return (
            f"umap{self.umap_n_neighbors}x{self.umap_n_components}"
            f"_mcs{self.hdbscan_min_cluster_size}"
            f"_{self.hdbscan_cluster_selection_method}"
            f"_seed{self.random_state}"
        )


@dataclass
class ClusterResult:
    """Retained artifacts from a clustering-diagnostics run, aligned by id.

    All list/array fields are aligned to ``ids`` (bullet_row_ids) index-for-index.
    ``hdb`` is the fitted HDBSCAN estimator (kept so the condensed tree can be
    exported/plotted); ``embeddings`` are the raw bge-m3 vectors and
    ``umap_coords`` the reduced coordinates.
    """

    config: ClusterConfig
    ids: list
    texts: list
    embeddings: Any            # (n, d) raw embeddings
    umap_coords: Any           # (n, umap_n_components)
    labels: Any                # (n,) HDBSCAN cluster labels (-1 = noise)
    probabilities: Any         # (n,) membership strengths
    outlier_scores: Any        # (n,) GLOSH outlier scores
    hdb: Any = None            # fitted hdbscan.HDBSCAN estimator
    bullet_prompt_hash: Optional[str] = None  # provenance guard (Task 6)

    def n_clusters(self) -> int:
        import numpy as np
        labels = np.asarray(self.labels)
        uniq = set(int(x) for x in labels.tolist())
        uniq.discard(-1)
        return len(uniq)

    def noise_ratio(self) -> float:
        import numpy as np
        labels = np.asarray(self.labels)
        if labels.size == 0:
            return 0.0
        return float((labels == -1).sum() / labels.size)

    def diagnostic_table(self) -> list[dict]:
        """One row per bullet: id, bill, text, cluster id, prob, outlier score."""
        rows = []
        for i, bid in enumerate(self.ids):
            rows.append({
                "bullet_row_id": bid,
                "bill_id": bill_id_of(bid),
                "bullet": self.texts[i],
                "cluster_id": int(self.labels[i]),
                "membership_prob": float(self.probabilities[i]),
                "outlier_score": float(self.outlier_scores[i]),
                "umap_x": float(self.umap_coords[i][0]),
                "umap_y": float(self.umap_coords[i][1]),
            })
        return rows

    def cluster_composition(self) -> list[dict]:
        """Per-cluster diagnostics, keyed on how many distinct BILLS it spans.

        Returns one row per real cluster (noise ``-1`` excluded), sorted by
        descending distinct-bill count, each with:

        - ``cluster_id``;
        - ``size``: number of bullets in the cluster;
        - ``n_bills``: number of DISTINCT bills contributing bullets;
        - ``single_bill``: True when all bullets come from one bill (a
          within-bill artifact rather than a cross-bill legal concept);
        - ``bill_ids``: sorted list of contributing bill ids;
        - ``mean_prob``: mean membership probability.

        A high ``n_bills`` is the signal a cluster reflects a legal concept that
        recurs across the corpus; ``single_bill=True`` flags the failure mode
        where a cluster is just one bill's set of related provisions.
        """
        import numpy as np

        labels = np.asarray(self.labels)
        probs = np.asarray(self.probabilities, dtype=float)
        by_cluster: dict[int, dict] = {}
        for i, bid in enumerate(self.ids):
            c = int(labels[i])
            if c == -1:
                continue
            entry = by_cluster.setdefault(c, {"bills": [], "probs": [], "size": 0})
            entry["bills"].append(bill_id_of(bid))
            entry["probs"].append(float(probs[i]))
            entry["size"] += 1

        rows = []
        for c, entry in by_cluster.items():
            bill_set = sorted(set(entry["bills"]))
            rows.append({
                "cluster_id": c,
                "size": entry["size"],
                "n_bills": len(bill_set),
                "single_bill": len(bill_set) == 1,
                "bill_ids": bill_set,
                "mean_prob": (sum(entry["probs"]) / len(entry["probs"])) if entry["probs"] else 0.0,
            })
        rows.sort(key=lambda r: (-r["n_bills"], -r["size"]))
        return rows

    def n_single_bill_clusters(self) -> int:
        """Count clusters drawn entirely from one bill (within-bill artifacts)."""
        return sum(1 for r in self.cluster_composition() if r["single_bill"])

    def n_cross_bill_clusters(self) -> int:
        """Count clusters spanning 2+ distinct bills (candidate real concepts)."""
        return sum(1 for r in self.cluster_composition() if not r["single_bill"])


def run_clustering(
    ids: list,
    texts: list,
    embeddings,
    config: ClusterConfig,
    *,
    bullet_prompt_hash: Optional[str] = None,
) -> ClusterResult:
    """Run seeded UMAP + HDBSCAN over precomputed bullet embeddings.

    The wrapper input is exactly the exported summary-bullet embeddings; nothing
    is re-summarized or re-embedded here. UMAP uses ``config.random_state`` for
    reproducible output. Returns a :class:`ClusterResult` retaining every
    intermediate artifact. Raises ``ValueError`` for datasets too small to
    reduce with the requested neighborhood.
    """
    import numpy as np
    import umap
    from hdbscan import HDBSCAN

    config.validate()
    x = np.asarray(embeddings, dtype=float)
    n = x.shape[0]
    if n < 3:
        raise ValueError(f"need at least 3 bullets to cluster, got {n}")
    # UMAP requires n_neighbors < n_samples; clamp defensively so a small
    # diagnostic corpus does not crash the reducer.
    n_neighbors = min(config.umap_n_neighbors, n - 1)
    n_components = min(config.umap_n_components, n - 1)

    reducer = umap.UMAP(
        n_neighbors=n_neighbors,
        n_components=n_components,
        min_dist=config.umap_min_dist,
        metric=config.umap_metric,
        random_state=config.random_state,
    )
    umap_coords = reducer.fit_transform(x)

    hdb = HDBSCAN(
        min_cluster_size=config.hdbscan_min_cluster_size,
        min_samples=config.hdbscan_min_samples,
        metric=config.hdbscan_metric,
        cluster_selection_method=config.hdbscan_cluster_selection_method,
        cluster_selection_epsilon=config.hdbscan_cluster_selection_epsilon,
        prediction_data=True,
    )
    hdb.fit(umap_coords)

    return ClusterResult(
        config=config,
        ids=list(ids),
        texts=list(texts),
        embeddings=x,
        umap_coords=np.asarray(umap_coords),
        labels=np.asarray(hdb.labels_),
        probabilities=np.asarray(hdb.probabilities_),
        outlier_scores=np.asarray(hdb.outlier_scores_),
        hdb=hdb,
        bullet_prompt_hash=bullet_prompt_hash,
    )


# ---------------------------------------------------------------------------
# 4. Condensed-tree diagnostics (table + optional plots)
# ---------------------------------------------------------------------------
def condensed_tree_table(result: ClusterResult):
    """Return ``hdb.condensed_tree_.to_pandas()`` for a fitted result.

    Raises ``ValueError`` if the result carries no fitted estimator.
    """
    if result.hdb is None:
        raise ValueError("cluster result has no fitted HDBSCAN estimator")
    return result.hdb.condensed_tree_.to_pandas()


def save_condensed_tree_plot(result: ClusterResult, path: str) -> Optional[str]:
    """Render the condensed tree with selected-cluster overlays to ``path``.

    Returns the path on success, or ``None`` if matplotlib is unavailable (the
    tabular diagnostics remain the source of truth, so a missing plotting
    backend is not fatal). Raises ``ValueError`` if there is no fitted estimator.
    """
    if result.hdb is None:
        raise ValueError("cluster result has no fitted HDBSCAN estimator")
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return None
    fig, ax = plt.subplots(figsize=(10, 6))
    result.hdb.condensed_tree_.plot(select_clusters=True, axis=ax)
    ax.set_title(f"HDBSCAN condensed tree - {result.config.run_id()}")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
    return path


def save_umap_scatter(result: ClusterResult, path: str) -> Optional[str]:
    """Save a 2D UMAP scatter colored by provisional HDBSCAN label.

    This is a *visualization*, not the source of similarity truth (use the
    raw-embedding nearest-neighbor table for that). Returns the path, or ``None``
    if matplotlib is unavailable.
    """
    import numpy as np
    try:
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except Exception:
        return None
    coords = np.asarray(result.umap_coords)
    labels = np.asarray(result.labels)
    fig, ax = plt.subplots(figsize=(8, 6))
    sc = ax.scatter(coords[:, 0], coords[:, 1], c=labels, cmap="tab20", s=18)
    ax.set_title(
        f"UMAP (2D) by HDBSCAN label - {result.config.run_id()} "
        f"(noise={result.noise_ratio():.0%})"
    )
    ax.set_xlabel("umap_x")
    ax.set_ylabel("umap_y")
    fig.colorbar(sc, ax=ax, label="cluster_id (-1 = noise)")
    fig.tight_layout()
    fig.savefig(path, dpi=120)
    plt.close(fig)
    return path


def clustering_manifest_entry(result: ClusterResult) -> dict:
    """Manifest-ready summary of a clustering-diagnostics run."""
    return {
        "cluster_config": result.config.to_dict(),
        "cluster_run_id": result.config.run_id(),
        "n_bullets": len(result.ids),
        "n_clusters": result.n_clusters(),
        "noise_ratio": result.noise_ratio(),
        # Bill-diversity: how many clusters are real cross-bill concepts vs
        # single-bill artifacts (see ClusterResult.cluster_composition).
        "n_cross_bill_clusters": result.n_cross_bill_clusters(),
        "n_single_bill_clusters": result.n_single_bill_clusters(),
        "bullet_prompt_hash": result.bullet_prompt_hash,
    }


# ---------------------------------------------------------------------------
# 5. Split-flow orchestration: distill -> (inspect) -> synthesize-from-chosen
# ---------------------------------------------------------------------------
# LLooM's ``session.gen`` runs distill -> cluster -> synthesize in one call.
# v2.1 deliberately breaks that apart so a human inspects nearest-neighbor and
# clustering diagnostics BEFORE any labels are synthesized, and synthesis runs
# only from a manually chosen clustering result. These helpers drive each stage
# against the installed ``text_lloom`` functions without editing ``.venv``.
async def run_distill(session, custom_prompts: dict, params: dict, *, seed=None):
    """Run only the distill stage (quote filter + summarize), no clustering.

    Populates ``session.df_filtered`` and ``session.df_bullets`` exactly as
    ``session.gen`` would, using the supplied ``custom_prompts`` (v2.1's
    free-form summarize prompt). Returns ``session.df_bullets``. This is the
    point at which the pre-clustering bullet corpus becomes available for the
    bullet artifact + nearest-neighbor diagnostics.
    """
    from text_lloom.concept_induction import distill_filter, distill_summarize

    id_col, text_col = _session_cols(session)
    filter_n_quotes = params["filter_n_quotes"]
    if filter_n_quotes > 1 and custom_prompts.get("distill_filter") is not None:
        df_filtered = await distill_filter(
            text_df=session.in_df,
            doc_col=text_col,
            doc_id_col=id_col,
            model=session.distill_model,
            n_quotes=filter_n_quotes,
            prompt_template=custom_prompts["distill_filter"],
            seed=seed,
            sess=session,
        )
        session.df_to_score = df_filtered
        session.df_filtered = df_filtered
    else:
        session.df_filtered = session.in_df[[id_col, text_col]]

    df_bullets = await distill_summarize(
        text_df=session.df_filtered,
        doc_col=text_col,
        doc_id_col=id_col,
        model=session.distill_model,
        n_bullets=params["summ_n_bullets"],
        prompt_template=custom_prompts["distill_summarize"],
        seed=seed,
        sess=session,
    )
    session.df_bullets = df_bullets
    return df_bullets


def cluster_result_to_cluster_df(result: ClusterResult, session):
    """Convert a chosen :class:`ClusterResult` into LLooM's ``cluster_df`` shape.

    LLooM's ``synthesize`` expects a frame with ``[doc_id_col, doc_col,
    cluster_id]`` and synthesizes per ``cluster_id``, drawing ``example_ids``
    from ``doc_id_col``. To keep provenance identical to the rest of v2 (labels
    resolve to *chunks*), ``doc_id_col`` is the originating ``chunk_id`` and
    ``doc_col`` is the bullet text. Noise points (cluster ``-1``) are dropped so
    only genuine density clusters are synthesized.
    """
    import pandas as pd

    id_col, text_col = _session_cols(session)
    # Recover chunk_id from bullet_row_id ("{chunk_id}#b{ordinal}").
    rows = []
    for i, bid in enumerate(result.ids):
        cluster_id = int(result.labels[i])
        if cluster_id == -1:
            continue  # drop noise
        chunk_id = str(bid).rsplit("#b", 1)[0]
        rows.append([chunk_id, result.texts[i], cluster_id])
    return pd.DataFrame(rows, columns=[id_col, text_col, "cluster_id"])


class ClusteringSelectionError(ValueError):
    """Raised when a synthesis attempt would consume a mismatched diagnostics
    result (different bullet corpus / summarize prompt than was inspected)."""


def guard_selection(result: ClusterResult, *, expected_bullet_prompt_hash: str) -> ClusterResult:
    """Guard that a chosen clustering result matches the inspected bullets.

    Prevents accidentally synthesizing labels from a diagnostics result produced
    under a different summarize prompt (and therefore a different bullet corpus)
    than the one the analyst inspected. Raises :class:`ClusteringSelectionError`
    on mismatch; returns the result unchanged when it matches.
    """
    if result.bullet_prompt_hash != expected_bullet_prompt_hash:
        raise ClusteringSelectionError(
            "chosen clustering result was built from summarize prompt hash "
            f"{result.bullet_prompt_hash!r}, but the current bullets use "
            f"{expected_bullet_prompt_hash!r}. Re-run diagnostics on the current bullets."
        )
    if result.n_clusters() == 0:
        raise ClusteringSelectionError(
            "chosen clustering result has no density clusters (all noise); "
            "no labels can be synthesized. Adjust ClusterConfig and re-inspect."
        )
    return result


async def synthesize_from_result(
    session,
    result: ClusterResult,
    custom_prompts: dict,
    params: dict,
    *,
    expected_bullet_prompt_hash: str,
    max_concepts: int,
    seed=None,
    auto_review: bool = True,
):
    """Synthesize + review + select labels from a MANUALLY chosen clustering.

    This is the deliberate selection mechanism: it runs only after the analyst
    has inspected diagnostics and picked one :class:`ClusterResult`. It guards
    against a mismatched bullet corpus, builds the per-cluster ``cluster_df``,
    runs LLooM's ``synthesize`` (with v2.1's condition-faithful synthesis
    prompt), optionally ``review``, and finally ``select_auto``. Concepts are
    written onto ``session.concepts`` exactly as ``session.gen`` would, so the
    existing v2 export path is unchanged. Returns the selected concept ids.
    """
    from text_lloom.concept_induction import synthesize, review

    guard_selection(result, expected_bullet_prompt_hash=expected_bullet_prompt_hash)

    id_col, text_col = _session_cols(session)
    cluster_df = cluster_result_to_cluster_df(result, session)

    session.concepts = {}
    df_concepts = await synthesize(
        cluster_df=cluster_df,
        doc_col=text_col,
        doc_id_col=id_col,
        model=session.synth_model,
        concept_col_prefix="concept",
        n_concepts=params["synth_n_concepts"],
        pattern_phrase="unique topic",
        prompt_template=custom_prompts["synthesize"],
        seed=seed,
        sess=session,
    )
    if auto_review:
        _, df_concepts, _ = await review(
            concepts=session.concepts,
            concept_df=df_concepts,
            concept_col_prefix="concept",
            model=session.synth_model,
            seed=seed,
            sess=session,
            return_logs=True,
        )
    await session.select_auto(max_concepts=max_concepts)
    return [c_id for c_id, c in session.concepts.items() if getattr(c, "active", False)]
