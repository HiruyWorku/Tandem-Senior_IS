#!/bin/sh
# Download the ASL model before building the Docker image or running locally.
# Usage: MODEL_URL=<url> ./scripts/download_model.sh
set -e

MODEL_PATH="asl/model.p"

if [ -f "$MODEL_PATH" ]; then
  echo "Model already present at $MODEL_PATH — skipping download."
  exit 0
fi

if [ -z "$MODEL_URL" ]; then
  echo "ERROR: MODEL_URL is not set. Export it before running this script."
  echo "  export MODEL_URL=https://your-storage/model.p"
  exit 1
fi

mkdir -p asl
echo "Downloading model from \$MODEL_URL..."
curl -fL "$MODEL_URL" -o "$MODEL_PATH"
echo "Done — $(du -sh "$MODEL_PATH" | cut -f1) written to $MODEL_PATH"
