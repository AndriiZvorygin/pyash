#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/service/compose.yaml"

docker compose -f "$COMPOSE_FILE" down --remove-orphans
echo "whisperx service stopped"
