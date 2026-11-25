#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."

usage() {
  printf 'usage: %s [swac|mriczo] [verify|deploy]\n' "$0" >&2
  exit 2
}
host="${1:-}"
mode="${2:-verify}"
if [[ $# -gt 0 ]]; then
  case "$host" in swac | mriczo) ;; *) usage ;; esac
  case "$mode" in verify | deploy) ;; *) usage ;; esac
fi

command -v docker >/dev/null 2>&1 || {
  printf 'build: docker is required\n' >&2
  exit 2
}
[[ -x /usr/local/cuda/bin/ptxas ]] || {
  printf 'build: /usr/local/cuda/bin/ptxas is required (CUDA 12.8 on the build host)\n' >&2
  exit 2
}

revision="$(git rev-parse HEAD)"
checkout=clean
[[ -z "$(git status --porcelain --untracked-files=no)" ]] || checkout=dirty
base="liberit/pyac-vliw-runtime:cuda-sm86-build-${revision:0:12}"

DOCKER_BUILDKIT=1 docker build \
  --network=host \
  --file container/pyac-vliw-runtime/Dockerfile.cuda \
  --target runtime \
  --build-context "cuda-tools=/usr/local/cuda/bin" \
  --build-arg "SOURCE_REVISION=$revision" \
  --build-arg "SOURCE_CHECKOUT=$checkout" \
  --tag "$base" \
  .

container="$(docker create "$base")"
metadata="$(mktemp)"
trap 'rm -f "$metadata"' EXIT
docker cp "$container:/service/cubin.metadata.pya" "$metadata" >/dev/null
docker rm "$container" >/dev/null

cubin_sha="$(sed -n 's/^.*su name cubin sha256 ob text "\([0-9a-f]\{64\}\)" be text ya$/\1/p' "$metadata")"
if [[ -z "$cubin_sha" ]]; then
  printf 'build: could not read the cubin hash from the image metadata\n' >&2
  exit 1
fi
image="liberit/pyac-vliw-runtime:cuda-sm86-${cubin_sha:0:16}"
docker tag "$base" "$image"
docker rmi "$base" >/dev/null 2>&1 || true

printf 'CUDA_IMAGE=%s\nCUBIN_SHA256=%s\nSOURCE_REVISION=%s\nSOURCE_CHECKOUT=%s\n' \
  "$image" "$cubin_sha" "$revision" "$checkout"

if [[ -n "$host" ]]; then
  bash container/pyac-vliw-runtime/command/cuda-canary.sh "$host" "$image" "$mode"
fi
