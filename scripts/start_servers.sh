#!/bin/bash
# Start llama.cpp servers for LLooM Workbench

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Fixed paths (no env vars needed)
# Use system-installed llama-server, or fall back to local build
if command -v llama-server &> /dev/null; then
    LLAMA_SERVER="llama-server"
else
    LLAMA_SERVER="$PROJECT_ROOT/llama.cpp/build/bin/llama-server"
fi

LLM_MODEL="$PROJECT_ROOT/models/gemma-4-E4B-it-Q4_K_M.gguf"
EMBEDDING_MODEL="$PROJECT_ROOT/models/bge-m3-q4_k.gguf"
LLM_PORT=8080
EMBEDDING_PORT=8081

# Checks
[ ! -f "$LLM_MODEL" ] && echo "Error: LLM model not found. Run download_models.sh first" && exit 1
[ ! -f "$EMBEDDING_MODEL" ] && echo "Error: Embedding model not found. Run download_models.sh first" && exit 1
[ ! -x "$(command -v $LLAMA_SERVER 2>/dev/null)" ] && [ ! -f "$LLAMA_SERVER" ] && echo "Error: llama-server not found. Install llama.cpp or run setup_llama_cpp.sh" && exit 1

# Source oneAPI if available
if [ -f "$HOME/intel/oneapi/setvars.sh" ]; then
    source "$HOME/intel/oneapi/setvars.sh" 2>/dev/null
fi

# Stop any existing servers
pkill -f llama-server 2>/dev/null || true
sleep 1

mkdir -p "$PROJECT_ROOT/logs"

echo "Starting LLM server on port $LLM_PORT..."
$LLAMA_SERVER \
    --model "$LLM_MODEL" \
    --port $LLM_PORT \
    --ctx-size 8192 \
    --batch-size 512 \
    --n-gpu-layers 35 \
    --threads $(nproc) \
    > "$PROJECT_ROOT/logs/llm.log" 2>&1 &

LLM_PID=$!
sleep 3

if ! kill -0 $LLM_PID 2>/dev/null; then
    echo "Error: LLM server failed to start. Check logs/llm.log"
    exit 1
fi

echo "Starting embedding server on port $EMBEDDING_PORT..."
$LLAMA_SERVER \
    --model "$EMBEDDING_MODEL" \
    --port $EMBEDDING_PORT \
    --ctx-size 512 \
    --batch-size 64 \
    --n-gpu-layers 24 \
    --threads $(nproc) \
    --embedding \
    --pooling mean \
    > "$PROJECT_ROOT/logs/embedding.log" 2>&1 &

EMBED_PID=$!
sleep 2

if ! kill -0 $EMBED_PID 2>/dev/null; then
    echo "Error: Embedding server failed to start. Check logs/embedding.log"
    kill $LLM_PID 2>/dev/null
    exit 1
fi

echo ""
echo "✓ Servers running!"
echo ""
echo "LLM:         http://localhost:$LLM_PORT/v1/chat/completions"
echo "Embeddings:  http://localhost:$EMBEDDING_PORT/v1/embeddings"
echo ""
echo "API Key: sk-local-llm-key"
echo ""
echo "To stop: pkill -f llama-server"
