# Full-bill LLooM concept pipeline

Runs LLooM concept discovery over the 8,317 vote-linked bills and checkpoints
every stage to Parquet. It performs quote filtering, condition-faithful
summarization, Gemini embedding, seeded UMAP/HDBSCAN clustering, and semantic
concept synthesis/review. It deliberately has **no KNN stage** and **never calls
LLooM scoring**: the clusters are the result and the concept labels are semantic
descriptions of them.

It is driven from a notebook, not a CLI. The **actual pipeline flow is in the
notebook cells** of [`notebooks/concept_pipeline.ipynb`](../notebooks/concept_pipeline.ipynb)
(mirroring `lloom_experiment_v2.ipynb`): the LLooM `distill_filter` /
`distill_summarize` / `synthesize` / `review` calls, the Gemini embedding loop,
and the seeded UMAP/HDBSCAN clustering are all visible there. The module
[`lawsofisrael.concepts`](../src/lawsofisrael/concepts.py) (`cp`) holds only
mechanical plumbing: parquet checkpoints, the document-selection policy, the
extraction/chunking wrappers, and the bill-level aggregation.

## Data flow

```text
dim_bills + dim_bill_documents
  cp.select_documents                 -> document_selection       (module: policy)
  cp.download_documents                -> document_manifest         (module: SHA-256 document store)
  cp.extract_documents / build_chunks  -> extraction_documents, extraction_blocks, chunks
  notebook: distill_filter + distill_summarize -> bullets    (LLooM, in cells)
  notebook: embed_model.fn loop                -> embedding_inputs, embeddings (Gemini, in cells)
  notebook: diag.run_clustering per candidate  -> cluster_assignments, cluster_summaries (in cells)
  notebook: synthesize + review                -> concepts   (LLooM, in cells)
  cp.build_analysis              -> dim_clusters, dim_concepts,
                                    bridge_bill_clusters, bridge_bill_concepts,
                                    bill_concepts
  cp.quality_report              -> quality_report
```

Every stage reads prior Parquet and writes new Parquet, so you can stop and
resume. The paid cells (distill, embed, synthesize) skip rows already present in
their checkpoint, keyed by content, and changing clustering parameters re-reads
saved embeddings instead of re-calling Gemini.

## Checkpoint layout

All artifacts for one run live under a single flat directory, e.g.:

```text
dataset/bill_concepts/runs/full-v2/
  document_selection.parquet
  document_manifest.parquet
  extraction_documents.parquet
  extraction_blocks.parquet
  chunks.parquet
  bullets.parquet
  embedding_inputs.parquet
  embeddings.parquet
  cluster_assignments.parquet
  cluster_summaries.parquet
  concepts.parquet
  dim_clusters.parquet
  dim_concepts.parquet
  bridge_bill_clusters.parquet
  bridge_bill_concepts.parquet
  bill_concepts.parquet
  quality_report.parquet
```

Selected PDF, DOCX, and DOC binaries are stored only under
`dataset/bill_concepts/raw/documents/sha256/` (git-ignored). The manifest keeps
the official URL, detected format, content SHA-256, byte count, and status; no
binary document bytes are written to Parquet. DOC and RTF extraction require
Docling's LibreOffice-backed legacy Office support.

## Final tables

- `bridge_bill_clusters` — direct HDBSCAN membership aggregated to one row per
  (bill, cluster). This is the authoritative result.
- `bridge_bill_concepts` — one row per (bill, concept); concepts are inherited
  from the bill's clusters. `relation_type` is `representative` when LLooM chose
  a bullet from that bill as synthesis evidence, else `cluster_member`.
- `bill_concepts` — one row per source bill, with nested `clusters_json` /
  `concepts_json` for convenient one-file analysis.
- `dim_clusters` / `dim_concepts` — cluster and concept catalogs.

Probability columns are HDBSCAN membership strengths, **not** concept scores.

## Resumability and cost

Every paid call (filter, summary, embedding, synthesis) is content-keyed:
re-running a stage skips request keys that already succeeded. The notebook writes
each batch immediately, so an interrupted paid stage keeps its progress. Inspect
the written Parquet checkpoints to judge progress rather than relying on streamed
process output.

## Bill documents (input)

`dim_bill_documents.parquet` is produced by the vote-scrape notebook
([`scrape_passed_bills.ipynb`](../notebooks/scrape_passed_bills.ipynb)), which
already holds every `GetLegislationBillItem` payload in its request-cache. A
small `normalize_bill_documents` helper is defined inline in that notebook (next
to the other `dim_*`/`bridge_*` builders) and called in the transform cell:

```python
dim_bill_documents = normalize_bill_documents(bill_details)
```

So the document table is regenerated with **no new network calls** by rerunning
the scrape notebook's build/report cells against the existing cache
(`CACHE_ONLY = True`). The normalizer intentionally flattens only `sessionAndDocs.LegalDocuments` and
`sessionAndDocs.DraftLaws`; background, government, committee, and follow-up
collections are not candidates. It records `FileText`, `FilePath`, and
`FileDate`, while retaining the full item JSON in `raw_document_json`.

Document _selection_ chooses one PDF, DOCX, DOC, or RTF legal text per bill. The
rank is: official published law, unofficial consolidated law, second/third
reading draft, first-reading draft, then preliminary draft. Format breaks ties
only (PDF, then DOCX, then DOC, then RTF), so a later draft is never displaced by an
earlier document merely because it is a PDF. Bills without an eligible document
are retained with an explicit `selection_state`.

## Query example

```sql
SELECT concept_label, count(DISTINCT bill_id) AS bills
FROM read_parquet('dataset/bill_concepts/runs/full-v2/bridge_bill_concepts.parquet')
GROUP BY concept_label
ORDER BY bills DESC;
```
