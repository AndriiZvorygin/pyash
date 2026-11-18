#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/container/pyac-vliw-runtime/compose.yaml"
HOUSEKEEPER_ENV_FILE="${GPU_HOUSEKEEPER_ENV_FILE:-$ROOT_DIR/container/gpu-housekeeper/service/.env}"
HOUSEKEEPER_URL="${GPU_HOUSEKEEPER_URL:-http://127.0.0.1:18886}"
IMAGE_NAME="liberit/pyac-vliw-runtime:latest"
previous_image_id="$(docker inspect --format '{{.Image}}' pyac-vliw-runtime 2>/dev/null || true)"
rollback_tag=""
dispatch_held=0
deployment_started=0
COMPOSE_ENV_ARGS=(--env-file /dev/null)
if [[ -f "$HOUSEKEEPER_ENV_FILE" ]]; then
  COMPOSE_ENV_ARGS=(--env-file "$HOUSEKEEPER_ENV_FILE")
fi

compose() {
  docker compose "${COMPOSE_ENV_ARGS[@]}" -p pyac-vliw-runtime -f "$COMPOSE_FILE" "$@"
}

recover_runtime() {
  local exit_code=$?
  trap - EXIT
  if (( dispatch_held == 1 )); then
    if (( exit_code != 0 && deployment_started == 1 )); then
      if [[ -n "$rollback_tag" ]]; then
        echo "VLIW runtime update failed; restoring the previous image." >&2
        if docker tag "$rollback_tag" "$IMAGE_NAME" \
          && compose up -d --no-deps --force-recreate --no-build pyac-vliw-runtime \
          && curl -fsS --max-time 120 -X POST \
            -H 'Content-Type: application/json' \
            --data '{"runtimeName":"vliw"}' \
            "$HOUSEKEEPER_URL/runtime/begin" >/dev/null; then
          dispatch_held=0
          docker image rm "$rollback_tag" >/dev/null 2>&1 || true
          echo "Previous Rust VLIW runtime restored; queued VLIW work resumed." >&2
        else
          echo "Rollback could not be verified; VLIW dispatch remains held for recovery." >&2
        fi
      else
        echo "No prior runtime image is available to roll back; VLIW dispatch remains held for recovery." >&2
      fi
    else
      curl -fsS --max-time 120 -X POST \
        -H 'Content-Type: application/json' \
        --data '{"runtimeName":"vliw"}' \
        "$HOUSEKEEPER_URL/runtime/begin" >/dev/null || true
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

dispatch_held=1
curl -fsS --max-time 1900 -X POST \
  -H 'Content-Type: application/json' \
  --data '{"runtimeName":"vliw"}' \
  "$HOUSEKEEPER_URL/runtime/stop" >/dev/null

deployment_started=1
compose up -d --no-deps --force-recreate --no-build pyac-vliw-runtime

curl -fsS --max-time 120 -X POST \
  -H 'Content-Type: application/json' \
  --data '{"runtimeName":"vliw"}' \
  "$HOUSEKEEPER_URL/runtime/begin"
dispatch_held=0
if [[ -n "$rollback_tag" ]]; then
  docker image rm "$rollback_tag" >/dev/null 2>&1 || true
fi
trap - EXIT

echo "Rust VLIW runtime updated; only VLIW work was drained and resumed."
