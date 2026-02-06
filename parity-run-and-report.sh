#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

TIMEOUT_MS="${PYA_PARITY_TIMEOUT_MS:-300000}"
STATUS_PATH="${PYA_PARITY_STATUS_PATH:-documentation/parity/status.json}"
PARALLEL="${PYA_PARITY_PARALLEL:-1}"

./parity-run.sh

node -e "
const s = require('./documentation/parity/status.json');
const red = s?.parity?.red || [];
console.log('Red examples:', red.length);
for (const file of red) console.log(file);
" > /tmp/pyash-parity-red.txt

echo \"Red list written to /tmp/pyash-parity-red.txt\"
echo \"Paste that file into the chat and I will work through them.\"
