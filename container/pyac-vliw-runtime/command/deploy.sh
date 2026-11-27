#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/container/pyac-vliw-runtime/compose.yaml"
HOUSEKEEPER_ENV_FILE="${GPU_HOUSEKEEPER_ENV_FILE:-$ROOT_DIR/container/gpu-housekeeper/service/.env}"
HOUSEKEEPER_URL="${GPU_HOUSEKEEPER_URL:-http://127.0.0.1:18886}"
IMAGE_NAME="liberit/pyac-vliw-runtime:latest"
ARTIFACT_DIR="${HOME}/.local/share/pyash/pyac-vliw"
PIPELINE_CACHE_FILE="$ARTIFACT_DIR/pyac_vliw_pipeline_cache.bin"
PIPELINE_BUILD_LOG="$ARTIFACT_DIR/pipeline-cache-build.log"
ROLLBACK_CACHE_FILE="$ARTIFACT_DIR/.rollback-pipeline-cache.bin"
previous_image_id="$(docker inspect --format '{{.Image}}' pyac-vliw-runtime 2>/dev/null || true)"
rollback_tag=""
dispatch_held=0
cache_backup=0
READY_TIMEOUT_SEC=60
export PYAC_VLIW_ARTIFACT_DIR="$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"
COMPOSE_ENV_ARGS=(--env-file /dev/null)
if [[ -f "$HOUSEKEEPER_ENV_FILE" ]]; then
  COMPOSE_ENV_ARGS=(--env-file "$HOUSEKEEPER_ENV_FILE")
fi

compose() {
  docker compose "${COMPOSE_ENV_ARGS[@]}" -p pyac-vliw-runtime -f "$COMPOSE_FILE" "$@"
}

wait_runtime_ready() {
  local deadline=$((SECONDS + READY_TIMEOUT_SEC))
  local status="unknown"
  while (( SECONDS < deadline )); do
    status="$(curl -fsS --max-time 2 "$HOUSEKEEPER_URL/snapshot" 2>/dev/null \
      | python3 -c '
import json
import sys

try:
  snapshot = json.load(sys.stdin)
except Exception:
  snapshot = {}
runtimes = snapshot.get("runtimes") if isinstance(snapshot.get("runtimes"), list) else []
runtime = next((item for item in runtimes if item.get("runtimeName") == "vliw"), {})
print(runtime.get("status", "unknown"))
' 2>/dev/null || echo unknown)"
    if [[ "$status" == "running" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "Rust VLIW runtime did not become ready within ${READY_TIMEOUT_SEC}s (last status: ${status})." >&2
  return 1
}

recover_runtime() {
  local exit_code=$?
  trap - EXIT
  if (( dispatch_held == 1 )); then
    if (( exit_code != 0 )); then
      if [[ -n "$rollback_tag" ]] && (( cache_backup == 1 )); then
        echo "VLIW runtime update failed; restoring the previous image." >&2
        mv -f "$ROLLBACK_CACHE_FILE" "$PIPELINE_CACHE_FILE"
        if docker tag "$rollback_tag" "$IMAGE_NAME" \
          && compose up -d --no-deps --force-recreate --no-build pyac-vliw-runtime \
          && wait_runtime_ready \
          && curl -fsS --max-time 30 -X POST \
            -H 'Content-Type: application/json' \
            --data '{"runtimeName":"vliw"}' \
            "$HOUSEKEEPER_URL/runtime/begin" >/dev/null; then
          dispatch_held=0
          docker image rm "$rollback_tag" >/dev/null 2>&1 || true
          if (( cache_backup == 1 )); then
            rm -f "$ROLLBACK_CACHE_FILE"
          fi
          echo "Previous Rust VLIW runtime restored; queued VLIW work resumed." >&2
        else
          echo "Rollback could not be verified; VLIW dispatch remains held for recovery." >&2
        fi
      else
        echo "No verified prior runtime image and pipeline artifact are available; VLIW dispatch remains held for recovery." >&2
      fi
    else
      curl -fsS --max-time 120 -X POST \
        -H 'Content-Type: application/json' \
        --data '{"runtimeName":"vliw"}' \
        "$HOUSEKEEPER_URL/runtime/begin" >/dev/null || true
      if (( cache_backup == 1 )); then
        rm -f "$ROLLBACK_CACHE_FILE"
      fi
    fi
  fi
  exit "$exit_code"
}
trap recover_runtime EXIT

compose build pyac-vliw-runtime

# Create the stopped container before the Housekeeper route is upgraded. This
# reserves no GPU work and lets the Housekeeper update expose a valid target.
if ! docker inspect pyac-vliw-runtime >/dev/null 2>&1; then
  compose create pyac-vliw-runtime
fi

snapshot_json="$(curl -fsS --max-time 5 "$HOUSEKEEPER_URL/snapshot" 2>/dev/null || true)"
runtime_protocol="$(printf '%s' "$snapshot_json" | python3 -c '
import json
import sys

try:
  value = json.load(sys.stdin)
except Exception:
  value = {}
capabilities = value.get("capabilities") if isinstance(value.get("capabilities"), dict) else {}
print(capabilities.get("pyacVliwRuntimeProtocol", ""))
' 2>/dev/null || true)"
if [[ "$runtime_protocol" != "1" ]]; then
  trap - EXIT
  echo "VLIW runtime image built and container prepared. Housekeeper does not advertise VLIW runtime protocol v1; upgrade its route, then rerun this script." >&2
  exit 0
fi

if [[ -n "$previous_image_id" ]]; then
  rollback_tag="liberit/pyac-vliw-runtime:rollback-$(date +%s)"
  docker tag "$previous_image_id" "$rollback_tag"
fi
if [[ -s "$PIPELINE_CACHE_FILE" ]]; then
  cp "$PIPELINE_CACHE_FILE" "$ROLLBACK_CACHE_FILE"
  cache_backup=1
fi

dispatch_held=1
curl -fsS --max-time 1900 -X POST \
  -H 'Content-Type: application/json' \
  --data '{"runtimeName":"vliw"}' \
  "$HOUSEKEEPER_URL/runtime/stop" >/dev/null

compose --profile build-artifact run --rm --no-deps pyac-vliw-pipeline-compiler 2>&1 | tee "$PIPELINE_BUILD_LOG"
if [[ ! -s "$ARTIFACT_DIR/pyac_vliw_pipeline_cache.bin" ]]; then
  echo "GPU pipeline compiler did not produce the required on-disk artifact." >&2
  exit 1
fi

compose up -d --no-deps --force-recreate --no-build pyac-vliw-runtime
wait_runtime_ready

curl -fsS --max-time 30 -X POST \
  -H 'Content-Type: application/json' \
  --data '{"runtimeName":"vliw"}' \
  "$HOUSEKEEPER_URL/runtime/begin"
dispatch_held=0
if [[ -n "$rollback_tag" ]]; then
  docker image rm "$rollback_tag" >/dev/null 2>&1 || true
fi
if (( cache_backup == 1 )); then
  rm -f "$ROLLBACK_CACHE_FILE"
fi
trap - EXIT

echo "Rust VLIW runtime updated; only VLIW work was drained and resumed."
