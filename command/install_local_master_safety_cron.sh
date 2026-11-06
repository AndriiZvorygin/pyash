#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPOSITORY_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
RUNNER="$REPOSITORY_ROOT/command/run_local_master_safety.sh"
BEGIN='# BEGIN PYASH LOCAL MASTER SAFETY'
END='# END PYASH LOCAL MASTER SAFETY'

[[ -x "$RUNNER" ]] || { printf 'runner is not executable: %s\n' "$RUNNER" >&2; exit 1; }
temporary=$(mktemp)
filtered=$(mktemp)
trap 'rm -f "$temporary" "$filtered"' EXIT
crontab -l > "$temporary" 2>/dev/null || :
awk -v begin="$BEGIN" -v end="$END" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
' "$temporary" > "$filtered"
printf '\n%s\n0 4 * * * %s\n%s\n' \
  "$BEGIN" "$RUNNER" "$END" >> "$filtered"
crontab "$filtered"
printf 'installed daily 04:00 local master safety cron entry\nrunner: %s\n' "$RUNNER"
