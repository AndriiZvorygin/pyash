#!/usr/bin/env bash
# Build the CUDA runtime from the current tree and optionally deploy it through
# the canary. Prints machine-readable key=value lines on stdout.
#
# A dirty tree still builds and verifies the image, but DEPLOYED stays 0 unless
# PYA_VLIW_ALLOW_DIRTY_DEPLOY=1, because a dirty image cannot be reproduced from
# a commit.
#
# usage: build-and-deploy.sh [--deploy] [--host mriczo|swac]
set -euo pipefail
cd "$(dirname "$0")/../../.."

deploy=0
host="${PYA_VLIW_DEPLOY_HOST:-mriczo}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --deploy) deploy=1; shift ;;
    --host) host="${2:?--host needs a value}"; shift 2 ;;
    --host=*) host="${1#*=}"; shift ;;
    *) printf 'build-and-deploy: unknown argument %s\n' "$1" >&2; exit 2 ;;
  esac
done
case "$host" in mriczo | swac) ;; *) printf 'REASON=unsupported-host\n'; exit 2 ;; esac

command -v docker >/dev/null 2>&1 || { printf 'REASON=docker-missing\n'; exit 2; }
[[ -x /usr/local/cuda/bin/ptxas ]] || { printf 'REASON=ptxas-missing\n'; exit 2; }

revision="$(git rev-parse HEAD)"
checkout=clean
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || checkout=dirty

build_output="$(bash container/pyac-vliw-runtime/command/build.sh)"
printf '%s\n' "$build_output"
image="$(printf '%s\n' "$build_output" | sed -n 's/^CUDA_IMAGE=//p')"
cubin="$(printf '%s\n' "$build_output" | sed -n 's/^CUBIN_SHA256=//p')"
[[ -n "$image" ]] || { printf 'REASON=no-image\n'; exit 1; }

deployed=0
if [[ "$deploy" -eq 1 ]]; then
  if [[ "$checkout" == dirty && "${PYA_VLIW_ALLOW_DIRTY_DEPLOY:-0}" != 1 ]]; then
    printf 'SKIP=deploy (dirty tree; set PYA_VLIW_ALLOW_DIRTY_DEPLOY=1 to override)\n'
  elif bash container/pyac-vliw-runtime/command/cuda-canary.sh "$host" "$image" deploy; then
    deployed=1
  else
    printf 'REASON=canary-failed\n'
    exit 1
  fi
fi

printf 'DEPLOYED=%s\nDEPLOY_HOST=%s\nSOURCE_REVISION=%s\nSOURCE_CHECKOUT=%s\nCUBIN_SHA256=%s\n' \
  "$deployed" "$host" "$revision" "$checkout" "$cubin"
