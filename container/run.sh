#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKPLACE_CONFIG="$ROOT_DIR/configure/workplace.pya"
OVERRIDE_FILE="$ROOT_DIR/container/compose.override.yaml"

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

node "$ROOT_DIR/container/update_compose.mjs"

if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^pyash$"; then
  echo "Container already running."
  exec docker exec -it pyash bash
fi

AI_HOST="$ai_host" OLLAMA_HOST="$ai_host" \
  docker compose -f "$ROOT_DIR/container/orchestrate.yaml" -f "$OVERRIDE_FILE" up -d

echo "Container started. Entering..."
exec docker exec -it pyash bash
