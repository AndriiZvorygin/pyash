#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASE_URL="${GPU_HOUSEKEEPER_URL:-http://127.0.0.1:${GPU_HOUSEKEEPER_PUBLISH_PORT:-18886}}"
TIMEOUT_SEC="${GPU_HOUSEKEEPER_DRAIN_TIMEOUT_SEC:-3600}"
POLL_SEC="${GPU_HOUSEKEEPER_DRAIN_POLL_SEC:-5}"
drain_active=false

if [[ ! "$TIMEOUT_SEC" =~ ^[0-9]+$ || ! "$POLL_SEC" =~ ^[0-9]+$ ]] || (( POLL_SEC < 1 )); then
  echo "GPU_HOUSEKEEPER_DRAIN_TIMEOUT_SEC and GPU_HOUSEKEEPER_DRAIN_POLL_SEC must be non-negative/positive integers" >&2
  exit 2
fi

resume_on_failure() {
  local status=$?
  if [[ "$drain_active" == "true" && $status -ne 0 ]]; then
    echo "soft restart stopped before restart; resuming dispatch" >&2
    curl -fsS --max-time 3 -X POST "$BASE_URL/maintenance/resume" >/dev/null || true
  fi
  return "$status"
}
trap resume_on_failure EXIT

if ! curl -fsS --max-time 3 "$BASE_URL/health" >/dev/null; then
  echo "Housekeeper is not reachable at $BASE_URL" >&2
  exit 1
fi

drain_result="$(curl -fsS --max-time 3 -X POST "$BASE_URL/maintenance/drain")"
drain_active=true
printf '%s\n' "$drain_result" | python3 -c '
import json, sys
state = json.load(sys.stdin)
if not state.get("dispatchPaused") or state.get("acceptingJobs") is not True:
  raise SystemExit("Housekeeper did not confirm paused dispatch with job admission enabled")
'
echo "dispatch paused; waiting for active local jobs to finish (new jobs remain queued)"

started_at="$(date +%s)"
last_report=0
while true; do
  queue="$(curl -fsS --max-time 5 "$BASE_URL/queue")" || {
    echo "could not read Housekeeper queue while draining" >&2
    exit 1
  }
  read -r running queued < <(printf '%s' "$queue" | python3 -c '
import json, sys
state = json.load(sys.stdin)
print(int(state.get("localRunningCount", 0)), int(state.get("localQueuedCount", 0)))
')
  now="$(date +%s)"
  if (( running == 0 )); then
    echo "active local jobs finished; $queued accepted job(s) remain queued for restart"
    break
  fi
  if (( TIMEOUT_SEC > 0 && now - started_at >= TIMEOUT_SEC )); then
    echo "timed out with $running local job(s) still running; no restart performed" >&2
    exit 1
  fi
  if (( now - last_report >= 30 )); then
    echo "still draining: $running active, $queued queued"
    last_report=$now
  fi
  sleep "$POLL_SEC"
done

"$ROOT_DIR/command/begin.sh"

started_at="$(date +%s)"
while true; do
  if health="$(curl -fsS --max-time 5 "$BASE_URL/health" 2>/dev/null)"; then
    if printf '%s' "$health" | python3 -c '
import json, sys
state = json.load(sys.stdin)
raise SystemExit(0 if state.get("ready") and not state.get("dispatchPaused") else 1)
'; then
      drain_active=false
      echo "soft restart complete; queued jobs are dispatching again"
      exit 0
    fi
  fi
  now="$(date +%s)"
  if (( TIMEOUT_SEC > 0 && now - started_at >= TIMEOUT_SEC )); then
    echo "Housekeeper did not become ready after restart within ${TIMEOUT_SEC}s" >&2
    exit 1
  fi
  sleep "$POLL_SEC"
done
