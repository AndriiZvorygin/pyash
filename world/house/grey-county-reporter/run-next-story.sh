#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYASH_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
CLI="$PYASH_ROOT/command/unified-writer-cli.mjs"

# Force Grey posting identity defaults for this house so inherited shell
# vars from other writers do not leak into Grey posting.
if [[ -z "${GREY_COUNTY_REPORTER_USERNAME:-}" || -z "${GREY_COUNTY_REPORTER_PASSWORD:-}" ]]; then
  for ENV_FILE in "$SCRIPT_DIR/.env" "$PYASH_ROOT/.env" "$PYASH_ROOT/world/house/owen-sound-reporter/.env"; do
    [[ -f "$ENV_FILE" ]] || continue
    if [[ -z "${GREY_COUNTY_REPORTER_USERNAME:-}" ]]; then
      GREY_USER="$(grep '^GREY_COUNTY_REPORTER_USERNAME=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n' || true)"
      [[ -n "$GREY_USER" ]] && export GREY_COUNTY_REPORTER_USERNAME="$GREY_USER"
    fi
    if [[ -z "${GREY_COUNTY_REPORTER_PASSWORD:-}" ]]; then
      GREY_PASS="$(grep '^GREY_COUNTY_REPORTER_PASSWORD=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n' || true)"
      [[ -n "$GREY_PASS" ]] && export GREY_COUNTY_REPORTER_PASSWORD="$GREY_PASS"
    fi
  done
fi

if [[ -n "${GREY_COUNTY_REPORTER_USERNAME:-}" ]]; then
  export MEETING_PUBLISH_USERNAME="$GREY_COUNTY_REPORTER_USERNAME"
fi
if [[ -n "${GREY_COUNTY_REPORTER_PASSWORD:-}" ]]; then
  export MEETING_PUBLISH_PASSWORD="$GREY_COUNTY_REPORTER_PASSWORD"
fi

# Compatibility behavior:
# - no args => next
# - first arg is a flag => next + flags
# - first arg is a command => pass through command surface
if [[ $# -eq 0 ]]; then
  exec node "$CLI" next --writer grey
fi

if [[ "$1" == "--list" ]]; then
  shift
  exec node "$CLI" list --writer grey "$@"
fi

if [[ "$1" == "--meeting" || "$*" == *" --meeting "* || "$*" == --meeting* || "$*" == *" --meeting" ]]; then
  exec node "$CLI" run --writer grey "$@"
fi

case "$1" in
  -*)
    exec node "$CLI" next --writer grey "$@"
    ;;
  *)
    CMD="$1"
    shift
    exec node "$CLI" "$CMD" --writer grey "$@"
    ;;
esac
