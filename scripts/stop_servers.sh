#!/bin/bash
# Stop llama.cpp servers

echo "Stopping servers..."
pkill -f llama-server && echo "✓ Stopped" || echo "No servers running"
