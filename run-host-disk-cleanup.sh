#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec flock -n /tmp/pyash-host-disk-cleanup.lock node "$ROOT/command/host_disk_cleanup.mjs" "$@"
