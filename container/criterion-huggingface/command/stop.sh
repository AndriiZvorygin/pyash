#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/service/compose.yaml"
GPU_FILE="$ROOT_DIR/service/compose.gpu.yaml"

docker compose -p criterion-huggingface -f "$COMPOSE_FILE" -f "$GPU_FILE" down --remove-orphans
echo "criterion Hugging Face service stopped"
