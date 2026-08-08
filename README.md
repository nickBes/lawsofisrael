# lawsofisrael
Analysis of israeli laws based on https://main.knesset.gov.il/apps/legislation/main/bills

## Notebooks

1. [explore_data.ipynb](notebooks/explore_data.ipynb) — Initial data exploration and understanding
2. [scrape_passed_bills.ipynb](notebooks/scrape_passed_bills.ipynb) — Scraping bill data from the Knesset website
3. [create_passed_bills_dataset.ipynb](notebooks/create_passed_bills_dataset.ipynb) — Building the cleaned dataset
4. [lloom_experiment.ipynb](notebooks/lloom_experiment.ipynb) — TODO: LLM experiments

## LLM & Embedding Setup

LLooM concept discovery (`notebooks/lloom_experiment.ipynb`) uses two models:

- **LLM** (distill/synthesize/score): an OpenAI-compatible API. Defaults to **Gemini 2.5 Flash**, but any OpenAI-compatible provider works.
- **Embeddings** (clustering): a **local** bge-m3 server via llama.cpp. Runs fine on CPU, keeps document text out of third-party API calls, and avoids the GPU driver issues local LLM inference used to hit.

### Quick Start

```bash
# 1. Configure the LLM API
cp .env.example .env
# Edit .env and set OPENAI_API_KEY (e.g. from https://aistudio.google.com/apikey for Gemini)

# 2. Start the local embedding server
./scripts/start_embedding_server.sh

# 3. Run notebooks/lloom_experiment.ipynb
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

## Dataset Notes

### Initiators Field

The `initiators` field is **only populated for private bills** (הצעות חוק פרטיות). Government bills (הצעות חוק ממשלתיות) do not have individual initiators because they are proposed by the government itself.

- **Private bills** (`proposal_type == "פרטית"`): Contain Knesset member names in the `initiators` field (comma-separated string)
- **Government bills** (`proposal_type == "ממשלתית"`): Have an empty `initiators` field — the "initiator" is effectively the government/ministry

This is expected behavior from the Knesset API, not missing data.

**Note:** Private bill initiators are always Knesset members. Third parties (citizens, organizations, lobbyists) cannot be listed as initiators, though they may draft bills that Knesset members formally propose.
