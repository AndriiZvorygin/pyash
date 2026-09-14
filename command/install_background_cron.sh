#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPOSITORY_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
# shellcheck disable=SC1091
source "$SCRIPT_DIR/pyash_background_common.sh"
pyash_background_prepare

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
printf '\n%s\n17 * * * * %s\n30 7 * * * %s\n%s\n' \
  "$begin" \
  "$REPOSITORY_ROOT/command/run_background_roadmap.sh" \
  "$REPOSITORY_ROOT/command/send_background_digest.sh" \
  "$end" >> "$filtered"
crontab "$filtered"

if [[ -w /etc/logrotate.d ]]; then
  install -m 0644 "$REPOSITORY_ROOT/configure/pyash-background.logrotate" /etc/logrotate.d/pyash-background
elif sudo -n true >/dev/null 2>&1; then
  sudo install -m 0644 "$REPOSITORY_ROOT/configure/pyash-background.logrotate" /etc/logrotate.d/pyash-background
else
  printf 'warning: could not install /etc/logrotate.d/pyash-background\n' >&2
fi
printf 'installed Pyash roadmap automation cron block\n'
