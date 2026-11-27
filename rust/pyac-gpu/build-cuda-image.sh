#!/usr/bin/env bash
# Deprecated: the CUDA image build now runs inside Docker.
# Use container/pyac-vliw-runtime/command/build.sh, optionally with mriczo deploy.
set -euo pipefail
exec bash "$(dirname "$0")/../../container/pyac-vliw-runtime/command/build.sh" "$@"
