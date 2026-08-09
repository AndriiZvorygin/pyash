#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/pyash_background_common.sh"
pyash_background_prepare

log_file="$PYA_BACKGROUND_LOG_DIR/background-digest.log"
exec 9>"$PYASH_BACKGROUND_LOCK"
if ! flock -n 9; then
  pyash_background_log "digest skipped: another Pyash background process owns $PYASH_BACKGROUND_LOCK" >> "$log_file"
  exit 0
fi
if [[ -z "${PYA_WORK_EMAIL_REPORT:-}" ]]; then
  pyash_background_log "digest failed: PYA_WORK_EMAIL_REPORT is not configured" >> "$log_file"
  exit 1
fi

pyash_background_log "digest start" >> "$log_file"
if "$PYA_NODE_BIN" command/work_supervisor.mjs digest \
  --repository "$PYASH_BACKGROUND_REPOSITORY" \
  --email-report "$PYA_WORK_EMAIL_REPORT" >> "$log_file" 2>&1; then
  status=0
else
  status=$?
fi
pyash_background_log "digest finish status=$status" >> "$log_file"
exit "$status"
