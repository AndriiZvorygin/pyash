#!/usr/bin/env bash
set -euo pipefail

PYASH_BACKGROUND_REPOSITORY="${PYASH_BACKGROUND_REPOSITORY:-/home/htaf/pyash}"
PYASH_BACKGROUND_ENV="${PYASH_BACKGROUND_ENV:-/home/htaf/.config/pyash/background.env}"
PYASH_BACKGROUND_LOCK="${PYASH_BACKGROUND_LOCK:-/tmp/pyash-roadmap.lock}"

pyash_background_prepare() {
  export HOME=/home/htaf
  if [[ ! -r "$PYASH_BACKGROUND_ENV" ]]; then
    printf 'missing private background environment: %s\n' "$PYASH_BACKGROUND_ENV" >&2
    return 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$PYASH_BACKGROUND_ENV"
  set +a

  local nvm_root latest_nvm
  nvm_root="$HOME/.nvm/versions/node"
  if [[ -d "$nvm_root" ]]; then
    latest_nvm=$(find "$nvm_root" -mindepth 1 -maxdepth 1 -type d -printf '%f\n' | sort -V | tail -1)
    if [[ -n "$latest_nvm" ]]; then
      PATH="$nvm_root/$latest_nvm/bin:$PATH"
    fi
  fi
  export PATH="${PYA_BACKGROUND_PATH:-$PATH}"
  export PYA_NODE_BIN="${PYA_NODE_BIN:-$(command -v node || true)}"
  export PYA_CODEX_BIN="${PYA_CODEX_BIN:-$(command -v codex || true)}"
  if [[ ! -x "$PYA_NODE_BIN" ]]; then
    printf 'Node executable not found: %s\n' "$PYA_NODE_BIN" >&2
    return 1
  fi
  if [[ ! -x "$PYA_CODEX_BIN" ]]; then
    printf 'Codex executable not found: %s\n' "$PYA_CODEX_BIN" >&2
    return 1
  fi
  if [[ ! -d "$PYASH_BACKGROUND_REPOSITORY" ]]; then
    printf 'Pyash repository not found: %s\n' "$PYASH_BACKGROUND_REPOSITORY" >&2
    return 1
  fi
  cd "$PYASH_BACKGROUND_REPOSITORY"
  export PYA_BACKGROUND_LOG_DIR="${PYA_BACKGROUND_LOG_DIR:-$PYASH_BACKGROUND_REPOSITORY/log}"
  mkdir -p "$PYA_BACKGROUND_LOG_DIR"
  chmod 700 "$PYA_BACKGROUND_LOG_DIR"
}

pyash_background_log() {
  local stream="$1"
  printf '%s %s\n' "$(date --iso-8601=seconds)" "$stream"
}
