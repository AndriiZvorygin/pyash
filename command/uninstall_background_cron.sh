#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
begin="# BEGIN PYASH ROADMAP AUTOMATION"
end="# END PYASH ROADMAP AUTOMATION"
temporary=$(mktemp)
filtered=$(mktemp)
trap 'unlink "$temporary" "$filtered" 2>/dev/null || true' EXIT
if ! crontab -l > "$temporary" 2>/dev/null; then
  : > "$temporary"
fi
awk -v begin="$begin" -v end="$end" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
' "$temporary" > "$filtered"
crontab "$filtered"
if [[ -w /etc/logrotate.d ]]; then
  rm -f /etc/logrotate.d/pyash-background
elif sudo -n true >/dev/null 2>&1; then
  sudo rm -f /etc/logrotate.d/pyash-background
fi
printf 'removed Pyash roadmap automation cron block; durable work state was left intact\n'
