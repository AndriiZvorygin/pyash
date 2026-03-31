#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROGRAM_MJS="program/run-next-unposted-story.mjs"
MEETING_RUNNER_MJS="program/run-grey-county-meeting-from-ref.mjs"
MEETINGS_DIR_REL="artifacts/grey-county/meetings"

PICK_ONLY=0
FORCE_REFRESH=0
FORCE_PREP=0
FORCE_FULL=0
SKIP_PREP=0
SKIP_FULL=0
SKIP_IMAGE=0
POST_OVERRIDE=""
LIST_ONLY=0
MEETING_SELECTOR=""

print_meetings_list() {
  local meetings_dir="$SCRIPT_DIR/$MEETINGS_DIR_REL"
  if [[ ! -d "$meetings_dir" ]]; then
    echo "No meetings directory: $meetings_dir" >&2
    return 1
  fi

  local i=0
  local d
  for d in "$meetings_dir"/*; do
    [[ -d "$d" ]] || continue
    i=$((i + 1))
    local base
    base="$(basename "$d")"
    local meeting_json="$d/meeting.json"
    local transcript_dir="$d/transcript"
    local stage="new"
    local ref=""
    local meeting_id=""
    local meeting_url=""

    if [[ -f "$meeting_json" ]]; then
      if command -v node >/dev/null 2>&1; then
        meeting_id="$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j?.payload?.meeting_id||""));}catch{}' "$meeting_json" 2>/dev/null || true)"
        meeting_url="$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j?.payload?.meeting_url||""));}catch{}' "$meeting_json" 2>/dev/null || true)"
      fi
      if [[ -n "$meeting_id" ]]; then
        ref="${meeting_id:0:8}"
      elif [[ -n "$meeting_url" ]]; then
        ref="$meeting_url"
      fi
    fi
    [[ -n "$ref" ]] || ref="$base"

    if [[ -f "$transcript_dir/meeting-qwen-auto-normalized.lemmy-post.meeting-publish.response.json" ]] && \
       rg -q '"ok"\s*:\s*true' "$transcript_dir/meeting-qwen-auto-normalized.lemmy-post.meeting-publish.response.json"; then
      stage="published"
    elif [[ -f "$transcript_dir/meeting-qwen-auto-normalized.full-pipeline.report.json" ]]; then
      stage="pipeline-done"
    elif [[ -f "$transcript_dir/meeting-qwen-auto-normalized.sentences.speaker.sentence.srt" ]]; then
      stage="speaker-labeled"
    elif [[ -f "$transcript_dir/meeting-qwen-auto-normalized.sentences.merged.srt" ]]; then
      stage="transcribed"
    elif [[ -f "$transcript_dir/meeting-audio.opus" || -f "$transcript_dir/meeting-audio.wav" || -f "$transcript_dir/meeting-audio.mp3" || -f "$transcript_dir/meeting-audio.m4a" ]]; then
      stage="audio-ready"
    elif [[ -d "$d/source" || -d "$d/converted" ]]; then
      stage="workspace-prepped"
    fi

    printf "%3d  %-40s  %-14s  %s\n" "$i" "$base" "$stage" "$ref"
  done
}

resolve_meeting_selector() {
  local selector="$1"
  local meetings_dir="$SCRIPT_DIR/$MEETINGS_DIR_REL"
  local i=0
  local d
  for d in "$meetings_dir"/*; do
    [[ -d "$d" ]] || continue
    i=$((i + 1))
    local base
    base="$(basename "$d")"
    local meeting_json="$d/meeting.json"
    local meeting_id=""
    local meeting_url=""
    if [[ -f "$meeting_json" ]] && command -v node >/dev/null 2>&1; then
      meeting_id="$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j?.payload?.meeting_id||""));}catch{}' "$meeting_json" 2>/dev/null || true)"
      meeting_url="$(node -e 'const fs=require("fs");try{const j=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));process.stdout.write(String(j?.payload?.meeting_url||""));}catch{}' "$meeting_json" 2>/dev/null || true)"
    fi
    local id8=""
    [[ -n "$meeting_id" ]] && id8="${meeting_id:0:8}"

    if [[ "$selector" =~ ^[0-9]+$ ]] && [[ "$i" -eq "$selector" ]]; then
      if [[ -n "$meeting_url" ]]; then echo "$meeting_url"; return 0; fi
      if [[ -n "$id8" ]]; then echo "$id8"; return 0; fi
      echo "$base"; return 0
    fi
    if [[ -n "$id8" && "$id8" == "$selector" ]]; then
      if [[ -n "$meeting_url" ]]; then echo "$meeting_url"; return 0; fi
      echo "$id8"; return 0
    fi
    if [[ "$base" == *"$selector"* ]]; then
      if [[ -n "$meeting_url" ]]; then echo "$meeting_url"; return 0; fi
      if [[ -n "$id8" ]]; then echo "$id8"; return 0; fi
      echo "$base"; return 0
    fi
  done
  return 1
}

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
    --list) LIST_ONLY=1; shift ;;
    --meeting)
      [[ $# -ge 2 ]] || { echo "Missing value for --meeting" >&2; exit 2; }
      MEETING_SELECTOR="$2"
      shift 2
      ;;
    -h|--help)
      cat <<USAGE
Usage: ./run-next-story.sh [--pick-only] [--refresh] [--force-prep] [--force-full] [--skip-prep] [--skip-full] [--skip-image] [--post|--no-post] [--list] [--meeting <id|index|folder-fragment>]

--pick-only   only select candidate, do not run full pipeline
--refresh     force monthly refresh inside meeting-ref stage
--force-prep  force prep-workspace rerun even if checkpoint exists
--force-full  force full transcript pipeline rerun even if checkpoints exist
--skip-prep   skip prep-workspace stage
--skip-full   skip full transcript pipeline stage
--skip-image  skip image generation stage
--post        publish after pipeline run (sets PIPELINE_SKIP_POST=0)
--no-post     do not publish after pipeline run (sets PIPELINE_SKIP_POST=1)
--list        list meeting workspaces and current stage
--meeting     run a specific meeting (by listed index, 8-char id, or folder fragment)
USAGE
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ "$LIST_ONLY" -eq 1 ]]; then
  print_meetings_list
  exit $?
fi

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
if [[ -n "$MEETING_SELECTOR" ]]; then
  MEETING_REF="$(resolve_meeting_selector "$MEETING_SELECTOR" || true)"
  if [[ -z "$MEETING_REF" ]]; then
    echo "No meeting matched selector: $MEETING_SELECTOR" >&2
    echo "Run ./run-next-story.sh --list to see valid identifiers." >&2
    exit 1
  fi
  exec node "$MEETING_RUNNER_MJS" "$MEETING_REF"
fi

exec node "$PROGRAM_MJS"
