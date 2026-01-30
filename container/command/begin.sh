#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKPLACE_CONFIG="$ROOT_DIR/configure/workplace.pya"
OVERRIDE_FILE="$ROOT_DIR/container/building/compose.override.yaml"

get_map_value() {
  local key="$1"
  local line
  if [[ ! -f "$WORKPLACE_CONFIG" ]]; then
    return
  fi
  while IFS= read -r line; do
    if [[ "$line" == "  su name ${key} ob text \""* ]]; then
      line="${line#*ob text \"}"
      echo "${line%\" ya}"
      return
    fi
    if [[ "$line" == "  su name ${key} ob bool "* ]]; then
      line="${line#*ob bool }"
      echo "${line% ya}"
      return
    fi
  done < "$WORKPLACE_CONFIG"
}

ai_host="$(get_map_value "ai host")"
web_search_enabled="$(get_map_value "web search enabled")"
search_only="lie"

if [[ -z "${ai_host:-}" ]]; then
  ai_host="http://host.docker.internal:11434"
fi

ai_host="${ai_host/http:\/\/127.0.0.1/http:\/\/host.docker.internal}"
ai_host="${ai_host/http:\/\/localhost/http:\/\/host.docker.internal}"

export PYASH_UID="$(id -u)"
export PYASH_GID="$(id -g)"
export PYASH_PULSE_DIR="/run/user/${PYASH_UID}/pulse"
export PYASH_PULSE_COOKIE="$HOME/.config/pulse/cookie"
export PYASH_CODEX_DIR="$HOME/.codex"
export PYASH_GITCONFIG="$HOME/.gitconfig"
export PYASH_GITCONFIG_XDG="$HOME/.config/git/config"
export PYASH_TZ=""

if [[ -f /etc/timezone ]]; then
  PYASH_TZ="$(cat /etc/timezone)"
elif command -v timedatectl >/dev/null 2>&1; then
  PYASH_TZ="$(timedatectl show -p Timezone --value 2>/dev/null || true)"
elif [[ -L /etc/localtime ]]; then
  tz_path="$(readlink -f /etc/localtime || true)"
  if [[ "$tz_path" == */zoneinfo/* ]]; then
    PYASH_TZ="${tz_path#*/zoneinfo/}"
  fi
fi

for arg in "$@"; do
  if [[ "$arg" == "--search-only" ]]; then
    search_only="truth"
  fi
done

node "$ROOT_DIR/container/tools/update_compose.mjs"

if [[ "$search_only" != "truth" ]]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^pyash$"; then
    echo "Container already running."
    exec docker exec -it pyash bash
  fi
fi

compose_args=()
if [[ "$search_only" != "truth" ]]; then
  compose_args=(-f "$ROOT_DIR/container/service/pyash.yaml" -f "$OVERRIDE_FILE")
fi
if [[ "${web_search_enabled:-lie}" == "truth" || "$search_only" == "truth" ]]; then
  searx_env="$ROOT_DIR/container/configure/ecology/searxng.env"
  if [[ ! -f "$searx_env" ]]; then
    mkdir -p "$(dirname "$searx_env")"
    umask 077
    if command -v openssl >/dev/null 2>&1; then
      secret="$(openssl rand -hex 16)"
    else
      secret="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \\n')"
    fi
    printf 'SEARXNG_SECRET=%s\n' "$secret" > "$searx_env"
  fi
  compose_args+=(-f "$ROOT_DIR/container/service/searxng.yaml")
fi

if [[ ${#compose_args[@]} -eq 0 ]]; then
  echo "No services selected. Enable web search or omit --search-only."
  exit 1
fi

AI_HOST="$ai_host" OLLAMA_HOST="$ai_host" \
  docker compose "${compose_args[@]}" up -d

if [[ "$search_only" == "truth" ]]; then
  echo "Search service started."
  exit 0
fi

echo "Container started. Entering..."
exec docker exec -it pyash bash
