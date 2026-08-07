# Local LLM Setup for LLooM Workbench

Run Gemma 4 E4B and multilingual embeddings locally with Intel GPU acceleration.

## Overview

This setup runs two local models:
- **LLM**: Gemma 4 E4B Instruct (4.5B effective params, Q4_K_M quantized)
- **Embeddings**: multilingual-e5-large (560M params, 100+ languages including Hebrew)

Both models run entirely on your machine with no API calls or data leaving your system.

## Requirements

### Hardware
- **RAM**: 8GB minimum, 16GB recommended
- **GPU**: Intel integrated graphics (Iris Xe, UHD Graphics) or Intel Arcmultilingual-e5-large
- **Storage**: ~5GB for models

### Operating System
- Linux (any distribution)
- Tested on Arch Linux and Ubuntu 22.04+

## Dependencies

Install these before running the setup script.

### Arch Linux
```bash
sudo pacman -S git cmake make wget python-pip
```

### Ubuntu/Debian
```bash
sudo apt install git cmake make wget python3-pip build-essential
```

### Intel oneAPI Base Toolkit

Required for Intel GPU acceleration. Install from Intel's website:

**Download**: https://www.intel.com/content/www/us/en/developer/tools/oneapi/base-toolkit-download.html


## Quick Start

```bash
# 1. Download models (~4GB)
./scripts/download_models.sh

# 2. Start servers
./scripts/start_servers.sh
```

## Usage

### With LLooM Workbench

```python
import text_lloom.workbench as wb
import os

# Point to local servers
os.environ["OPENAI_API_KEY"] = "sk-local-llm-key"
os.environ["OPENAI_BASE_URL"] = "http://localhost:8080/v1"

# Create LLooM instance with local models
l = wb.lloom(
    df=df,
    text_col="text",
    distill_model_name="gemma-4-e4b",  # Will use local endpoint
    embed_model_name="http://localhost:8081/v1",  # Embedding server
    synth_model_name="gemma-4-e4b",
    score_model_name="gemma-4-e4b",
)

# Run concept induction
await l.gen()
```

### Direct API Testing

```bash
# Test LLM chat
curl http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gemma-4-e4b",
    "messages": [{"role": "user", "content": "שלום, מה שלומך?"}]
  }'

# Test embeddings
curl http://localhost:8081/v1/embeddings \
  -H "Content-Type: application/json" \
  -d '{
    "model": "multilingual-e5-large",
    "input": "טקסט בעברית"
  }'
```

### Python Example

```python
from openai import OpenAI

# LLM client
llm = OpenAI(
    base_url="http://localhost:8080/v1",
    api_key="sk-local-llm-key"
)

response = llm.chat.completions.create(
    model="gemma-4-e4b",
    messages=[{"role": "user", "content": "אנא תן סיכום קצר על הצעת חוק זו"}]
)
print(response.choices[0].message.content)

# Embedding client
embed = OpenAI(
    base_url="http://localhost:8081/v1",
    api_key="sk-local-llm-key"
)

embedding = embed.embeddings.create(
    model="multilingual-e5-large",
    input="טקסט בעברית להטמעה"
)
print(len(embedding.data[0].embedding))  # 1024 dimensions
```

## Configuration

All paths are relative to the project directory. No environment variables needed.

To change server ports, edit `scripts/start_servers.sh`:
```bash
LLM_PORT=8080
EMBEDDING_PORT=8081
```

### Model Options

**Alternative LLM models** (place in `models/` directory):

- **DictaLM 3.0 1.7B**: Better Hebrew performance, smaller size
  - Download: `huggingface-cli download dicta-il/DictaLM-3.0-1.7B-Instruct`
  - Note: Requires conversion to GGUF

- **Qwen 2.5 3B**: Good multilingual, very small
  - GGUF: `Qwen/Qwen2.5-3B-Instruct-GGUF`

**Alternative embedding models**:

