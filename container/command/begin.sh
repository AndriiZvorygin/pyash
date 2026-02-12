#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORKPLACE_CONFIG="$ROOT_DIR/configure/workplace.pya"
DEFAULT_CONFIG="$ROOT_DIR/configure/default.pya"
CONTAINER_CONFIG="$ROOT_DIR/configure/container.pya"
SECRET_CONFIG="$ROOT_DIR/configure/secret.pya"
OVERRIDE_FILE="$ROOT_DIR/container/building/compose.override.yaml"

get_pyash_value() {
  local key="$1"
  local file="$2"
  local line
  if [[ ! -f "$file" ]]; then
    return
  fi
  while IFS= read -r line; do
    if [[ "$line" == "exists su name ${key} ob text \""* ]]; then
      line="${line#*ob text \"}"
      echo "${line%\" be default ya}"
      return
    fi
    if [[ "$line" == "exists su name ${key} ob filename \""* ]]; then
      line="${line#*ob filename \"}"
      echo "${line%\" be default ya}"
      return
    fi
    if [[ "$line" == "exists su name ${key} ob bool "* ]]; then
      line="${line#*ob bool }"
      echo "${line% be default ya}"
      return
    fi
    if [[ "$line" == "  su name ${key} ob text \""* ]]; then
      line="${line#*ob text \"}"
      echo "${line%\" ya}"
      return
    fi
    if [[ "$line" == "  su name ${key} ob filename \""* ]]; then
      line="${line#*ob filename \"}"
      echo "${line%\" ya}"
      return
    fi
    if [[ "$line" == "  su name ${key} ob bool "* ]]; then
      line="${line#*ob bool }"
      echo "${line% ya}"
      return
    fi
  done < "$file"
}

get_config_value() {
  local key="$1"
  local value=""
  local candidate=""
  for config in "$DEFAULT_CONFIG" "$CONTAINER_CONFIG" "$SECRET_CONFIG" "$WORKPLACE_CONFIG"; do
    candidate="$(get_pyash_value "$key" "$config" || true)"
    if [[ -n "${candidate:-}" ]]; then
      value="$candidate"
    fi
  done
  echo "$value"
}

ai_host="$(get_config_value "ai host")"
if [[ -z "${ai_host:-}" ]]; then
  ai_host="$(get_config_value "ollama host")"
fi
web_search_enabled="$(get_config_value "web search enabled")"
web_search_motor="$(get_config_value "web search motor")"
search_only="lie"
vnc_enabled="truth"
restart_container="lie"

if [[ -z "${ai_host:-}" ]]; then
  ai_host="http://mriczo:11434"
fi

if [[ -z "${web_search_enabled:-}" ]]; then
  case "${web_search_motor:-}" in
    http://searxng:8080/*|http://searxng:8080|http://localhost:60490/*|http://localhost:60490)
      web_search_enabled="truth"
      ;;
    *)
      web_search_enabled="lie"
      ;;
  esac
fi

ai_host="${ai_host/http:\/\/127.0.0.1/http:\/\/host.docker.internal}"
ai_host="${ai_host/http:\/\/localhost/http:\/\/host.docker.internal}"

export PYASH_UID="$(id -u)"
export PYASH_GID="$(id -g)"
export PYASH_USER="$(id -un)"
export PYASH_CONTAINER_HOME="/home/${PYASH_USER}"
export PYASH_CONTAINER_HOME_DIR="$ROOT_DIR/container/building/home/${PYASH_USER}"
export PYASH_PULSE_DIR="/run/user/${PYASH_UID}/pulse"
export PYASH_PULSE_COOKIE="$HOME/.config/pulse/cookie"
export PYASH_SSH_DIR="$HOME/.ssh"
export PYASH_SSH_KNOWN_HOSTS="$HOME/.ssh/known_hosts"
export PYASH_CODEX_DIR="$HOME/.codex"
export PYASH_GITCONFIG="$HOME/.gitconfig"
export PYASH_GITCONFIG_XDG="$HOME/.config/git/config"
export PYASH_TZ=""

mkdir -p "$PYASH_CONTAINER_HOME_DIR"

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

if [[ -n "${PYASH_SSH_DIR:-}" ]]; then
  mkdir -p "$PYASH_SSH_DIR"
  if [[ -n "${PYASH_SSH_KNOWN_HOSTS:-}" ]]; then
    touch "$PYASH_SSH_KNOWN_HOSTS"
  fi
fi

for arg in "$@"; do
  if [[ "$arg" == "--search-only" ]]; then
    search_only="truth"
  elif [[ "$arg" == "--vnc" ]]; then
    vnc_enabled="truth"
  elif [[ "$arg" == "--no-vnc" ]]; then
    vnc_enabled="lie"
  elif [[ "$arg" == "--restart" ]]; then
    restart_container="truth"
  fi
done

if [[ -n "$vnc_enabled" ]]; then
  export PYASH_VNC_ENABLED="$vnc_enabled"
fi

node "$ROOT_DIR/container/tools/update_compose.mjs"

compose_args=()
full_compose_args=(-f "$ROOT_DIR/container/service/pyash.yaml" -f "$OVERRIDE_FILE")
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
  full_compose_args+=(-f "$ROOT_DIR/container/service/searxng.yaml")
fi

if [[ ${#compose_args[@]} -eq 0 ]]; then
  echo "No services selected. Enable web search or omit --search-only."
  exit 1
fi

if [[ "$restart_container" == "truth" ]]; then
  docker compose "${full_compose_args[@]}" down --remove-orphans || true
fi

if [[ "$search_only" != "truth" ]]; then
  if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "^pyash$"; then
    if [[ "$restart_container" != "truth" ]]; then
      echo "Container already running."
      exec docker exec -it pyash bash
    fi
  fi
fi

AI_HOST="$ai_host" OLLAMA_HOST="$ai_host" \
  docker compose "${compose_args[@]}" up -d --remove-orphans

if [[ "$search_only" == "truth" ]]; then
  echo "Search service started."
  exit 0
fi

ensure_pyash_link() {
  local linked_target
  linked_target="$(
    docker exec pyash bash -lc 'target="$(command -v pyash 2>/dev/null || true)"; if [[ -n "$target" ]]; then readlink -f "$target" 2>/dev/null || true; fi'
  )"
  if [[ "$linked_target" == "/workplace/command/pyash.mjs" ]]; then
    return
  fi

  echo "Linking pyash CLI (npm link)..."
  if ! docker exec pyash bash -lc 'cd /workplace && npm link >/tmp/pyash-npm-link.log 2>&1'; then
    echo "warn: npm link failed inside container (pyash command may be unavailable)." >&2
    docker exec pyash bash -lc 'tail -n 20 /tmp/pyash-npm-link.log 2>/dev/null || true' >&2 || true
    return
  fi
  echo "Linked: pyash -> /workplace/command/pyash.mjs"
}

ensure_pyash_link

echo "Container started. Entering..."
exec docker exec -it pyash bash
