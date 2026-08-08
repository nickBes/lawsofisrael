#!/bin/bash
# Start local llama.cpp embedding server (bge-m3) for LLooM Workbench.
#
# The LLM itself now runs via an OpenAI-compatible API (see config.py), so this
# script only starts the embedding server. Embeddings stay local because they
# run fine on CPU and keeping document text out of a third-party API call
# reduces cost and data exposure.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Source Intel oneAPI for SYCL support (if available)
if [ -f "/opt/intel/oneapi/setvars.sh" ]; then
    source "/opt/intel/oneapi/setvars.sh" 2>/dev/null
fi

# Use system-installed llama-server, or fall back to local build
if command -v llama-server &> /dev/null; then
    LLAMA_SERVER="llama-server"
else
    LLAMA_SERVER="$PROJECT_ROOT/llama.cpp/build/bin/llama-server"
fi

EMBEDDING_MODEL="$PROJECT_ROOT/models/bge-m3-q4_k.gguf"
EMBEDDING_PORT="${EMBEDDING_PORT:-8081}"
API_KEY="${EMBEDDING_API_KEY:-sk-local-embedding-key}"

# Download model if missing
if [ ! -f "$EMBEDDING_MODEL" ]; then
    echo "Downloading bge-m3-q4_k.gguf from Hugging Face..."
    mkdir -p "$PROJECT_ROOT/models"
    huggingface-cli download christianabela/bge-m3-Q4_K_M-GGUF \
        bge-m3-q4_k.gguf \
        --local-dir "$PROJECT_ROOT/models" \
        --local-dir-use-symlinks False
fi

# Checks
[ ! -x "$(command -v $LLAMA_SERVER 2>/dev/null)" ] && [ ! -f "$LLAMA_SERVER" ] && echo "Error: llama-server not found. Install llama.cpp first." && exit 1

# Stop any existing embedding server on this port
pkill -f "llama-server.*--port $EMBEDDING_PORT" 2>/dev/null || true
sleep 1

mkdir -p "$PROJECT_ROOT/logs"

echo "Starting embedding server (bge-m3, CPU-only) on port $EMBEDDING_PORT..."
# Embedding models are non-causal, so the whole input must fit in ONE physical
# batch. Keep batch/ubatch >= ctx-size or inputs over that length fail with
# HTTP 500 ("input is too large to process"). CPU-only: no GPU flags needed,
# avoids the SYCL backend issues seen with the old combined LLM+embedding setup.
$LLAMA_SERVER \
    --model "$EMBEDDING_MODEL" \
    --port "$EMBEDDING_PORT" \
    --host 127.0.0.1 \
    --api-key "$API_KEY" \
    --ctx-size 2048 \
    --batch-size 2048 \
    --ubatch-size 2048 \
    --threads "$(nproc)" \
    --embedding \
    --pooling mean \
    > "$PROJECT_ROOT/logs/embedding.log" 2>&1 &

EMBED_PID=$!
sleep 2

if ! kill -0 $EMBED_PID 2>/dev/null; then
    echo "Error: Embedding server failed to start. Check logs/embedding.log"
    exit 1
fi

echo ""
echo "✓ Embedding server running!"
echo ""
echo "Embeddings: http://localhost:$EMBEDDING_PORT/v1/embeddings"
echo "API Key:    $API_KEY"
echo ""
echo "To stop: pkill -f 'llama-server.*--port $EMBEDDING_PORT'"
