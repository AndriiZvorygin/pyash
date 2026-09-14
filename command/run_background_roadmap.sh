#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/pyash_background_common.sh"
pyash_background_prepare

log_file="$PYA_BACKGROUND_LOG_DIR/background-roadmap.log"
if [[ "${PYA_BACKGROUND_EXECUTION_BLOCKED:-}" =~ ^(truth|true|yes|1|y)$ ]]; then
  pyash_background_log "roadmap execution gate: infrastructure preflight required" >> "$log_file"
fi
exec 9>"$PYASH_BACKGROUND_LOCK"
if ! flock -n 9; then
  pyash_background_log "roadmap skipped: another Pyash background process owns $PYASH_BACKGROUND_LOCK" >> "$log_file"
  exit 0
fi

pyash_background_log "roadmap start" >> "$log_file"
if "$PYA_NODE_BIN" command/work_supervisor.mjs background --repository "$PYASH_BACKGROUND_REPOSITORY" >> "$log_file" 2>&1; then
  status=0
else
  status=$?
fi
pyash_background_log "roadmap finish status=$status" >> "$log_file"
exit "$status"
