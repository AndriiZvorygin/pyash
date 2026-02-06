#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

TIMEOUT_MS="${PYA_PARITY_TIMEOUT_MS:-300000}"
STATUS_PATH="${PYA_PARITY_STATUS_PATH:-documentation/parity/status.json}"
PARALLEL="${PYA_PARITY_PARALLEL:-1}"

node command/run_parity_examples.mjs \
  --timeout-ms "$TIMEOUT_MS" \
  --status "$STATUS_PATH" \
  --parallel "$PARALLEL" \
  --include-mind \
  --include-say \
  --include-command
