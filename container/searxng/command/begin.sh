#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/service/compose.yaml"
ENV_FILE="$ROOT_DIR/configure/ecology/searxng.env"

if [[ ! -f "$ENV_FILE" ]]; then
  mkdir -p "$(dirname "$ENV_FILE")"
  umask 077
  if command -v openssl >/dev/null 2>&1; then
    secret="$(openssl rand -hex 16)"
  else
    secret="$(head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \\n')"
  fi
  printf 'SEARXNG_SECRET=%s\n' "$secret" > "$ENV_FILE"
fi

docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
