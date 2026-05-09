#!/bin/sh
set -e

MODEL_PATH="asl/model.p"

if [ ! -f "$MODEL_PATH" ]; then
  if [ -n "$MODEL_URL" ]; then
    echo "[entrypoint] Downloading ASL model from MODEL_URL..."
    mkdir -p asl
    curl -fsSL "$MODEL_URL" -o "$MODEL_PATH"
    echo "[entrypoint] Model downloaded ($(du -sh "$MODEL_PATH" | cut -f1))"
  else
    echo "[entrypoint] ERROR: asl/model.p not found and MODEL_URL is not set."
    echo "             Mount the model file or set MODEL_URL to a download URL."
    exit 1
  fi
fi

exec npx concurrently \
  --kill-others-on-fail \
  --names "node,asl" \
  --prefix-colors "cyan,green" \
  "node server.js" \
  "python3 server/asl_api.py"
