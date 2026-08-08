"""
config.py
---------
Central configuration for the LLooM pipeline: an OpenAI-compatible chat/LLM
API (e.g. Gemini 2.5 Flash) plus a locally-hosted embedding model (bge-m3).

Everything is driven by environment variables (loaded from a `.env` file if
present, see `.env.example`).

Usage:
    from config import MODEL_CONFIG, EMBEDDING_URL, EMBEDDING_MODEL
    print(MODEL_CONFIG["context_window"])
"""

import os

from dotenv import load_dotenv

load_dotenv()

# ACTIVE PROVIDER / MODEL ================================
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai/")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gemini-2.5-flash")

# Token budgets for chunking and output limits
MAX_CONTEXT_TOKENS = int(os.getenv("MAX_CONTEXT_TOKENS", "1048576"))
MAX_OUTPUT_TOKENS = int(os.getenv("MAX_OUTPUT_TOKENS", "8192"))

# Rate limiting: (n_requests, wait_time_secs) - batch n_requests then wait
RATE_LIMIT_RPM = int(os.getenv("RATE_LIMIT_RPM", "15"))
RATE_LIMIT = (RATE_LIMIT_RPM, 60)

# Convenience bundle for text_lloom OpenAIModel
MODEL_CONFIG = {
    "name": OPENAI_MODEL,
    "api_key": OPENAI_API_KEY,
    "base_url": OPENAI_BASE_URL,
    "context_window": MAX_CONTEXT_TOKENS,
    "max_output_tokens": MAX_OUTPUT_TOKENS,
    "rate_limit": RATE_LIMIT,
}

# LOCAL EMBEDDING SERVER ================================
# Served locally via scripts/start_embedding_server.sh (llama.cpp + bge-m3).
# Runs on CPU; no GPU/driver issues, and keeps document text out of any
# third-party API call.
EMBEDDING_HOST = os.getenv("EMBEDDING_HOST", "http://localhost")
EMBEDDING_PORT = int(os.getenv("EMBEDDING_PORT", "8081"))
EMBEDDING_URL = os.getenv("EMBEDDING_URL", f"{EMBEDDING_HOST}:{EMBEDDING_PORT}")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "bge-m3")
EMBEDDING_API_KEY = os.getenv("EMBEDDING_API_KEY", "sk-local-embedding-key")


def describe() -> str:
    """Human-readable summary of the active configuration (no secrets)."""
    key_state = "set" if OPENAI_API_KEY else "MISSING"
    return (
        f"LLM model:      {OPENAI_MODEL}\n"
        f"LLM base_url:   {OPENAI_BASE_URL}\n"
        f"LLM api_key:    {key_state}\n"
        f"Rate limit:     {RATE_LIMIT_RPM} requests/min\n"
        f"Context window: {MAX_CONTEXT_TOKENS:,} tokens "
        f"(max output {MAX_OUTPUT_TOKENS:,})\n"
        f"Embedding url:  {EMBEDDING_URL} ({EMBEDDING_MODEL})"
    )


if __name__ == "__main__":
    print(describe())
