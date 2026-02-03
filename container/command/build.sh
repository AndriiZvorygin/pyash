#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/container/service/pyash.yaml"

build_args=()
for arg in "$@"; do
  case "$arg" in
    --no-cache)
      build_args+=("--no-cache")
      ;;
    --help|-h)
      cat <<'EOF'
Usage: ./container/command/build.sh [--no-cache] [-- <docker compose build args>]

Builds the pyash container, then restarts via begin.sh.
EOF
      exit 0
      ;;
    *)
      build_args+=("$arg")
      ;;
  esac
done

docker compose -f "$COMPOSE_FILE" build "${build_args[@]}"
docker compose -f "$COMPOSE_FILE" down
"$ROOT_DIR/container/command/begin.sh"
