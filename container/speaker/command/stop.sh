#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/service/compose.yaml"
GPU_FILE="$ROOT_DIR/service/compose.gpu.yaml"

docker compose -f "$COMPOSE_FILE" -f "$GPU_FILE" down --remove-orphans 2>/dev/null || \
  docker compose -f "$COMPOSE_FILE" down --remove-orphans

echo "speaker service stopped"
