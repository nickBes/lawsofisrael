"""
lloom.py
--------
Common LLooM model/session construction shared by the v1 and v2 notebooks.

This centralizes:

- Building the chat :class:`OpenAIModel` against the OpenAI-compatible API from
  ``config.py`` (Gemini 2.5 Flash by default).
- The **non-OpenAI tokenization compatibility** shims LLooM needs: its default
  token helpers call ``tiktoken.encoding_for_model(model.name)``, which raises
  ``KeyError`` for names like ``gemini-2.5-flash``. Both ``count_tokens_fn`` and
  ``truncate_fn`` are rerouted through a generic ``cl100k_base`` encoding.
- Building the local bge-m3 :class:`OpenAIEmbedModel` (llama.cpp server), whose
  token counter uses the server's ``/tokenize`` endpoint.
- Assembling the LLooM session via ``workbench.lloom``.

Only session *construction* lives here; prompt selection and generation
parameters are supplied by each notebook. Both notebooks pass the same chat
model as ``synth_model`` and ``score_model``; in v2 the score-model slot is left
wired for construction only and never exercised (v2 does not call ``score``),
so it incurs no score-stage API cost.

Nothing here performs network calls at import time, so it is import-safe for
tests; the actual clients are created lazily inside ``setup_fn`` callbacks when
a session is built.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any, Callable, Optional

import requests


@lru_cache(maxsize=1)
def _chat_encoding():
    import tiktoken

    return tiktoken.get_encoding("cl100k_base")


def chat_count_tokens(text: str) -> int:
    """Approximate chat-model token count (cl100k_base)."""
    return len(_chat_encoding().encode(text))


def make_embedding_tokenizer(embed_url: str, api_key: str, timeout: int = 30) -> Callable[[str], list]:
    """Return a function that tokenizes text via the llama.cpp /tokenize endpoint.

    Used as the embedding model's token counter so budgeting matches the local
    bge-m3 server rather than the chat tokenizer.
    """
    def tokenize(text: str) -> list:
        headers = {"Authorization": f"Bearer {api_key}"}
        r = requests.post(
            f"{embed_url}/tokenize", json={"content": text}, headers=headers, timeout=timeout
        )
        r.raise_for_status()
        return r.json()["tokens"]

    return tokenize


def build_chat_model(
    *,
    model_config: dict,
    base_url: str,
    api_key: str,
    max_output_tokens: int,
    cost: tuple[float, float] = (0.0000003, 0.0000025),
):
    """Build a LLooM chat :class:`OpenAIModel` with non-OpenAI tokenizer shims.

    ``model_config`` should be the ``MODEL_CONFIG`` bundle from ``config.py``
    (providing ``name``, ``context_window`` and ``rate_limit``). ``cost`` is the
    (input, output) per-token price used for LLooM's cost estimates; the default
    matches the v1 notebook's Gemini pricing.
    """
    from openai import AsyncOpenAI
    from text_lloom.llm import OpenAIModel

    os.environ["OPENAI_BASE_URL"] = base_url

    def chat_setup(key):
        # max_retries lets the client retry 429/5xx with backoff on top of
        # text_lloom's own batch-level rate limiting.
        return AsyncOpenAI(base_url=base_url, api_key=key, max_retries=5, timeout=120.0)

    chat_model = OpenAIModel(
        model_config["name"], api_key, setup_fn=chat_setup,
        context_window=model_config["context_window"],
        rate_limit=model_config["rate_limit"],
        cost=cost,
    )

    # Reroute both token helpers away from tiktoken.encoding_for_model(model.name),
    # which raises KeyError for non-OpenAI model names.
    chat_model.count_tokens_fn = lambda _model, text: chat_count_tokens(text)

    def truncate_chat(model, text, out_token_alloc=None):
        out_tokens = out_token_alloc if out_token_alloc else max_output_tokens
        max_tokens = model.context_window - out_tokens
        enc = _chat_encoding()
        tokens = enc.encode(text)
        if len(tokens) <= max_tokens:
            return text
        return enc.decode(tokens[:max_tokens])

    chat_model.truncate_fn = truncate_chat
    return chat_model


def build_embed_model(
    *,
    embed_url: str,
    embed_model_name: str,
    api_key: str,
    batch_size: int = 64,
):
    """Build the local bge-m3 :class:`OpenAIEmbedModel` (llama.cpp server)."""
    from openai import OpenAI
    from text_lloom.llm import OpenAIEmbedModel

    def embed_setup(key):
        return OpenAI(base_url=f"{embed_url}/v1", api_key=key, timeout=60.0)

    embed_model = OpenAIEmbedModel(
        embed_model_name, api_key=api_key, setup_fn=embed_setup,
        batch_size=batch_size, cost=(0, 0),
    )
    tokenize = make_embedding_tokenizer(embed_url, api_key)
    embed_model.count_tokens_fn = lambda _model, text: len(tokenize(text))
    return embed_model


def build_gemini_embed_model(
    *,
    base_url: str,
    api_key: str,
    model_name: str = "gemini-embedding-2-preview",
    dimensions: Optional[int] = None,
    batch_size: int = 64,
    cost: tuple[float, float] = (0.0, 0.0),
):
    """Build an :class:`OpenAIEmbedModel` for a Gemini embedding model.

    Uses the same OpenAI-compatible provider (``base_url``/``api_key``) as the
    chat model. Unlike the local bge-m3 model this sends bullet text to the
    third-party API, so it is opt-in for the v2.1 diagnostics.

    Two shims are needed for a non-OpenAI model name:

    - a custom embedding ``fn`` that (optionally) passes a Matryoshka
      ``dimensions`` argument and never calls ``encoding_for_model`` on the
      Gemini name;
    - a ``count_tokens_fn`` routed through a generic ``cl100k_base`` encoding
      (token counts here are only used for cost/telemetry, which is zero-cost by
      default).
    """
    from openai import OpenAI
    from text_lloom.llm import OpenAIEmbedModel

    def embed_setup(key):
        return OpenAI(base_url=base_url, api_key=key, timeout=120.0, max_retries=5)

    def embed_fn(model, texts_arr):
        # texts_arr may be a single string or a list/array of strings.
        inputs = list(texts_arr) if not isinstance(texts_arr, str) else [texts_arr]
        kwargs = {"input": inputs, "model": model.name}
        if dimensions is not None:
            kwargs["dimensions"] = dimensions
        resp = model.client.embeddings.create(**kwargs)
        embeddings = [r.embedding for r in resp.data]
        # Rough token estimate for telemetry only.
        tokens = sum(chat_count_tokens(t) for t in inputs)
        return embeddings, tokens

    embed_model = OpenAIEmbedModel(
        model_name, api_key=api_key, setup_fn=embed_setup, fn=embed_fn,
        batch_size=batch_size, cost=cost,
    )
    embed_model.count_tokens_fn = lambda _model, text: chat_count_tokens(text)
    return embed_model


def make_lloom_session(
    df,
    *,
    model_config: dict,
    chat_base_url: str,
    chat_api_key: str,
    max_output_tokens: int,
    embed_url: str,
    embed_model_name: str,
    embed_api_key: str,
    text_col: str = "text",
    id_col: str = "chunk_id",
    chat_cost: tuple[float, float] = (0.0000003, 0.0000025),
):
    """Construct a LLooM session over ``df[[id_col, text_col]]``.

    The chat model is used for distill/synthesize (and wired as the score model
    for construction only), and the local bge-m3 model for clustering. This is
    the single session builder for both notebooks; prompt customization and
    generation parameters are supplied at ``session.gen`` time by the caller.
    """
    from text_lloom.workbench import lloom

    chat_model = build_chat_model(
        model_config=model_config,
        base_url=chat_base_url,
        api_key=chat_api_key,
        max_output_tokens=max_output_tokens,
        cost=chat_cost,
    )
    embed_model = build_embed_model(
        embed_url=embed_url,
        embed_model_name=embed_model_name,
        api_key=embed_api_key,
    )

    return lloom(
        df[[id_col, text_col]], text_col=text_col, id_col=id_col,
        distill_model=chat_model, cluster_model=embed_model,
        synth_model=chat_model, score_model=chat_model,
    )
