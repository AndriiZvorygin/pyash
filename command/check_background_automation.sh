#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPOSITORY_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/pyash_background_common.sh"
pyash_background_prepare

failures=0
check() {
  local label="$1"
  shift
  if "$@"; then
    printf 'PASS %s\n' "$label"
  else
    printf 'FAIL %s\n' "$label"
    failures=$((failures + 1))
  fi
}

cron_has_block() {
  local entries
  entries=$(crontab -l 2>/dev/null || true)
  [[ "$entries" == *"# BEGIN PYASH ROADMAP AUTOMATION"* ]] \
    && [[ "$entries" == *"# END PYASH ROADMAP AUTOMATION"* ]] \
    && [[ "$entries" == *"17 * * * * $REPOSITORY_ROOT/command/run_background_roadmap.sh"* ]] \
    && [[ "$entries" == *"30 7 * * * $REPOSITORY_ROOT/command/send_background_digest.sh"* ]]
}

mailserver_available() {
  docker ps --format '{{.Names}}' | grep -Fxq "${PYA_WORK_MAIL_CONTAINER:-mailserver}"
}

check "environment directory permissions" test "$(stat -c '%a' "$(dirname "$PYASH_BACKGROUND_ENV")")" = 700
check "environment file permissions" test "$(stat -c '%a' "$PYASH_BACKGROUND_ENV")" = 600
check "Node executable" test -x "$PYA_NODE_BIN"
check "Codex executable" test -x "$PYA_CODEX_BIN"
check "Docker Mailserver" mailserver_available
check "git identity" test -n "$(git -C "$REPOSITORY_ROOT" config --get user.name)" -a -n "$(git -C "$REPOSITORY_ROOT" config --get user.email)"
check "clean primary checkout" test -z "$(git -C "$REPOSITORY_ROOT" status --porcelain)"
check "automation branch" git -C "$REPOSITORY_ROOT" show-ref --verify --quiet "refs/heads/${PYA_AUTOMATION_BRANCH:-automation/roadmap}"
check "scheduler health readable" test -r "$REPOSITORY_ROOT/world/holding/work/artifacts/scheduler-health.pya"
check "daily recipient configured" test -n "${PYA_WORK_EMAIL_REPORT:-}"
check "cron block installed" cron_has_block

exec 9>"$PYASH_BACKGROUND_LOCK"
if flock -n 9; then
  printf 'PASS lock available\n'
else
  printf 'INFO lock currently owned by another process\n'
fi

if "$PYA_NODE_BIN" --input-type=module - <<'EOF'
import { readCodexCapacity } from "./program/runtime/work/capacity.mjs";
const capacity = await readCodexCapacity({ timeoutMs: 20000 });
if (capacity.weekly?.identified !== true) process.exit(1);
console.log(`weekly capacity readable: ${capacity.weekly.remainingPercent}% remaining`);
EOF
then
  printf 'PASS Codex weekly capacity readable\n'
else
  printf 'FAIL Codex weekly capacity readable\n'
  failures=$((failures + 1))
fi

exit "$failures"
