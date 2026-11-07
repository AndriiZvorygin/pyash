#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE_FILE="$ROOT_DIR/service/compose.gpu.yaml"
HOUSEKEEPER_ENV_FILE="${GPU_HOUSEKEEPER_ENV_FILE:-$ROOT_DIR/service/.env}"
COMPOSE_ENV_ARGS=(--env-file /dev/null)

if [[ -f "$HOUSEKEEPER_ENV_FILE" ]]; then
  COMPOSE_ENV_ARGS=(--env-file "$HOUSEKEEPER_ENV_FILE")
fi

if [[ -z "${GPU_HOUSEKEEPER_HOST_ID:-}" ]]; then
  export GPU_HOUSEKEEPER_HOST_ID="$(hostname | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9._-' || true)"
  if [[ -z "${GPU_HOUSEKEEPER_HOST_ID:-}" ]]; then
    export GPU_HOUSEKEEPER_HOST_ID="gpu-housekeeper"
  fi
fi

bridge_ipv6_ipam="$(docker network inspect bridge --format '{{json .IPAM.Config}}')"
export GPU_HOUSEKEEPER_IPV6_SUBNET="$(
  printf '%s' "$bridge_ipv6_ipam" \
    | python3 "$ROOT_DIR/command/housekeeper_ipv6_subnet.py"
)"
echo "gpu-housekeeper IPv6 subnet: $GPU_HOUSEKEEPER_IPV6_SUBNET"

if existing_network="$(docker network inspect gpu-housekeeper_default --format '{{json .}}' 2>/dev/null)"; then
  if ! printf '%s' "$existing_network" | GPU_HOUSEKEEPER_EXPECTED_IPV6_SUBNET="$GPU_HOUSEKEEPER_IPV6_SUBNET" python3 -c '
import ipaddress
import json
import os
import sys

network = json.load(sys.stdin)
expected = ipaddress.ip_network(os.environ["GPU_HOUSEKEEPER_EXPECTED_IPV6_SUBNET"])
configured = network.get("IPAM", {}).get("Config", [])
actual = next((
  ipaddress.ip_network(item["Subnet"], strict=False)
  for item in configured
  if ":" in item.get("Subnet", "")
), None)
sys.exit(0 if network.get("EnableIPv6") and actual == expected else 1)
'; then
    if [[ "$(docker inspect --format '{{.State.Running}}' gpu-housekeeper 2>/dev/null || true)" == "true" ]]; then
      if ! queue_payload="$(curl -fsS --max-time 3 "http://127.0.0.1:${GPU_HOUSEKEEPER_PUBLISH_PORT:-18886}/queue")"; then
        echo "refusing IPv6 network migration: cannot verify the running Housekeeper queue" >&2
        exit 1
      fi
      pending_jobs="$(printf '%s' "$queue_payload" | python3 -c '
import json
import sys

jobs = json.load(sys.stdin).get("jobs", [])
pending = {"queued", "running", "starting", "submitted"}
print(sum(1 for job in jobs if str(job.get("status", "")).lower() in pending))
')"
      if (( pending_jobs > 0 )); then
        echo "refusing IPv6 network migration: $pending_jobs Housekeeper jobs are queued or running; retry after they finish" >&2
        exit 1
      fi
    fi
  fi
fi

docker compose "${COMPOSE_ENV_ARGS[@]}" -p gpu-housekeeper -f "$COMPOSE_FILE" up -d --build --remove-orphans
echo "gpu-housekeeper service started"
