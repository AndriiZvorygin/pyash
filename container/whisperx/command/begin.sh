#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/service/compose.yaml"

mkdir -p "$ROOT_DIR/cache"
mkdir -p "$ROOT_DIR/cache/huggingface" "$ROOT_DIR/cache/torch" "$ROOT_DIR/cache/matplotlib"

if [[ -z "${WHISPERX_WORKSPACE:-}" ]]; then
  export WHISPERX_WORKSPACE="$(cd "$ROOT_DIR/../.." && pwd)"
fi

docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
echo "whisperx service started"
