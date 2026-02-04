#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/container/service/pyash.yaml"

build_args=()
platform=""
tag="pyash-dev"
use_buildx=true
cache_dir="$ROOT_DIR/container/.buildx-cache"
push=false
load=false
no_restart=false
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
    --buildx)
      use_buildx=true
      shift
      ;;
    --no-buildx)
      use_buildx=false
      shift
      ;;
    --no-restart)
      no_restart=true
      shift
      ;;
    --tag)
      tag="${2:-}"
      shift 2
      ;;
    --cache-dir)
      cache_dir="${2:-}"
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
Usage: ./container/command/build.sh [--no-cache] [--no-buildx] [--no-restart] [--platform <list>] [--tag <image>] [--cache-dir <path>] [--push|--load] [-- <docker compose build args>]

Builds the pyash container, then restarts via begin.sh.

Notes:
  - Buildx is the default (cached). Use --no-buildx to fall back to docker compose build.
  - Use --no-restart to skip docker compose down/begin when using compose builds.
  - Multi-arch builds require --platform and --push (registry tag required).
  - Single-arch builds can use --load (default when using buildx).
  - Cache is stored at ./container/.buildx-cache unless overridden.
EOF
      exit 0
      ;;
    *)
      build_args+=("$arg")
      shift
      ;;
  esac
done

if [[ -n "$platform" || "$use_buildx" == true ]]; then
  if [[ -z "$platform" ]]; then
    platform="$(docker info -f '{{.Architecture}}' 2>/dev/null | sed 's|^|linux/|')"
  fi
  if [[ "$push" != true && "$load" != true ]]; then
    load=true
  fi
  if [[ "$platform" == *","* ]] && [[ "$push" != true ]]; then
    echo "error: multi-arch build requires --push (registry tag required)" >&2
    exit 2
  fi
  if [[ "$push" == true && "$tag" == "pyash-dev" ]]; then
    echo "error: --push requires --tag <registry/image>" >&2
    exit 2
  fi
  cache_from="type=local,src=$cache_dir"
  cache_to="type=local,dest=$cache_dir,mode=max"
  if [[ "$push" == true ]]; then
    docker buildx build \
      -f "$ROOT_DIR/container/Dockerfile" \
      -t "$tag" \
      --platform "$platform" \
      --push \
      --cache-from "$cache_from" \
      --cache-to "$cache_to" \
      "${build_args[@]}" \
      "$ROOT_DIR"
  else
    docker buildx build \
      -f "$ROOT_DIR/container/Dockerfile" \
      -t "$tag" \
      --platform "$platform" \
      ${load:+--load} \
      --cache-from "$cache_from" \
      --cache-to "$cache_to" \
      "${build_args[@]}" \
      "$ROOT_DIR"
  fi
else
  docker compose -f "$COMPOSE_FILE" build "${build_args[@]}"
  if [[ "$no_restart" != true ]]; then
    docker compose -f "$COMPOSE_FILE" down
    "$ROOT_DIR/container/command/begin.sh"
  fi
fi
