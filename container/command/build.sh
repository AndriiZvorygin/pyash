#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/container/service/pyash.yaml"
source "$ROOT_DIR/command/container_preflight.sh"

build_args=()
platform=""
tag="pyash-dev"
use_buildx=true
cache_dir="$ROOT_DIR/container/.buildx-cache"
push=false
load=false
no_restart=false
codex_version=""
codex_refresh=""

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
    --codex-version)
      codex_version="${2:-}"
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
Usage: ./container/command/build.sh [--no-cache] [--no-buildx] [--no-restart] [--platform <list>] [--tag <image>] [--cache-dir <path>] [--codex-version <ver>|--new-codex] [--push|--load] [-- <docker compose build args>]

Builds the pyash container, then restarts via begin.sh.

Notes:
  - Buildx is the default (cached). Use --no-buildx to fall back to docker compose build.
  - If buildx is unavailable, this command auto-falls back to docker compose build.
  - Use --no-restart to skip docker compose down/begin when using compose builds.
  - Multi-arch builds require --platform and --push (registry tag required).
  - Single-arch builds can use --load (default when using buildx).
  - Cache is stored at ./container/.buildx-cache unless overridden.
  - Use --codex-version to force a Codex layer rebuild.
  - Use --new-codex as a shorthand for --codex-version latest.
EOF
      exit 0
      ;;
    --new-codex)
      codex_version="latest"
      shift
      ;;
    --)
      shift
      build_args+=("$@")
      break
      ;;
    *)
      build_args+=("$arg")
      shift
      ;;
  esac
done

if [[ -n "$codex_version" ]]; then
  codex_refresh="$(date +%s)"
fi

if ! pya_container_has_docker; then
  echo "error: $(pya_container_missing_docker_message)" >&2
  exit 2
fi

if ! pya_container_daemon_running; then
  echo "error: $(pya_container_daemon_not_running_message)" >&2
  exit 2
fi

if ! pya_container_has_compose; then
  echo "error: $(pya_container_missing_compose_message)" >&2
  exit 2
fi

if [[ "$use_buildx" == true ]] && ! pya_container_has_buildx; then
  echo "warn: docker buildx is unavailable; falling back to docker compose build (same as --no-buildx)." >&2
  use_buildx=false
fi

if [[ "$use_buildx" != true ]] && [[ -n "$platform" ]]; then
  echo "error: --platform requires buildx. Remove --platform or install buildx." >&2
  echo "hint: $(pya_container_missing_buildx_message)" >&2
  exit 2
fi

if [[ "$use_buildx" == true ]]; then
  # Auto-detect platform if not specified
  if [[ -z "$platform" ]]; then
    arch="$(docker info -f '{{.Architecture}}' 2>/dev/null || true)"
    if [[ -z "$arch" ]]; then
      arch="$(uname -m 2>/dev/null || true)"
    fi

    case "$arch" in
      amd64|x86_64)
        platform="linux/amd64"
        ;;
      arm64|aarch64)
        platform="linux/arm64"
        ;;
      armv7l|armv7)
        platform="linux/arm/v7"
        ;;
      armv6l|armv6)
        platform="linux/arm/v6"
        ;;
      linux/*)
        platform="$arch"
        ;;
      "")
        platform="linux/amd64"
        echo "warn: unable to detect architecture; defaulting to $platform" >&2
        ;;
      *)
        platform="linux/$arch"
        ;;
    esac
  fi

  # Default to --load if neither push nor load specified
  if [[ "$push" != true && "$load" != true ]]; then
    load=true
  fi

  # Validate multi-arch builds
  if [[ "$platform" == *","* ]] && [[ "$push" != true ]]; then
    echo "error: multi-arch build requires --push (registry tag required)" >&2
    exit 2
  fi

  # Validate push requires registry tag
  if [[ "$push" == true && "$tag" == "pyash-dev" ]]; then
    echo "error: --push requires --tag <registry/image>" >&2
    exit 2
  fi

  # Set up cache
  cache_from="type=local,src=$cache_dir"
  cache_to="type=local,dest=$cache_dir,mode=max"

  # Check buildx driver
  driver="$(docker buildx inspect --bootstrap --format '{{.Driver}}' 2>/dev/null || true)"
  driver="${driver#"${driver%%[![:space:]]*}"}"
  driver="${driver%"${driver##*[![:space:]]}"}"
  if [[ -z "$driver" ]]; then
    driver="$(
      { docker buildx inspect --bootstrap 2>/dev/null || true; } \
        | awk -F': ' '/^Driver:/ {gsub(/^ +| +$/,"",$2); print $2; exit}'
    )"
  fi

  # Disable cache for docker driver
  if [[ "$driver" == "docker" ]]; then
    echo "warn: buildx driver is docker; cache export disabled (enable containerd image store or switch driver)." >&2
    cache_from=""
    cache_to=""
  fi

  # Build with buildx
  buildx_args=(
    -f "$ROOT_DIR/container/Dockerfile"
    -t "$tag"
    --platform "$platform"
  )
  if [[ -n "$codex_version" ]]; then
    buildx_args+=(--build-arg "CODEX_VERSION=$codex_version")
    buildx_args+=(--build-arg "CODEX_REFRESH=$codex_refresh")
  fi

  if [[ "$push" == true ]]; then
    buildx_args+=(--push)
  elif [[ "$load" == true ]]; then
    buildx_args+=(--load)
  fi

  [[ -n "$cache_from" ]] && buildx_args+=(--cache-from "$cache_from")
  [[ -n "$cache_to" ]] && buildx_args+=(--cache-to "$cache_to")

  docker buildx build "${buildx_args[@]}" "${build_args[@]}" "$ROOT_DIR"

  if [[ "$no_restart" != true ]]; then
    docker compose -f "$COMPOSE_FILE" down
    "$ROOT_DIR/container/command/begin.sh"
  fi

else
  # Use docker compose build
  if [[ -n "$codex_version" ]]; then
    build_args+=(--build-arg "CODEX_VERSION=$codex_version")
    build_args+=(--build-arg "CODEX_REFRESH=$codex_refresh")
  fi
  docker compose -f "$COMPOSE_FILE" build "${build_args[@]}"
  
  if [[ "$no_restart" != true ]]; then
    docker compose -f "$COMPOSE_FILE" down
    "$ROOT_DIR/container/command/begin.sh"
  fi
fi
