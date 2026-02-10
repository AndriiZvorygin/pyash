#!/usr/bin/env bash
set -euo pipefail

# ====== CONFIG ======
ROOT_DIR="${ROOT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
AGENT_NAME="${AGENT_NAME:-automation-agent}"
WORLD_DIR="${WORLD_DIR:-$ROOT_DIR/world}"
AGENT_HOUSE="${AGENT_HOUSE:-$WORLD_DIR/house/$AGENT_NAME}"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%d-%H%M%S)-$AGENT_NAME}"
ARTIFACT_DIR="${ARTIFACT_DIR:-$AGENT_HOUSE/artifacts/$RUN_ID}"
LOCK_FILE="${LOCK_FILE:-$AGENT_HOUSE/.run.lock}"
LOG_FILE="${LOG_FILE:-$ARTIFACT_DIR/run.log}"
SUMMARY_FILE="${SUMMARY_FILE:-$ARTIFACT_DIR/summary.txt}"
ALERT_CMD="${ALERT_CMD:-}"

# ====== FLAGS ======
NO_OP=false
for arg in "$@"; do
  if [ "$arg" = "--no-op" ]; then
    NO_OP=true
  fi
done

# ====== PREP ======
mkdir -p "$ARTIFACT_DIR"

# ====== LOCK ======
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "Another run is in progress; exiting." | tee -a "$LOG_FILE"
  exit 0
fi

# ====== HELPERS ======
ALERT_REASONS=()
add_alert_reason() { ALERT_REASONS+=("$1"); }

send_alert_once() {
  if [ "${#ALERT_REASONS[@]}" -eq 0 ]; then
    return 0
  fi
  local subject="Automation Alert"
  local text="Automation run detected:\n"
  for reason in "${ALERT_REASONS[@]}"; do
    text+="- ${reason}\n"
  done
  if [ -n "$ALERT_CMD" ]; then
    ALERT_SUBJECT="$subject" ALERT_TEXT="$(printf "%b" "$text")" eval "$ALERT_CMD" || true
  else
    echo -e "$subject\n$text" >> "$LOG_FILE"
  fi
}

preflight() {
  command -v node >/dev/null 2>&1 || { echo "node not found"; exit 1; }
}

do_work() {
  echo "Running automation for agent: $AGENT_NAME" | tee -a "$LOG_FILE"
  echo "run_id=$RUN_ID" | tee -a "$LOG_FILE"
  echo "artifact_dir=$ARTIFACT_DIR" | tee -a "$LOG_FILE"
  # TODO: Replace with your actual work stages.
  # Suggested parity baseline:
  # node command/run_parity_examples.mjs --status "$ARTIFACT_DIR/status-before.json"
  if [ "$NO_OP" = "true" ]; then
    echo "NO-OP mode enabled" | tee -a "$LOG_FILE"
  fi
  printf "run_id=%s\nstatus=ok\n" "$RUN_ID" > "$SUMMARY_FILE"
}

# ====== RUN ======
preflight
START_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "Start: $START_TS" | tee -a "$LOG_FILE"

do_work || add_alert_reason "Job failed"

END_TS=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
echo "End: $END_TS" | tee -a "$LOG_FILE"

send_alert_once
