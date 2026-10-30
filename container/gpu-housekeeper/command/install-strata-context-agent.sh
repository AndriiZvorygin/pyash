#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
SERVICE_DIR="$ROOT_DIR/container/gpu-housekeeper/service"
ENV_FILE="$SERVICE_DIR/.env"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
SOCKET_PATH="$RUNTIME_DIR/pyash-strata-context-agent.sock"
UNIT_PATH="$UNIT_DIR/pyash-strata-context-agent.service"

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Missing Housekeeper environment file: $ENV_FILE" >&2
  exit 1
fi

mkdir -p "$UNIT_DIR"
cat > "$UNIT_PATH" <<EOF
[Unit]
Description=Pyash Strata context control agent
After=default.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
Environment=GPU_HOUSEKEEPER_STRATA_CONTEXT_AGENT_SOCKET=$SOCKET_PATH
ExecStart=/usr/bin/python3 $SERVICE_DIR/strata_context_agent.py
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now pyash-strata-context-agent.service
echo "Strata context agent ready at $SOCKET_PATH"
