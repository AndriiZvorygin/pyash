#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/service/compose.yaml"
GPU_FILE="$ROOT_DIR/service/compose.gpu.yaml"

mkdir -p "$ROOT_DIR/cache/huggingface" "$ROOT_DIR/cache/torch"

if [[ -z "${CRITERION_HUGGINGFACE_WORKSPACE:-}" ]]; then
  export CRITERION_HUGGINGFACE_WORKSPACE="$(cd "$ROOT_DIR/../.." && pwd)"
fi

docker compose -p criterion-huggingface -f "$COMPOSE_FILE" -f "$GPU_FILE" up -d --build --remove-orphans
echo "criterion Hugging Face service started"
