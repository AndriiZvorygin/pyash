#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

docker compose -f "$ROOT_DIR/container/service/pyash.yaml" build
docker compose -f "$ROOT_DIR/container/service/pyash.yaml" down
"$ROOT_DIR/container/command/begin.sh"
