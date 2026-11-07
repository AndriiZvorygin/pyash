#!/usr/bin/env bash
set -euo pipefail

BEGIN='# BEGIN PYASH LOCAL MASTER SAFETY'
END='# END PYASH LOCAL MASTER SAFETY'
temporary=$(mktemp)
filtered=$(mktemp)
trap 'rm -f "$temporary" "$filtered"' EXIT
crontab -l > "$temporary" 2>/dev/null || :
awk -v begin="$BEGIN" -v end="$END" '
  $0 == begin { skip = 1; next }
  $0 == end { skip = 0; next }
  !skip { print }
' "$temporary" > "$filtered"
crontab "$filtered"
printf 'removed the Pyash local master safety cron block; all other entries preserved\n'
