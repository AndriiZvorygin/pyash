#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/service/compose.gpu.yaml"

if [[ -z "${GPU_HOUSEKEEPER_HOST_ID:-}" ]]; then
  export GPU_HOUSEKEEPER_HOST_ID="$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9._-' || true)"
  if [[ -z "${GPU_HOUSEKEEPER_HOST_ID:-}" ]]; then
    export GPU_HOUSEKEEPER_HOST_ID="gpu-housekeeper"
  fi
fi

docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans
echo "gpu-housekeeper service started"
