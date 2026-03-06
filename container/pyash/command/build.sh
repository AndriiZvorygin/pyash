#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
COMPOSE_FILE="$PROJECT_ROOT/container/pyash/service/compose.yaml"
source "$PROJECT_ROOT/command/container_preflight.sh"

build_args=()
platform=""
runtime_image="liberit/pyash:latest"
image_tags=("$runtime_image")
use_buildx=true
cache_dir="$PROJECT_ROOT/container/pyash/.buildx-cache"
push=false
load=false
no_restart=false
no_cache=false
codex_version=""
codex_refresh=""
tag_explicit=false
push_explicit=false
manual_push=false
secret_file="$PROJECT_ROOT/configure/secret.pya"

pya_secret_read_text() {
  local key="$1"
  [[ -f "$secret_file" ]] || return 0
  local line
  line="$(grep -F "su name ${key} ob text " "$secret_file" | tail -n1 || true)"
  [[ -n "$line" ]] || return 0
  sed -E 's/.* ob text "([^"]*)".*/\1/' <<<"$line"
}

pya_secret_read_bool() {
  local key="$1"
  [[ -f "$secret_file" ]] || return 0
  local line
  line="$(grep -F "su name ${key} ob bool " "$secret_file" | tail -n1 || true)"
  [[ -n "$line" ]] || return 0
  sed -E 's/.* ob bool (truth|lie).*/\1/' <<<"$line"
}

while [[ $# -gt 0 ]]; do
  arg="$1"
  case "$arg" in
    --no-cache)
      build_args+=("--no-cache")
      no_cache=true
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
      if [[ "$tag_explicit" != true ]]; then
        image_tags=()
      fi
      image_tags+=("${2:-}")
      tag_explicit=true
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
      push_explicit=true
      shift
      ;;
    --load)
      load=true
      shift
      ;;
    --help|-h)
      cat <<'EOF'
Usage: ./container/pyash/command/build.sh [--no-cache] [--no-buildx] [--no-restart] [--platform <list>] [--tag <image>] [--cache-dir <path>] [--codex-version <ver>|--new-codex] [--push|--load] [-- <docker compose build args>]

Builds the pyash container, then restarts via begin.sh.

Notes:
  - Buildx is the default (cached). Use --no-buildx to fall back to docker compose build.
  - If buildx is unavailable, this command auto-falls back to docker compose build.
  - Use --no-restart to skip docker compose down/begin when using compose builds.
  - Multi-arch builds require --platform and --push (registry tag required).
  - Single-arch builds can use --load (default when using buildx).
  - Cache is stored at ./container/.buildx-cache unless overridden.
  - Repeat --tag to publish multiple tags in one buildx run.
  - If configure/secret.pya sets container image repo/push keys, those defaults are used when --tag/--push are not passed.
  - By default, if today's configured repo tag exists, this command pulls it and retags it to the runtime image instead of rebuilding.
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

publish_repo=""
publish_enabled=""
publish_latest=""

if [[ "$tag_explicit" != true ]]; then
  publish_repo="$(pya_secret_read_text "container image repo")"
  publish_enabled="$(pya_secret_read_bool "container image push")"
  publish_latest="$(pya_secret_read_bool "container image push latest")"
  if [[ -n "${publish_repo:-}" ]]; then
    runtime_image="${publish_repo}:latest"
    image_tags=("$runtime_image" "${publish_repo}:$(date +%Y%m%d)")
    if [[ "$push_explicit" != true && "$publish_enabled" == "truth" ]]; then
      push=true
    fi
  fi
fi

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

if [[ -n "${publish_repo:-}" && "$tag_explicit" != true && -z "$codex_version" && "$no_cache" != true && "$push_explicit" != true && "$load" != true ]]; then
  daily_tag="${publish_repo}:$(date +%Y%m%d)"
  echo "Checking for existing daily image: ${daily_tag}" >&2
  if docker pull "$daily_tag" >/dev/null 2>&1; then
    echo "Using pulled daily image: ${daily_tag}" >&2
    docker tag "$daily_tag" "$runtime_image"
    if [[ "$no_restart" != true ]]; then
      docker compose -f "$COMPOSE_FILE" down
      "$PROJECT_ROOT/container/pyash/command/begin.sh"
    fi
    exit 0
  fi
  echo "No pullable daily image found for today; building locally." >&2
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

  # For the default single-arch local workflow, load the image locally so restart works,
  # then push only the registry tags after the build. Explicit --push keeps buildx push mode.
  if [[ "$push" == true && "$push_explicit" != true && "$load" != true ]]; then
    load=true
    manual_push=true
  fi

  # Validate multi-arch builds
  if [[ "$platform" == *","* ]] && [[ "$push" != true ]]; then
    echo "error: multi-arch build requires --push (registry tag required)" >&2
    exit 2
  fi

  # Validate push requires at least one registry tag.
  has_registry_tag=false
  for one_tag in "${image_tags[@]}"; do
    if [[ "$one_tag" == */*:* ]]; then
      has_registry_tag=true
      break
    fi
  done
  if [[ "$push" == true && "$has_registry_tag" != true ]]; then
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
    -f "$PROJECT_ROOT/container/pyash/Dockerfile"
    --platform "$platform"
  )
  for one_tag in "${image_tags[@]}"; do
    buildx_args+=(-t "$one_tag")
  done
  if [[ -n "$codex_version" ]]; then
    buildx_args+=(--build-arg "CODEX_VERSION=$codex_version")
    buildx_args+=(--build-arg "CODEX_REFRESH=$codex_refresh")
  fi

  if [[ "$manual_push" == true ]]; then
    buildx_args+=(--load)
  elif [[ "$push" == true ]]; then
    buildx_args+=(--push)
  elif [[ "$load" == true ]]; then
    buildx_args+=(--load)
  fi

  [[ -n "$cache_from" ]] && buildx_args+=(--cache-from "$cache_from")
  [[ -n "$cache_to" ]] && buildx_args+=(--cache-to "$cache_to")

  docker buildx build "${buildx_args[@]}" "${build_args[@]}" "$PROJECT_ROOT"

  if [[ "$manual_push" == true ]]; then
    for one_tag in "${image_tags[@]}"; do
      docker push "$one_tag"
    done
  fi

  if [[ "$no_restart" != true ]]; then
    if [[ "$push" == true && "$load" != true ]]; then
      echo "warn: skipping restart because buildx pushed tags without loading a local image; use --load to restart from the new build." >&2
      exit 0
    fi
    docker compose -f "$COMPOSE_FILE" down
    "$PROJECT_ROOT/container/pyash/command/begin.sh"
  fi

else
  # Use docker compose build
  if [[ "${#image_tags[@]}" -gt 0 && "${image_tags[0]}" != "$runtime_image" ]]; then
    echo "warn: custom --tag/configured tags are only applied with buildx; compose build keeps service image tag." >&2
  fi
  if [[ -n "$codex_version" ]]; then
    build_args+=(--build-arg "CODEX_VERSION=$codex_version")
    build_args+=(--build-arg "CODEX_REFRESH=$codex_refresh")
  fi
  docker compose -f "$COMPOSE_FILE" build "${build_args[@]}"
  
  if [[ "$no_restart" != true ]]; then
    docker compose -f "$COMPOSE_FILE" down
    "$PROJECT_ROOT/container/pyash/command/begin.sh"
  fi
fi
