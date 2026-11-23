#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../../.."
host="${1:?expected swac or mriczo}"
image="${2:?expected a locally built CUDA image}"
[[ "$host" == swac || "$host" == mriczo ]] || exit 2
image_id="$(docker image inspect --format '{{.Id}}' "$image")"
[[ "$image_id" == sha256:* ]] || exit 2

on_host() {
  if [[ "$host" == swac ]]; then
    ssh -x -o BatchMode=yes swac bash -s -- "$@"
  else
    bash -s -- "$@"
  fi
}

switch_runtime() {
  on_host "$1" "$image_id" <<'REMOTE'
set -euo pipefail
action="$1"
image="$2"
name=pyac-vliw-runtime
backup=pyac-vliw-runtime-cuda-canary-previous
url=http://127.0.0.1:18886
control() {
  curl --fail-with-body -sS --max-time "$2" -H 'Content-Type: application/json' \
    -d '{"runtimeName":"vliw"}' "$url/runtime/$1"
  echo
}
health() {
  timeout 3 docker exec gpu-housekeeper python3 -c 'import json, urllib.request
result = json.load(urllib.request.urlopen("http://pyac-vliw-runtime:18887/health", timeout=1))
assert result["ready"] and result["protocolVersion"] == 1
print(result["backend"] if "backend" in result else "rust-gpu-vulkan")'
}
wait_ready() {
  local expected="$1" started="$2" elapsed backend
  while (( $(date +%s%3N) - started < 60000 )); do
    backend="$(health 2>/dev/null || true)"
    elapsed=$(( $(date +%s%3N) - started ))
    if [[ "$backend" == "$expected" ]] && (( elapsed < 60000 )); then
      printf 'ready backend=%s elapsed_ms=%d\n' "$backend" "$elapsed"
      return
    fi
    if [[ "$(docker inspect --format '{{.State.Status}}' "$name")" != running ]]; then
      break
    fi
    sleep 0.2
  done
  docker logs --tail 35 "$name" >&2 || true
  echo "VLIW worker did not report $expected readiness within 60 seconds" >&2
  return 1
}
case "$action" in
  check)
    docker inspect --format 'prior image={{.Image}} state={{.State.Status}}' "$name"
    if docker inspect "$backup" >/dev/null 2>&1; then
      echo "Existing VLIW rollback container found; not changing the route" >&2
      exit 1
    fi
    curl -fsS --max-time 4 "$url/snapshot" | python3 -c \
      'import json, sys; assert json.load(sys.stdin)["capabilities"]["pyacVliwRuntimeProtocol"] == 1'
    cache_dir="$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/service/artifacts"}}{{.Source}}{{end}}{{end}}' "$name")"
    if [[ -z "$cache_dir" || ! -s "$cache_dir/pyac_vliw_pipeline_cache.bin" ]]; then
      echo "Prior Vulkan cache missing; refusing to swap an unverified rollback target" >&2
      exit 1
    fi
    ;;
  switch)
    docker image inspect "$image" >/dev/null
    control stop 1900
    docker rename "$name" "$backup"
    docker create --name "$name" --network gpu-housekeeper_default \
      --label org.pyash.vliw.cuda-canary="$image" --runtime nvidia --gpus device=0 \
      --memory=1g --restart=no "$image"
    started="$(date +%s%3N)"
    docker start "$name"
    wait_ready rust-cuda-cubin "$started"
    docker logs --tail 10 "$name"
    control begin 30
    ;;
  restore)
    if docker inspect "$backup" >/dev/null 2>&1; then
      if docker inspect "$name" >/dev/null 2>&1; then
        [[ "$(docker inspect --format '{{index .Config.Labels "org.pyash.vliw.cuda-canary"}}' "$name")" == "$image" ]]
        docker stats --no-stream --format 'canary memory={{.MemUsage}}' "$name" || true
        control stop 1900
        docker logs --tail 20 "$name"
        docker rm "$name"
      fi
      docker rename "$backup" "$name"
    fi
    started="$(date +%s%3N)"
    docker start "$name"
    wait_ready rust-gpu-vulkan "$started"
    control begin 30
    docker inspect --format 'restored image={{.Image}}' "$name"
    ;;
  *) exit 2 ;;
esac
REMOTE
}

switch_runtime check
if [[ "$host" == swac ]]; then
  docker save "$image" | ssh -x -o BatchMode=yes swac docker load
fi

restore() {
  local exit_code=$?
  trap - EXIT
  if ! switch_runtime restore; then
    echo "Could not verify VLIW rollback on $host; check the held route before resuming it." >&2
    exit 1
  fi
  exit "$exit_code"
}
trap restore EXIT
switch_runtime switch
PYA_GPU_HOUSEKEEPER_URL="http://$host:18886" \
PYA_VLIW_CONFORMANCE_HOST="$host" \
PYA_VLIW_CONFORMANCE_BACKEND=rust-cuda-cubin \
  node command/vliw_gpu_conformance.mjs
