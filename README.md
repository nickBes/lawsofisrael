# lawsofisrael
Analysis of israeli laws based on https://main.knesset.gov.il/apps/legislation/main/bills

## Notebooks

1. [explore_data.ipynb](notebooks/explore_data.ipynb) — Initial data exploration and understanding
2. [scrape_passed_bills.ipynb](notebooks/scrape_passed_bills.ipynb) — **Knesset votes collection:** plenum votes, individual member ballots, bills, members, faction stints and governments from the official Website API, normalized into the star schema in [`dataset/knesset_votes/prepared/`](#knesset-votes-dataset)
3. [create_passed_bills_dataset.ipynb](notebooks/create_passed_bills_dataset.ipynb) — **Passed-bill text corpus:** flattens the raw bill JSON and attaches the official law PDF bytes, published as [`nickbes/lawsofisrael`](https://huggingface.co/datasets/nickbes/lawsofisrael). This is the corpus both LLooM notebooks read.
4. [lloom_experiment.ipynb](notebooks/lloom_experiment.ipynb) — **LLooM baseline (v1):** default LLooM concept discovery, with scoring and export
5. [lloom_experiment_v2.ipynb](notebooks/lloom_experiment_v2.ipynb) — **LLooM v2.1:** context-rich free-form summaries, similarity-first diagnostics (nearest neighbors + reproducible clustering), a manual clustering decision point, then compact condition-faithful Hebrew labels; no scoring; provenance exports
6. [concept_pipeline.ipynb](notebooks/concept_pipeline.ipynb) — **Full 8,317-bill concept run:** scales the v2.1 approach to the whole vote-linked corpus, with every stage checkpointed to Parquet. Starts from `dim_bills` + `dim_bill_documents`, selects and locally caches one PDF per bill, then runs LLooM distill → Gemini embed → seeded UMAP/HDBSCAN → synthesize/review, and builds bill-level cluster/concept tables. No KNN, no scoring. See [Full 8,317-bill concept pipeline](#full-8317-bill-concept-pipeline).

The LLooM notebooks share one implementation of the deterministic preparation
steps (PDF extraction, chunking, model/session setup) via the `lawsofisrael`
package under [`src/`](src/lawsofisrael). See [Shared package](#shared-package-srclawsofisrael).

There are two distinct datasets in this repo, and they are easy to confuse:

| Dataset | Built by | Lives in | Grain |
|---|---|---|---|
| [Knesset votes](#knesset-votes-dataset) | notebook 2 | `dataset/knesset_votes/prepared/` (committed) | voting behaviour: who voted how, on what |
| Passed-bill corpus | notebook 3 | Hugging Face `nickbes/lawsofisrael` | enacted-law text: one bill + its official PDF |

The LLooM notebooks (4, 5) read the **Hugging Face corpus**, not the votes tables.

## Knesset votes dataset

`dataset/knesset_votes/prepared/` holds the committed Parquet tables built by
[scrape_passed_bills.ipynb](notebooks/scrape_passed_bills.ipynb) from the
official Knesset Website API. Coverage is the 16th Knesset onward: **2,040 vote
dates, Knessets 16-25, March 2003 to July 2026**. The data-quality checks pass
on the committed run.

### Tables

Ten data tables, plus two that describe the run itself:

| Table | Rows | Grain |
|---|---|---|
| `fact_votes` | 36,054 | one plenum vote, with its inferred reading and official tallies |
| `fact_ballots` | 1,948,412 | one member's choice in one vote |
| `fact_vote_counters` | 67,454 | one official result counter (בעד / נגד / נמנע) for one vote |
| `fact_secret_vote_results` | 18 | one aggregate result of a secret (חשאית) vote |
| `bridge_vote_bills` | 27,900 | one confirmed vote↔bill link |
| `dim_bills` | 8,317 | one bill referenced by a bill-type vote |
| `dim_bill_documents` | — | one legal document (`sessionAndDocs.LegalDocuments`) of a bill, with its official URL; the input the concept pipeline selects PDFs from |
| `dim_members` | 1,103 | one Knesset member (all historical MKs) |
| `bridge_member_factions` | 4,487 | one member/faction stint, dated, per Knesset |
| `dim_governments` | 2,546 | one dated ministerial position, governments 0-38 (back to 1948) |
| `collection_summary` | — | run-level counts, including the `full_run` flag |
| `quality_report` | — | one integrity check: violations, limit, severity, status |

Dimensions that would be pure projections of `fact_votes` — knessets, plenum
sessions, agenda items — are **deliberately not materialised**; derive them with
a `GROUP BY` instead. (Earlier sample-run leftovers for these, plus a 25-row
`law_documents` table, were removed: they looked like real dimensions but covered
only the 16th Knesset, so joining against them silently dropped ~90% of rows.
Recover them from commit `bbeaed4` if needed.)

### Things the schema will not tell you

- **`reading` is null for 20,122 of 36,054 votes.** The reading (קריאה) is not an
  API field; it is inferred from the free-text Hebrew motion in `Decision`. Null
  means *"the motion did not state a reading"*, not *"no reading"*. Show that
  label and the original `decision` rather than treating null as missing data.
- **`knesset_num` vs `source_knesset_num`.** `knesset_num` is derived from the
  official swearing-in calendar and describes *the vote*. `source_knesset_num` is
  the raw API value, which on a carried-over bill is the bill's *originating*
  Knesset — the two differ on 416 votes. Join on `knesset_num`.
- **Only electronic (אלקטרונית, 34,877) and named (שמית, 1,087) votes carry member
  ballots.** Show-of-hands (81) and secret (9) votes publish aggregates only, so a
  vote with no rows in `fact_ballots` is usually correct, not incomplete.
- **`initiators` is empty for government bills by design** — see
  [Bill fields: initiators](#bill-fields-initiators).

### Re-running the collection

Two caches sit behind the notebook and only one of them travels between machines.
This matters the moment you want to fix the table-build or quality-report logic:

- **`.http_cache` (sqlite)** — every raw API response, keyed by request. Makes a
  re-collect free, but it is machine-local and gitignored. On a fresh clone it does
  not exist, so the default `CACHE_ONLY = True` fails on the very first request.
- **`raw_snapshot/` (gzipped JSON, one file per collection stage)** — the payloads
  each stage produced. This is the portable one. With it present, the four
  collection sections load from disk and **the build and report cells re-run with
  no network and no HTTP cache at all.**

Each collection stage goes through a `stage(name, collect)` helper that writes its
payloads once and reuses them forever after. Stages exchange only JSON-native
types (never pickle — these files get copied between machines, and unpickling one
would be arbitrary code execution), and writes are staged through a `.part` file so
an interrupted save cannot leave a truncated snapshot that later loads as if it
were complete.

So if you only want to change a downstream cell:

| Situation | What to do |
|---|---|
| You have the machine that collected it | Copy `dataset/knesset_votes/raw_snapshot/` across; keep `CACHE_ONLY = True` |
| You have neither cache, and want the real full data | `CACHE_ONLY = False` once; the snapshot is written as it collects (hours) |
| You have neither, and just want to exercise the logic | `CACHE_ONLY = False` **and** set `VOTE_DATE_SAMPLE = 40`, `BILL_LIMIT = 200` — minutes, and it writes to `prepared_sample/` |

`FULL_RUN` is derived from the two limits rather than set by hand, so only a run
with both limits at `None` can write the committed `prepared/` tables; anything
sampled goes to `prepared_sample/`. Blocking quality failures abort a full run.

## Shared package (`src/lawsofisrael`)

The preparation pipeline that both notebooks depend on lives in an importable
package rather than being copied between notebooks:

- `lawsofisrael.extraction` — Docling PDF extraction with a selective Hebrew OCR
  fallback for low-text pages, a versioned extraction-record schema, and
  incremental JSON caching (`notebooks/cache/extraction/{bill_id}.json`).
- `lawsofisrael.chunking` — legal-unit splitting, token budgeting, stable
  `bill_id:ordinal` chunk IDs, and provenance-preserving chunks that carry an
  ordered list of contributing `source_spans` (text, heading path, page number,
  source block id) while still exposing legacy first-span heading/page fields.
- `lawsofisrael.lloom` — chat + local-embedding model construction and the
  tokenizer compatibility shims LLooM needs for non-OpenAI model names.
- `lawsofisrael.prompts_v2` — the v2.1 custom prompts: a free-form,
  context-rich **summarize** prompt and the compact condition-faithful
  **synthesize** prompt, each versioned and content-hashed.
- `lawsofisrael.diagnostics_v2` — the v2.1 similarity-first diagnostic layer:
  pre-clustering bullet artifacts with honest accounting, a local-embedding
  nearest-neighbor explorer, a reproducible (seeded) UMAP+HDBSCAN
  `ClusterConfig`/`run_clustering` wrapper that retains all intermediate
  artifacts, condensed-tree diagnostics, and the split-flow orchestration that
  makes clustering a deliberate, inspected choice.
- `lawsofisrael.v2_export` — the label + provenance export helpers and the
  reproducible run manifest.
- `lawsofisrael.concepts` — mechanical plumbing for the full 8,317-bill run
  ([concept_pipeline.ipynb](notebooks/concept_pipeline.ipynb)): Parquet
  checkpoint helpers, the one-PDF-per-bill selection policy, a local
  content-addressed PDF cache, extraction/chunking wrappers, and the bill-level
  cluster/concept aggregation. The actual LLooM/Gemini/clustering calls live in
  the notebook cells, not here.

Install it once (editable) into your environment so the notebooks can import it:

```bash
# The notebooks also add ./src to sys.path automatically, so this is optional.
pip install -e .        # or: uv pip install -e .
```

### Environment

Runtime dependencies are pinned in [pyproject.toml](pyproject.toml) and locked in
`uv.lock`. On a new machine:

```bash
uv sync                 # base env: collection, preparation, publication
uv sync --extra diagnostics --extra plots   # adds the v2.1 clustering/plot deps
```

The base pins are intentionally narrow (`pandas==2.2.3`, `pyarrow==18.1.0`,
`requests-cache==1.2.1`, `datasets==3.2.0`); Docling, OCR and LLM dependencies are
imported lazily and stay out of the default environment. If notebook 2 fails at the
first import with `No module named 'requests_cache'`, or Parquet output stops
matching the committed tables, the environment has drifted from the lock file —
check with `uv pip list` before debugging the notebook.

## LLM & Embedding Setup

Both LLooM notebooks use two models:

- **LLM** (distill/synthesize; v1 also scores): an OpenAI-compatible API.
  Defaults to **Gemini 2.5 Flash**, but any OpenAI-compatible provider works.
- **Embeddings** (clustering): a **local** bge-m3 server via llama.cpp. Runs
  fine on CPU, keeps document text out of third-party API calls, and avoids the
  GPU driver issues local LLM inference used to hit.

### Quick Start

```bash
# 1. Configure the LLM API
cp .env.example .env
# Edit .env and set OPENAI_API_KEY (e.g. from https://aistudio.google.com/apikey for Gemini)

# 2. Start the local embedding server
./scripts/start_embedding_server.sh

# 3. Run a notebook:
#    - notebooks/lloom_experiment.ipynb      (v1 baseline: generate + score + export)
#    - notebooks/lloom_experiment_v2.ipynb   (v2: condition-faithful labels, no scoring)
```

### Configuration (`config.py`)

All model settings are centralized in [config.py](config.py), driven by environment variables (`.env`). Token budgets (`MAX_CONTEXT_TOKENS`, `MAX_OUTPUT_TOKENS`) are used by the notebook for chunking and LLM calls.

```python
from config import MODEL_CONFIG, EMBEDDING_URL, EMBEDDING_MODEL, MAX_CONTEXT_TOKENS, MAX_OUTPUT_TOKENS
print(MODEL_CONFIG["context_window"])
```

Key env vars (see [.env.example](.env.example)):

| Variable | Purpose | Default |
|---|---|---|
| `OPENAI_API_KEY` | API key for the LLM provider | *(required)* |
| `OPENAI_BASE_URL` | OpenAI-compatible API endpoint | Gemini API |
| `OPENAI_MODEL` | Model name | `gemini-2.5-flash` |
| `MAX_CONTEXT_TOKENS` | Context window size | `1048576` |
| `MAX_OUTPUT_TOKENS` | Max output tokens | `8192` |
| `RATE_LIMIT_RPM` | Requests per minute | `15` |

### Local embedding server

```bash
./scripts/start_embedding_server.sh
```

Starts bge-m3 via llama.cpp on port 8081 (CPU-only). Stop it with `pkill -f 'llama-server.*--port 8081'`.

## v2.1: semantic diagnostics + condition-faithful cluster labels

[lloom_experiment_v2.ipynb](notebooks/lloom_experiment_v2.ipynb) reuses the same
corpus and shared preparation pipeline as the baseline, but restructures
concept discovery so that **semantic diagnostics come before density
clustering**. LLooM's default quote filter is kept; both the summaries and the
final labels are customised.

- **Context-rich free-form summaries.** The generic default summary is replaced
  by a versioned prompt that produces natural Hebrew *operative-rule* bullets
  keeping whatever distinguishes one rule from another — affected population,
  actor, legal action, object, legal domain, and any exception/condition/time
  limit/emergency context — instead of collapsing to generic verbs like
  `תיקון חוק`, `הארכת תוקף`, or a lone `זכות`. It is not a rigid schema: no
  required slots, no mandatory field template.
- **Compact condition-faithful labels.** Synthesis still produces short Hebrew
  labels that keep material qualifications *inline* — negation, carve-outs
  (`למעט`), conditions (`בכפוף`), temporal/emergency provisions (`הוראת שעה`),
  and eligibility criteria.

### The diagnostic workflow (why clustering is a deliberate choice)

Automatic HDBSCAN clusters are **exploratory** and must be inspected against
similarity diagnostics before they are interpreted. The notebook enforces this
order and **does not bake in a cluster-size cutoff**:

1. **Distill only** — quote filter + context-rich summaries, stopping before
   any clustering.
2. **Bullet artifact + accounting** — the exact bullets entering the embedding
   stage are captured with stable ids and chunk linkage, and chunks that
   produced *no* bullet are counted (a proxy for malformed/empty model JSON).
3. **Nearest-neighbor explorer** — bullets are embedded with the local bge-m3
   model and their cosine nearest neighbors are inspected over the **raw**
   vectors (self excluded), before UMAP/HDBSCAN can distort the space.
4. **Reproducible clustering diagnostics** — one or more seeded
   `ClusterConfig`s are compared on noise ratio, cluster count, membership
   probabilities, and condensed-tree stability. Each run retains raw
   embeddings, UMAP coordinates, the fitted estimator, labels, probabilities,
   and outlier scores, and writes its condensed-tree table (plus optional plots
   if `matplotlib` is installed — it is optional, tables are the source of
   truth).
5. **Decision point → synthesis** — you *manually* set `CHOSEN_CONFIG`. While it
   is `None` the notebook stays in an exploratory, **no-label** state. Once
   chosen, a guard confirms the clustering result was built from the same
   summarize prompt (and therefore the same bullets) you inspected, then labels
   are synthesized from that result only.

### What v2.1 does and does not do

- **No scoring / no apply.** v2.1 ends after generation, review, and selection.
  It does **not** call `session.score`, build a scores table, or apply concepts
  to documents. There is no `scores.parquet` from v2.1. (The v1 baseline shares
  the `outputs/` directory and *does* score, so `scores.parquet`/`concepts.parquet`
  there belong to v1.)
- **Development subset by default.** `N_BILLS = 8` for fast, cheap iteration;
  set `N_BILLS = None` for the full corpus.
- **Reproducible run manifest.** Records chat/embedding model names, the
  installed LLooM version, **both** prompt versions and content hashes, the
  generation parameters, the bullet accounting, the nearest-neighbor settings,
  the chosen clustering configuration and its seed, the artifact paths, the
  corpus id, and a timestamp.

### v2.1 outputs

| File | Contents |
|---|---|
| `outputs/diagnostics/bullets_v2.parquet` | Pre-clustering bullet corpus: `bullet_row_id`, `chunk_id`, `bullet_ordinal`, original `bullet` text, prompt/run metadata |
| `outputs/diagnostics/nearest_neighbors_v2.parquet` | Per-bullet cosine nearest neighbors (self excluded): query id/text, `rank`, `neighbor_id`, `neighbor_bullet`, `similarity` |
| `outputs/diagnostics/condensed_tree_<key>_<run_id>.parquet` | `hdb.condensed_tree_.to_pandas()` for a diagnostic clustering config (filename includes the config/run id) |
| `outputs/diagnostics/*.png` | Optional condensed-tree and UMAP scatter plots (only if `matplotlib` is installed) |
| `outputs/labels_v2.parquet` | One row per selected label: `concept_id`, `label` (Hebrew), internal `criterion`, representative chunk ids *(only when a config is chosen)* |
| `outputs/label_provenance_v2.parquet` | One row per (label, representative chunk): `bill_id`, `bill_title`, `heading_path`, `page_no`, ordered `source_spans`, raw `source_text`, plus the LLooM `quotes`/`bullets` the label was synthesized from *(only when a config is chosen)* |
| `outputs/run_manifest_v2.json` | The reproducible run contract, diagnostic-workflow metadata, and the label caveat (always written) |

Every selected label is required to have at least one representative chunk that
resolves to the chunk table, so no label is exported without evidence. In the
exploratory (no-config) state, only the diagnostic artifacts and the manifest
are written — no labels.

### Manual exploration

Trace each label through its exported evidence end to end: **label → chosen
clustering config → bullet neighbors → source chunk → enacted-law text**. Open
`label_provenance_v2.parquet`, pick a label, and inspect both the reasoning path
(the LLooM `quotes` and summary `bullets`) and the authoritative raw
`source_text` — with bill title, heading path, and page number. Cross-check the
bullet against `nearest_neighbors_v2.parquet` to see whether legally similar
provisions really are close, and confirm the label did not drop a `למעט`
exception or `הוראת שעה` time limit. The final notebook cell demonstrates this
for one label.

### Limitation: legal effect, not intent

A cluster label represents a **shared legal pattern** — the operative effect and
explicit scope/conditions expressed across the enacted-law text of multiple
bills. It does **not** establish shared **legislative intent**. Final
enacted-law text can support statements about legal effect and explicit scope,
but it cannot independently establish the government's unexpressed purpose. This
caveat is embedded in `run_manifest_v2.json` and shown in the notebook.

### What made the pipeline work better (tuning history)

The first v2.1 runs produced poor concepts: clusters formed around generic legal
verbs, shared year tokens, and enactment boilerplate rather than around legal
concepts. The similarity-first diagnostics (nearest neighbors before clustering)
made the failures visible and drove a sequence of fixes, in order of impact:

1. **Free-form, context-rich summaries (summarize prompt).** Replacing LLooM's
   generic default summary with a prompt that keeps the distinguishing details
   of each rule (population, actor, action, object, domain, exception/condition/
   time limit) stopped bullets from collapsing to bare verbs like `תיקון חוק`.
2. **Boilerplate exclusion (summarize prompt v2.1.1 → v2.1.2).** Signatures,
   official-publication lines, formal receipt/"received in the Knesset on
   <date>", and standalone dates were being emitted as bullets and forming a
   spurious cluster. The prompt now excludes them and demotes dates/section
   references to trailing qualifiers. (This is instruction-only; the model still
   occasionally leaks one, which is a candidate for a future deterministic
   filter.)
3. **Embedding representation — the biggest lever.** Short Hebrew rule phrases
   embedded into one narrow "legal register" band, so *unrelated* bullets sat at
   ~0.85 cosine and clustering had no contrast. Three changes fixed this:
   - an **instruction prefix** telling the embedder to represent the legal
     *effect / subject-matter domain* (see `diagnostics_v2.DEFAULT_EMBED_INSTRUCTION`);
   - **domain enrichment**: prepending each bullet's bill title + heading path
     before embedding, injecting the domain signal the bare phrase lacked;
   - the **`gemini-embedding-2` model at 3072 dims** (`EMBED_BACKEND='gemini'`)
     instead of local bge-m3, which separated concepts far better on this text.
   After these, nearest neighbors became domain-coherent and crossed bill
   boundaries on shared concepts, and the similarity band spread out enough for
   density clustering to have contrast.
4. **Corpus size.** More bills give density clustering the cross-bill company a
   concept needs to form. Thin coverage is the main remaining cause of
   single-bill clusters and the occasional heterogeneous "grab-bag" cluster.

All of these are recorded per run in `run_manifest_v2.json` (prompt versions and
hashes, embedding backend/instruction/domain flag, clustering config and seed),
so any label set is traceable to the exact configuration that produced it.

### Clustering methods: `leaf` vs `eom`, and why config E

The clustering-diagnostics wrapper (`diagnostics_v2.ClusterConfig` /
`run_clustering`) runs seeded UMAP + HDBSCAN and exposes the parameters that
matter. The two that most change the result are HDBSCAN's
`cluster_selection_method` and `min_cluster_size`:

- **`eom` (excess of mass)** prefers *fewer, larger* clusters selected higher up
  the condensed tree. On this corpus it over-merged: it pulled loosely related
  neighborhoods into big, low-confidence "grab-bag" clusters (e.g. a 42-bullet,
  8-bill cluster with mean membership probability ~0.52). Raising
  `min_cluster_size` under `eom` made this *worse*, not better.
- **`leaf`** selects the *finest* clusters at the bottom of the tree — *more,
  smaller, tighter* clusters. It avoids the bad merges but produces more
  single-bill clusters (a narrow concept from one bill, flagged by the
  `single_bill` column — correct, not junk).
- **`min_cluster_size`** is the floor on cluster size: smaller allows more
  clusters (including tiny ones); larger forces broader grouping.
- **`cluster_selection_epsilon`** merges clusters closer than the given
  distance; kept at `0.0` to avoid additional merging.

Configurations compared (all seed 42, UMAP 15×5):

| Config | method | min_cluster_size | Result |
|---|---|---|---|
| A | leaf | 3 | Very fragmented; many tiny single-bill clusters |
| B | eom | 5 | ~2 good cross-bill concepts + grab-bags |
| C | leaf | 5 | ≈ B; grab-bags survived |
| D | eom | 7 | Worse — one 42-bullet, mean_prob 0.52 grab-bag |
| **E** | **leaf** | **4** | **Chosen** — many coherent clusters, minimal bad merges |

**Why E.** The goal here favors *over-splitting over bad merges*: an
over-split concept can be merged or ignored later, but merging unrelated
concepts destroys information. `leaf` is the "more, tighter clusters" method by
design, and `min_cluster_size=4` is a middle ground between A's over-fragmented
`mcs=3` and C's `mcs=5`. On inspection, E's clusters were mostly coherent legal
concepts (single-bill ones included), its bad merges were minimal, and the one
persistent heterogeneous cluster had a low mean membership probability, making
it easy to flag and drop. Note that HDBSCAN **cluster ids are not stable across
configurations** — compare clusters by their bullet contents, not by id.

**Deciding whether a cluster is real.** The `ClusterResult.cluster_composition`
diagnostic reports, per cluster, how many *distinct bills* it spans and flags
single-bill clusters. A cluster spanning several bills on a shared concept is the
target; a single-bill cluster is a narrow (but often valid) concept; a large
cluster with low mean membership probability is usually a grab-bag to inspect
before trusting. Always confirm a cluster by reading its bullets, then trace the
final label through `label_provenance_v2.parquet` to its source text.

## Bill fields: initiators

Applies to `initiators` in both `dim_bills` and the Hugging Face corpus — it is the
same upstream API field. For scale: of the 8,317 bills in `dim_bills`, 6,186 are
private (פרטית), 2,061 government (ממשלתית) and 70 committee (ועדה) bills.

The `initiators` field is **only populated for private bills** (הצעות חוק פרטיות). Government bills (הצעות חוק ממשלתיות) do not have individual initiators because they are proposed by the government itself.

- **Private bills** (`proposal_type == "פרטית"`): Contain Knesset member names in the `initiators` field (comma-separated string)
- **Government bills** (`proposal_type == "ממשלתית"`): Have an empty `initiators` field — the "initiator" is effectively the government/ministry

This is expected behavior from the Knesset API, not missing data.

**Note:** Private bill initiators are always Knesset members. Third parties (citizens, organizations, lobbyists) cannot be listed as initiators, though they may draft bills that Knesset members formally propose.

## Full 8,317-bill concept pipeline

Scales LLooM concept discovery to the full vote-linked corpus. It is driven by
[`notebooks/concept_pipeline.ipynb`](notebooks/concept_pipeline.ipynb) over flat
helpers in [`lawsofisrael.concepts`](src/lawsofisrael/concepts.py), with every
stage checkpointed to Parquet under `dataset/bill_concepts/runs/<run-id>/`. See
[`docs/concept_pipeline.md`](docs/concept_pipeline.md) for the full data flow.

It starts from the vote-linked `dim_bills` plus `dim_bill_documents` (the latter
built by the scrape notebook from its existing request-cache — see below),
selects one traceable PDF per bill, caches PDF binaries locally by SHA-256, then
runs extraction, LLooM distillation, Gemini embeddings, seeded UMAP/HDBSCAN, and
semantic concept synthesis/review.

It intentionally performs **no nearest-neighbor stage and no concept scoring**.
Final query tables are `bridge_bill_clusters.parquet` (direct HDBSCAN membership
per bill), `bridge_bill_concepts.parquet`, and one-row-per-bill
`bill_concepts.parquet`. Cluster membership probabilities are HDBSCAN strengths,
not concept scores. Expensive calls are content-keyed, so re-running a stage
reuses prior Parquet rows; changing clustering parameters never re-embeds.

`dim_bill_documents.parquet` is produced by
[`scrape_passed_bills.ipynb`](notebooks/scrape_passed_bills.ipynb), which already
holds every bill-detail payload in its request-cache. Rerunning its build/report
cells with `CACHE_ONLY = True` regenerates it with no new network calls.
