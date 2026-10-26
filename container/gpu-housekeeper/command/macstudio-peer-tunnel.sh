#!/usr/bin/env bash
set -euo pipefail

ssh_target="${GPU_HOUSEKEEPER_TUNNEL_SSH_TARGET:-ai@macstudio}"
local_port="${GPU_HOUSEKEEPER_TUNNEL_LOCAL_PORT:-8091}"
remote_port="${GPU_HOUSEKEEPER_TUNNEL_REMOTE_PORT:-8090}"
bind_address="${GPU_HOUSEKEEPER_TUNNEL_BIND_ADDRESS:-}"

if [[ -z "$bind_address" ]]; then
  bridge_config="$(docker network inspect bridge --format '{{json .IPAM.Config}}')"
  bind_address="$(jq -r '.[] | select(.Subnet | contains(":" ) | not) | .Gateway' <<<"$bridge_config" | head -n 1)"
fi

if [[ ! "$bind_address" =~ ^[0-9.]+$ ]]; then
  echo "Could not determine an IPv4 Docker bridge gateway for the Housekeeper tunnel." >&2
  exit 2
fi

exec ssh -N \
  -o BatchMode=yes \
  -o ExitOnForwardFailure=yes \
  -o ServerAliveInterval=30 \
  -o ServerAliveCountMax=3 \
  -o ConnectTimeout=10 \
  -L "${bind_address}:${local_port}:127.0.0.1:${remote_port}" \
  "$ssh_target"
