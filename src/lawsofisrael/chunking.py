"""
chunking.py
-----------
Provenance-preserving legal chunking shared by the v1 baseline notebook and the
v2 notebook.

The deterministic packing behavior is preserved from the v1 notebook:

- Each bill is flattened into legal *units* by splitting block text on
  :data:`LEGAL_BREAK` (Israeli section markers such as ``סעיף N``, numbered
  ``N.``/``N)`` items, and single Hebrew-letter list markers).
- Units are packed greedily up to a token budget (:func:`split_chunks`),
  measuring each candidate chunk *after* joining with :data:`SEP` so separator
  and tokenizer drift are counted.
- Oversized single units are hard-split (:func:`hard_split` / :func:`cut_prefix`)
  using character bisection, which always makes progress even when the
  tokenizer is not an exact round-trip for Hebrew.
- Chunk IDs are stable ``{bill_id}:{ordinal:04d}`` strings.

What v2 adds without changing v1's observable chunk text/IDs
============================================================
Every chunk carries an ordered ``source_spans`` list describing each unit that
contributed to it, so a chunk that crosses heading or page boundaries links
back to *all* of its evidence rather than only the first heading/page. Each
span is a dict:

- ``block_id``: the source block's stable id (may be ``None`` for legacy input)
- ``heading_path``: heading hierarchy string for that unit
- ``page_no``: source page number for that unit
- ``text``: the unit (or hard-split piece) text

Legacy first-span fields (``heading_path`` and ``page_no`` of the chunk's first
contributing unit) are still exposed on each chunk so v1 stays compatible.

Token counting is injectable so tests and the v1 notebook can supply the exact
tokenizer they use. The default is tiktoken ``cl100k_base``, matching the v1
notebook's ``CHAT_ENCODING`` used for chunk budgeting.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any, Callable, Iterable, Optional

# Section/paragraph break used to split a block into legal units. Matches the
# start of a line that begins with a section marker (סעיף N), a numbered item
# (N. / N.N) / N)), or a single Hebrew-letter list marker (א. / א)).
LEGAL_BREAK = re.compile(r"(?=^\s*(?:סעיף\s+\d+|\d+(?:\.\d+)*[.)]|[א-ת][.)]))", re.M)

# Separator used when joining units into a packed chunk.
SEP = "\n\n"

TokenCounter = Callable[[str], int]


@lru_cache(maxsize=1)
def _default_encoding():
    import tiktoken

    return tiktoken.get_encoding("cl100k_base")


def default_n_tokens(text: str) -> int:
    """Token count using tiktoken cl100k_base (v1's chat budgeting tokenizer)."""
    return len(_default_encoding().encode(text))


# ---------------------------------------------------------------------------
# Source spans + chunk container
# ---------------------------------------------------------------------------
@dataclass
class SourceSpan:
    """One legal unit (or hard-split piece) that contributed to a chunk."""

    text: str
    heading_path: str = ""
    page_no: Optional[int] = None
    block_id: Optional[str] = None

    def to_dict(self) -> dict:
        return {
            "block_id": self.block_id,
            "heading_path": self.heading_path,
            "page_no": self.page_no,
            "text": self.text,
        }


@dataclass
class _Unit:
    """Internal: a legal unit with its provenance, before packing."""

    text: str
    heading_path: str = ""
    page_no: Optional[int] = None
    block_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Token-budget splitting (ported from v1, tokenizer injected)
# ---------------------------------------------------------------------------
def cut_prefix(text: str, limit: int, n_tokens: TokenCounter) -> tuple[str, str]:
    """Split off the largest prefix of ``text`` that fits in ``limit`` tokens.

    Bisects on characters (not tokens) because ``decode(encode(x))`` is not a
    guaranteed round-trip for Hebrew under an approximate tokenizer; character
    bisection always makes progress, so this terminates. Prefers a whitespace
    boundary when one is reasonably close to the cut.
    """
    if n_tokens(text.strip()) <= limit:
        return text, ""
    lo, hi, best = 1, len(text), 1
    while lo <= hi:
        mid = (lo + hi) // 2
        # Measure the STRIPPED prefix: callers store head.strip(), and a
        # tokenizer dropping a leading space can turn one token into several,
        # so measuring unstripped text undercounts.
        if n_tokens(text[:mid].strip()) <= limit:
            best, lo = mid, mid + 1
        else:
            hi = mid - 1
    head, tail = text[:best], text[best:]
    if tail and not tail[:1].isspace():
        idx = head.rfind(" ")
        if idx > len(head) * 0.5:
            head, tail = head[:idx], head[idx:] + tail
    return head, tail


def hard_split(text: str, limit: int, n_tokens: TokenCounter) -> list[str]:
    """Break a single oversized unit into pieces of at most ``limit`` tokens."""
    pieces, rest = [], text
    while rest.strip():
        head, rest = cut_prefix(rest, limit, n_tokens)
        if not head.strip():
            break
        pieces.append(head.strip())
    return pieces


# ---------------------------------------------------------------------------
# Flattening a bill record into legal units
# ---------------------------------------------------------------------------
def iter_units(record: dict) -> list[_Unit]:
    """Flatten a successful extraction record into ordered legal units.

    Mirrors the v1 notebook: heading blocks update the current heading path /
    page and are not emitted as units; each non-heading block's text is split
    on :data:`LEGAL_BREAK` into units that inherit the current heading path and
    page. Each unit also records its originating ``block_id`` for provenance.
    """
    units: list[_Unit] = []
    current_path, current_page = "", None
    for block in record["blocks"]:
        if block["kind"] == "heading":
            current_path = " > ".join(block.get("heading_path", []))
            current_page = block.get("page_no")
            continue
        current_page = current_page or block.get("page_no")
        block_id = block.get("block_id")
        for piece in (u.strip() for u in LEGAL_BREAK.split(block["text"]) if u.strip()):
            units.append(_Unit(
                text=piece,
                heading_path=current_path,
                page_no=current_page,
                block_id=block_id,
            ))
    return units


# ---------------------------------------------------------------------------
# Packing units into chunks with provenance
# ---------------------------------------------------------------------------
def _pack(units: list[_Unit], chunk_tokens: int, n_tokens: TokenCounter) -> list[list[SourceSpan]]:
    """Pack units into chunks; return each chunk as an ordered list of spans.

    Reproduces v1's :func:`split_chunks` packing (greedy up to ``chunk_tokens``,
    measured after joining with SEP), but tracks the contributing span for each
    piece so provenance is preserved. Oversized units are hard-split, and each
    resulting piece becomes its own span pointing back at the same source unit.
    """
    chunks: list[list[SourceSpan]] = []
    buf_spans: list[SourceSpan] = []

    def buf_text() -> str:
        return SEP.join(s.text for s in buf_spans).strip()

    for unit in units:
        pieces = (
            [unit.text]
            if n_tokens(unit.text) <= chunk_tokens
            else hard_split(unit.text, chunk_tokens, n_tokens)
        )
        for piece in pieces:
            span = SourceSpan(
                text=piece,
                heading_path=unit.heading_path,
                page_no=unit.page_no,
                block_id=unit.block_id,
            )
            if buf_spans and n_tokens(SEP.join([buf_text(), piece]).strip()) > chunk_tokens:
                chunks.append(buf_spans)
                buf_spans = [span]
            else:
                buf_spans.append(span)
    if buf_spans:
        chunks.append(buf_spans)

    # Drop any chunk that is empty after stripping (parity with v1's filter).
    return [spans for spans in chunks if SEP.join(s.text for s in spans).strip()]


@dataclass
class Chunk:
    """A packed chunk with legacy metadata and full provenance."""

    bill_id: Any
    name: str
    chunk_id: str
    text: str
    tokens: int
    # Legacy first-span metadata (v1 compatibility).
    heading_path: str
    page_no: Optional[int]
    # Full ordered provenance.
    source_spans: list[SourceSpan] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "bill_id": self.bill_id,
            "name": self.name,
            "chunk_id": self.chunk_id,
            "heading_path": self.heading_path,
            "page_no": self.page_no,
            "text": self.text,
            "tokens": self.tokens,
            "source_spans": [s.to_dict() for s in self.source_spans],
        }


