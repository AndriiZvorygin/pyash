#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAM_MJS="program/run-next-unposted-story.mjs"

PICK_ONLY=0
FORCE_REFRESH=0
FORCE_PREP=0
FORCE_FULL=0
SKIP_PREP=0
SKIP_FULL=0
SKIP_IMAGE=0
POST_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pick-only) PICK_ONLY=1; shift ;;
    --refresh) FORCE_REFRESH=1; shift ;;
    --force-prep) FORCE_PREP=1; shift ;;
    --force-full) FORCE_FULL=1; shift ;;
    --skip-prep) SKIP_PREP=1; shift ;;
    --skip-full) SKIP_FULL=1; shift ;;
    --skip-image) SKIP_IMAGE=1; shift ;;
    --post) POST_OVERRIDE="post"; shift ;;
    --no-post) POST_OVERRIDE="no-post"; shift ;;
    -h|--help)
      cat <<USAGE
Usage: ./run-next-story.sh [--pick-only] [--refresh] [--force-prep] [--force-full] [--skip-prep] [--skip-full] [--skip-image] [--post|--no-post]

--pick-only   only select candidate, do not run full pipeline
--refresh     force monthly refresh inside meeting-ref stage
--force-prep  force prep-workspace rerun even if checkpoint exists
--force-full  force full transcript pipeline rerun even if checkpoints exist
--skip-prep   skip prep-workspace stage
--skip-full   skip full transcript pipeline stage
--skip-image  skip image generation stage
--post        publish after pipeline run (sets PIPELINE_SKIP_POST=0)
--no-post     do not publish after pipeline run (sets PIPELINE_SKIP_POST=1)
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
export GREY_PREP_FORCE="$FORCE_PREP"
export GREY_PIPELINE_FORCE="$FORCE_FULL"
export GREY_PIPELINE_SKIP_PREP="$SKIP_PREP"
export GREY_PIPELINE_SKIP_FULL="$SKIP_FULL"
export GREY_PIPELINE_SKIP_IMAGE="$SKIP_IMAGE"
export GREY_AUTOPUBLISH="${GREY_AUTOPUBLISH:-0}"
case "$POST_OVERRIDE" in
  post)
    export GREY_AUTOPUBLISH=1
    export PIPELINE_SKIP_POST=0
    ;;
  no-post)
    export GREY_AUTOPUBLISH=0
    export PIPELINE_SKIP_POST=1
    ;;
  *)
    if [[ "${GREY_AUTOPUBLISH}" == "1" || "${GREY_AUTOPUBLISH}" == "true" || "${GREY_AUTOPUBLISH}" == "yes" ]]; then
      export PIPELINE_SKIP_POST=0
    else
      export PIPELINE_SKIP_POST=1
    fi
    ;;
esac

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