- **NeoDictaBERT-bilingual**: Hebrew-specialized
  - `dicta-il/neodictabert-bilingual-embed`

- **Qwen3-Embedding-0.6B**: Latest multilingual, very small
  - `Qwen/Qwen3-Embedding-0.6B-GGUF`

## Performance

### Expected Speed (Intel iGPU)

- **Gemma 4 E4B**: ~8-15 tokens/sec
- **Embeddings**: ~50-100 docs/sec

### Memory Usage

- **LLM server**: ~3.5GB VRAM + 2GB RAM
- **Embedding server**: ~500MB VRAM + 1GB RAM
- **Total**: ~6-8GB combined

## Troubleshooting

### Server won't start

1. Check oneAPI is loaded:
   ```bash
   source ~/intel/oneapi/setvars.sh
   ```

2. Verify GPU detection:
   ```bash
   sycl-ls
   ```

3. Check logs:
   ```bash
   tail -f logs/llm.log
   tail -f logs/embedding.log
   ```

### Out of memory

Reduce context size in `start_servers.sh`:
```bash
--ctx-size 4096  # instead of 8192
```

Or reduce GPU layers:
```bash
--n-gpu-layers 20  # instead of 35
```

### Slow performance

1. Ensure GPU acceleration is active (check logs for "SYCL")
2. Try different batch sizes in `start_servers.sh`
3. Close other GPU-intensive applications

### CPU-only fallback

If GPU doesn't work, run in CPU mode:
```bash
# Remove --n-gpu-layers flag or set to 0
--n-gpu-layers 0
```

## Architecture Notes

### Why These Models?

**Gemma 4 E4B**:
- 140+ languages including Hebrew
- Optimized for on-device deployment
- Good reasoning capabilities
- Apache 2.0 license

**multilingual-e5-large**:
- Proven Hebrew performance (3rd place in Hebrew Semantic Retrieval Challenge)
- 100+ languages
- 1024-dimensional embeddings
- Excellent multilingual retrieval

### LLooM Integration

LLooM uses LLMs for:
1. **Distill**: Filter and summarize documents (Hebrew comprehension important)
2. **Synthesize**: Generate concepts from clusters (reasoning important)
3. **Score**: Match documents to concepts (classification)

The embedding model is used for clustering similar documents. Hebrew performance is critical here.

## Compared to GPT-4o

### Advantages
- ✅ No API costs
- ✅ Full data privacy (critical for legal/political texts)
- ✅ No rate limits
- ✅ Faster iteration (no network latency)
- ✅ Works offline

### Trade-offs
- ⚠️ ~10-15% lower reasoning quality on complex tasks
- ⚠️ May need more prompt engineering
- ⚠️ Limited context window (8K vs 128K)
- ⚠️ No built-in moderation

### Performance Gap

Research shows:
- Small models are within 2-15% of GPT-4 on classification tasks
- Specialized Hebrew models (DictaLM) may match GPT-4 on Hebrew tasks
- Fine-tuning can close the gap significantly

For LLooM concept induction, expect:
- Similar clustering quality (depends on embeddings)
- Slightly less nuanced concepts
- May need to guide with better seeds

## Resources

- [llama.cpp Documentation](https://github.com/ggml-org/llama.cpp)
- [Intel SYCL Backend Guide](https://github.com/ggml-org/llama.cpp/blob/master/docs/backend/SYCL.md)
- [Gemma 4 Model Card](https://huggingface.co/google/gemma-4-e4b-it)
- [multilingual-e5-large](https://huggingface.co/intfloat/multilingual-e5-large)
- [LLooM Workbench](https://stanfordhci.github.io/lloom/)
- [Intel oneAPI](https://www.intel.com/content/www/us/en/developer/tools/oneapi/overview.html)

## License

- **Gemma 4**: Apache 2.0
- **multilingual-e5-large**: MIT
- **llama.cpp**: MIT

Scripts in this repository are provided as-is for educational purposes.