def chunk_bill(
    record: dict,
    chunk_tokens: int,
    n_tokens: TokenCounter = default_n_tokens,
) -> list[Chunk]:
    """Chunk a single successful extraction record into :class:`Chunk` objects.

    Chunk text and ordering match v1; each chunk additionally carries an ordered
    ``source_spans`` list and derives its legacy ``heading_path``/``page_no``
    from the first contributing span. Chunk IDs are ``{bill_id}:{ordinal:04d}``.
    Returns ``[]`` for non-success records.
    """
    if record.get("status") != "success":
        return []
    units = iter_units(record)
    packed = _pack(units, chunk_tokens, n_tokens)

    bill_id = record["bill_id"]
    name = record.get("name", "")
    chunks: list[Chunk] = []
    for ordinal, spans in enumerate(packed):
        text = SEP.join(s.text for s in spans).strip()
        first = spans[0]
        chunks.append(Chunk(
            bill_id=bill_id,
            name=name,
            chunk_id=f"{bill_id}:{ordinal:04d}",
            text=text,
            tokens=n_tokens(text),
            heading_path=first.heading_path,
            page_no=first.page_no,
            source_spans=spans,
        ))
    return chunks


def chunk_records(
    records: Iterable[dict],
    chunk_tokens: int,
    n_tokens: TokenCounter = default_n_tokens,
) -> list[Chunk]:
    """Chunk many records, skipping failed ones. Preserves record order."""
    out: list[Chunk] = []
    for record in records:
        out.extend(chunk_bill(record, chunk_tokens, n_tokens))
    return out


def chunks_to_records(chunks: Iterable[Chunk]) -> list[dict]:
    """Convert :class:`Chunk` objects to plain dicts (e.g. for a DataFrame)."""
    return [c.to_dict() for c in chunks]


def compute_chunk_budget(max_context_tokens: int, max_output_tokens: int,
                        prompt_overhead: int = 2000) -> int:
    """Token budget per chunk, reserving prompt overhead + output headroom.

    Matches v1: ``CHUNK_TOKENS = MAX_CONTEXT_TOKENS - MAX_OUTPUT_TOKENS - PROMPT_OVERHEAD``.
    """
    return max_context_tokens - max_output_tokens - prompt_overhead
