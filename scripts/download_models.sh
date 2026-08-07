#!/bin/bash
# Download models for LLooM Workbench

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="$PROJECT_ROOT/models"

echo "========================================="
echo "Model Download"
echo "========================================="
echo ""

# Install hf if needed
if ! command -v hf &> /dev/null; then
    echo "Installing huggingface-hub..."
    pip install -q huggingface-hub
fi

mkdir -p "$MODELS_DIR"
cd "$MODELS_DIR"

# Download Gemma 4 E4B
echo "1. Downloading Gemma 4 E4B Instruct (Q4_K_M)..."
if [ -f "gemma-4-E4B-it-Q4_K_M.gguf" ]; then
    echo "  ✓ Already exists"
else
    hf download \
        unsloth/gemma-4-E4B-it-GGUF \
        gemma-4-E4B-it-Q4_K_M.gguf \
        --local-dir .
    echo "  ✓ Downloaded"
fi

echo ""

# Download embedding model
echo "2. Downloading embedding model..."
if [ -f "bge-m3-q4_k.gguf" ]; then
    echo "  ✓ Already exists"
else
    # Use nomic-embed-text - well-supported GGUF embedding model
    echo "  Using nomic-embed-text-v1.5 (good multilingual support)"
    hf download \
        nomic-ai/nomic-embed-text-v1.5-GGUF \
        nomic-embed-text-v1.5.Q4_K_M.gguf \
        --local-dir .
    
    mv nomic-embed-text-v1.5.Q4_K_M.gguf bge-m3-q4_k.gguf
    echo "  ✓ Downloaded"
fi

echo ""
echo "Downloaded models:"
ls -lh "$MODELS_DIR"/*.gguf
