#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAM_MJS="program/run-next-unposted-story.mjs"

PICK_ONLY=0
FORCE_REFRESH=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pick-only) PICK_ONLY=1; shift ;;
    --refresh) FORCE_REFRESH=1; shift ;;
    -h|--help)
      cat <<USAGE
Usage: ./run-next-story.sh [--pick-only] [--refresh]

--pick-only  only select candidate, do not run full pipeline
--refresh    force monthly refresh inside meeting-ref stage
USAGE
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

export NEXT_STORY_SKIP_REFRESH=$([[ "$FORCE_REFRESH" -eq 1 ]] && echo 0 || echo 1)
export NEXT_STORY_PICK_ONLY="$PICK_ONLY"

# Keep Grey-prefixed mirrors for consistency with other reporter env conventions.
export GREY_SKIP_MONTHLY_REFRESH="${NEXT_STORY_SKIP_REFRESH}"
export GREY_NEXT_STORY_PICK_ONLY="${NEXT_STORY_PICK_ONLY}"
export PYA_COMMAND_TIMEOUT_MS="${PYA_COMMAND_TIMEOUT_MS:-28800000}"
export GREY_AUTOPUBLISH="${GREY_AUTOPUBLISH:-0}"
if [[ "${GREY_AUTOPUBLISH}" == "1" || "${GREY_AUTOPUBLISH}" == "true" || "${GREY_AUTOPUBLISH}" == "yes" ]]; then
  export PIPELINE_SKIP_POST=0
else
  export PIPELINE_SKIP_POST=1
fi

if [[ -z "${MEETING_PUBLISH_AUTH_TOKEN:-}" ]]; then
  for ENV_FILE in "$SCRIPT_DIR/.env" "/home/htaf/pyash/.env" "/home/htaf/pyash/world/house/owen-sound-reporter/.env"; do
    if [[ -f "$ENV_FILE" ]]; then
      TOKEN="$(grep '^MEETING_PUBLISH_AUTH_TOKEN=' "$ENV_FILE" | cut -d= -f2- | tr -d '\r\n' || true)"
      if [[ -n "$TOKEN" ]]; then
        export MEETING_PUBLISH_AUTH_TOKEN="$TOKEN"
        break
      fi
    fi
  done
fi

cd "$SCRIPT_DIR"
exec node "$PROGRAM_MJS"
