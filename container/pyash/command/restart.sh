#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

docker compose -f "$PROJECT_ROOT/container/pyash/service/compose.yaml" down
docker compose -f "$PROJECT_ROOT/container/searxng/service/compose.yaml" down || true

exec "$PROJECT_ROOT/container/pyash/command/begin.sh" "$@"
