#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/service/compose.yaml"
GPU_FILE="$ROOT_DIR/service/compose.gpu.yaml"

mkdir -p "$ROOT_DIR/cache/huggingface" "$ROOT_DIR/cache/torch"

if [[ -z "${SPEAKER_WORKSPACE:-}" ]]; then
  export SPEAKER_WORKSPACE="$(cd "$ROOT_DIR/../.." && pwd)"
fi

compose_args=(-f "$COMPOSE_FILE")
if command -v nvidia-smi >/dev/null 2>&1; then
  runtimes="$(docker info --format '{{json .Runtimes}}' 2>/dev/null || true)"
  if [[ "$runtimes" == *"nvidia"* ]]; then
    compose_args+=(-f "$GPU_FILE")
  fi
fi

docker compose "${compose_args[@]}" up -d --remove-orphans
echo "speaker service started"
