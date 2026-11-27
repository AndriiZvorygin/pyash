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

network_migration_needed=false
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
    network_migration_needed=true
    if [[ "$(docker inspect --format '{{.State.Running}}' gpu-housekeeper 2>/dev/null || true)" == "true" ]]; then
      queue_payload="$(curl -fsS --max-time 3 "http://127.0.0.1:${GPU_HOUSEKEEPER_PUBLISH_PORT:-18886}/queue" 2>/dev/null || true)"
      if [[ -z "$queue_payload" ]]; then
        queue_payload="$(docker exec gpu-housekeeper python3 -c '
import json
import urllib.request

with urllib.request.urlopen("http://127.0.0.1:18886/queue", timeout=3) as response:
  print(json.dumps(json.load(response)))
' 2>/dev/null || true)"
      fi
      if [[ -z "$queue_payload" ]]; then
        echo "refusing IPv6 network migration: cannot verify the running Housekeeper queue through host or container API" >&2
        exit 1
      fi
      running_jobs="$(printf '%s' "$queue_payload" | python3 -c '
import json
import sys

queue = json.load(sys.stdin)
count = queue.get("localRunningCount")
if not isinstance(count, int):
  count = sum(
    1 for job in queue.get("jobs", [])
    if str(job.get("status", "")).lower() == "running" and not job.get("forwarded", False)
  )
print(count)
')"
      if (( running_jobs > 0 )); then
        echo "refusing IPv6 network migration: $running_jobs local Housekeeper jobs are running; retry after they finish (queued jobs are durable and will resume)" >&2
        exit 1
      fi
    fi
  fi
fi

if [[ "$network_migration_needed" == "true" ]]; then
  echo "recreating Housekeeper project network with IPv6 subnet $GPU_HOUSEKEEPER_IPV6_SUBNET"
  docker compose "${COMPOSE_ENV_ARGS[@]}" -p gpu-housekeeper -f "$COMPOSE_FILE" down
fi

docker compose "${COMPOSE_ENV_ARGS[@]}" -p gpu-housekeeper -f "$COMPOSE_FILE" up -d --build --remove-orphans
echo "gpu-housekeeper service started"
