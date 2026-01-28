#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

docker compose -f "$ROOT_DIR/container/orchestrate.yaml" down
docker compose -f "$ROOT_DIR/container/orchestrate.yaml" build
