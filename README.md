# lawsofisrael
Analysis of israeli laws based on https://main.knesset.gov.il/apps/legislation/main/bills

## Notebooks

1. [explore_data.ipynb](notebooks/explore_data.ipynb) — Initial data exploration and understanding
2. [scrape_passed_bills.ipynb](notebooks/scrape_passed_bills.ipynb) — Scraping bill data from the Knesset website
3. [create_passed_bills_dataset.ipynb](notebooks/create_passed_bills_dataset.ipynb) — Building the cleaned dataset
4. [lloom_experiment.ipynb](notebooks/lloom_experiment.ipynb) — TODO: LLM experiments

## Local LLM Setup

Run LLooM Workbench with local Hebrew-capable models (Gemma 4 E4B + multilingual embeddings).

**See**: [docs/LOCAL_LLM_SETUP.md](docs/LOCAL_LLM_SETUP.md)

### Quick Start

```bash
# 0. Install llama.cpp with Intel GPU support first
#    See: docs/LOCAL_LLM_SETUP.md for detailed instructions

# 1. Download models (~4GB)
./scripts/download_models.sh

# 2. Start servers
./scripts/start_servers.sh
```

### Features

- ✅ Runs entirely on your machine (no API calls, full privacy)
- ✅ Intel GPU acceleration (Iris Xe, UHD Graphics, Arc)
- ✅ Hebrew text support (140+ languages)
- ✅ No API costs or rate limits
- ✅ Works offline

## Dataset Notes

### Initiators Field

The `initiators` field is **only populated for private bills** (הצעות חוק פרטיות). Government bills (הצעות חוק ממשלתיות) do not have individual initiators because they are proposed by the government itself.

- **Private bills** (`proposal_type == "פרטית"`): Contain Knesset member names in the `initiators` field (comma-separated string)
- **Government bills** (`proposal_type == "ממשלתית"`): Have an empty `initiators` field — the "initiator" is effectively the government/ministry

This is expected behavior from the Knesset API, not missing data.

**Note:** Private bill initiators are always Knesset members. Third parties (citizens, organizations, lobbyists) cannot be listed as initiators, though they may draft bills that Knesset members formally propose.
