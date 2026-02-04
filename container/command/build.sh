#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/container/service/pyash.yaml"

build_args=()
platform=""
tag="pyash-dev"
push=false
load=false
while [[ $# -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    --no-cache)
      build_args+=("--no-cache")
      shift
      ;;
    --platform)
      platform="${2:-}"
      shift 2
      ;;
    --tag)
      tag="${2:-}"
      shift 2
      ;;
    --push)
      push=true
      shift
      ;;
    --load)
      load=true
      shift
      ;;
    --help|-h)
      cat <<'EOF'
Usage: ./container/command/build.sh [--no-cache] [--platform <list>] [--tag <image>] [--push|--load] [-- <docker compose build args>]

Builds the pyash container, then restarts via begin.sh.

Notes:
  - Multi-arch builds require --platform and --push (registry tag required).
  - Single-arch builds can use --load (default when using buildx).
EOF
      exit 0
      ;;
    *)
      build_args+=("$arg")
      shift
      ;;
  esac
done

if [[ -n "$platform" ]]; then
  if [[ "$platform" == *","* ]] && [[ "$push" != true ]]; then
    echo "error: multi-arch build requires --push (registry tag required)" >&2
    exit 2
  fi
  if [[ "$push" == true && "$tag" == "pyash-dev" ]]; then
    echo "error: --push requires --tag <registry/image>" >&2
    exit 2
  fi
  if [[ "$push" == true ]]; then
    docker buildx build \
      -f "$ROOT_DIR/container/Dockerfile" \
      -t "$tag" \
      --platform "$platform" \
      --push \
      "${build_args[@]}" \
      "$ROOT_DIR"
  else
    docker buildx build \
      -f "$ROOT_DIR/container/Dockerfile" \
      -t "$tag" \
      --platform "$platform" \
      ${load:+--load} \
      "${build_args[@]}" \
      "$ROOT_DIR"
  fi
else
  docker compose -f "$COMPOSE_FILE" build "${build_args[@]}"
  docker compose -f "$COMPOSE_FILE" down
  "$ROOT_DIR/container/command/begin.sh"
fi
