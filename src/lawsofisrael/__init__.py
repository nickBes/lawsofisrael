"""
lawsofisrael
------------
Shared, importable experiment-preparation package for the Israeli passed-laws
LLooM pipeline. It holds the single implementation of the deterministic
preparation steps that both the v1 baseline notebook and the v2 notebook
consume:

- ``extraction``: PDF extraction via Docling, selective Hebrew OCR fallback for
  low-text pages, a versioned extraction-record schema, cache I/O, and
  validation of cached records before reuse.
- ``chunking``: legal-unit splitting, token budgeting, hard splitting of
  oversized units, stable ``bill_id:ordinal`` chunk IDs, and
  provenance-preserving chunks that carry an ordered list of their contributing
  source spans (while still exposing legacy first-span heading/page fields for
  v1 compatibility).
- ``lloom``: common LLooM model/session construction, including the
  compatibility handling required for non-OpenAI model tokenization.

Provider configuration continues to live in the repository-level ``config.py``;
this package reads token budgets from it where needed but does not duplicate
credentials.
"""

from . import chunking, extraction, prompts_v2, v2_export

__all__ = ["extraction", "chunking", "lloom", "prompts_v2", "v2_export"]

# Bump when the on-disk extraction-record shape changes in an incompatible way.
EXTRACTION_SCHEMA_VERSION = 1
