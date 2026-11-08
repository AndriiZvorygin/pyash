#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || "$(uname -m)" != "arm64" ]]; then
  echo "This installer requires Apple Silicon macOS." >&2
  exit 2
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_SERVER="$ROOT_DIR/service/server.py"
SOURCE_KUBERNETES_RUNTIME="$ROOT_DIR/service/kubernetes_runtime.py"
APP_DIR="$HOME/Applications/Ollama.app"
OLLAMA_BIN="$APP_DIR/Contents/Resources/ollama"
INSTALL_DIR="$HOME/.local/share/pyash-gpu-housekeeper"
SERVER_PATH="$INSTALL_DIR/server.py"
STATE_DIR="$INSTALL_DIR/state"
LOG_DIR="$HOME/Library/Logs/pyash-gpu-housekeeper"
LAUNCH_AGENTS="$HOME/Library/LaunchAgents"
HOUSEKEEPER_LABEL="com.pyash.gpu-housekeeper"
HOUSEKEEPER_PLIST="$LAUNCH_AGENTS/$HOUSEKEEPER_LABEL.plist"
USER_DOMAIN="user/$(id -u)"
HOUSEKEEPER_PID_FILE="$INSTALL_DIR/housekeeper.pid"
HOUSEKEEPER_PORT="${GPU_HOUSEKEEPER_PORT:-18886}"
BIND_HOST="${GPU_HOUSEKEEPER_BIND_HOST:-127.0.0.1}"
STRATA_RUNTIME_URL="${GPU_HOUSEKEEPER_STRATA_RUNTIME_URL:-}"
STRATA_BIN="${GPU_HOUSEKEEPER_STRATA_BIN:-$HOME/.local/bin/strata}"
STRATA_MODEL="${GPU_HOUSEKEEPER_STRATA_MODEL:-ist-das-2.00bpw}"
STRATA_MEMORY_FLOOR_MB="${GPU_HOUSEKEEPER_STRATA_VRAM_REQUIRED_MB:-50000}"
STRATA_ACTION_TIMEOUT_SEC="${GPU_HOUSEKEEPER_STRATA_ACTION_TIMEOUT_SEC:-1800}"
if [[ "$BIND_HOST" == *:* ]]; then
  HOUSEKEEPER_URL="http://[$BIND_HOST]:$HOUSEKEEPER_PORT"
else
  HOUSEKEEPER_URL="http://$BIND_HOST:$HOUSEKEEPER_PORT"
fi

mkdir -p "$HOME/Applications" "$INSTALL_DIR" "$STATE_DIR" "$LOG_DIR" "$LAUNCH_AGENTS"

if [[ ! -x "$OLLAMA_BIN" ]]; then
  temp_dir="$(mktemp -d)"
  trap 'rm -rf "$temp_dir"' EXIT
  echo "Downloading official Ollama macOS bundle..."
  curl --fail --show-error --location \
    --output "$temp_dir/Ollama-darwin.zip" \
    https://ollama.com/download/Ollama-darwin.zip
  unzip -q "$temp_dir/Ollama-darwin.zip" -d "$temp_dir"
  rm -rf "$APP_DIR"
  ditto "$temp_dir/Ollama.app" "$APP_DIR"
  rm -rf "$temp_dir"
  trap - EXIT
fi

install -m 755 "$SOURCE_SERVER" "$SERVER_PATH"
install -m 644 "$SOURCE_KUBERNETES_RUNTIME" "$INSTALL_DIR/kubernetes_runtime.py"

OLLAMA_BIN="$OLLAMA_BIN" \
HOUSEKEEPER_PLIST="$HOUSEKEEPER_PLIST" \
SERVER_PATH="$SERVER_PATH" \
STATE_DIR="$STATE_DIR" \
LOG_DIR="$LOG_DIR" \
HOME_DIR="$HOME" \
HOUSEKEEPER_LABEL="$HOUSEKEEPER_LABEL" \
BIND_HOST="$BIND_HOST" \
BIND_PORT="$HOUSEKEEPER_PORT" \
STRATA_RUNTIME_URL="$STRATA_RUNTIME_URL" \
STRATA_BIN="$STRATA_BIN" \
STRATA_MODEL="$STRATA_MODEL" \
STRATA_MEMORY_FLOOR_MB="$STRATA_MEMORY_FLOOR_MB" \
STRATA_ACTION_TIMEOUT_SEC="$STRATA_ACTION_TIMEOUT_SEC" \
/usr/bin/python3 - <<'PY'
import json
import os
import plistlib

home = os.environ["HOME_DIR"]
housekeeper_label = os.environ["HOUSEKEEPER_LABEL"]
bind_host = os.environ["BIND_HOST"]
bind_port = os.environ["BIND_PORT"]
state_dir = os.environ["STATE_DIR"]
log_dir = os.environ["LOG_DIR"]
server_path = os.environ["SERVER_PATH"]

registry = [{
    "runtimeName": "ollama",
    "containerName": "",
    "runtimeMode": "native-ollama",
    "actionDriver": "native-process",
    "runtimeCommand": os.environ["OLLAMA_BIN"],
    "runtimeLogPath": os.path.join(log_dir, "ollama.log"),
    "defaultContextLength": 32768,
    "runtimeEnvironment": {
        "OLLAMA_HOST": "127.0.0.1:11434",
        "OLLAMA_NO_CLOUD": "1",
        "OLLAMA_CONTEXT_LENGTH": "32768",
        "OLLAMA_NUM_PARALLEL": "1",
        "OLLAMA_MAX_LOADED_MODELS": "1"
    },
    "gpuExpected": True,
    "activityProbe": "ollama-housekeeper",
    "dischargeKind": "ollama",
    "concurrencySafe": False,
    "modelStorePath": os.path.join(home, ".ollama", "models")
}]

strata_url = os.environ["STRATA_RUNTIME_URL"].strip()
if strata_url:
    strata_bin = os.environ["STRATA_BIN"]
    if not os.path.isfile(strata_bin) or not os.access(strata_bin, os.X_OK):
        raise SystemExit(f"Strata is configured at {strata_url}, but its CLI is not executable: {strata_bin}")
    strata_model = os.environ["STRATA_MODEL"]
    registry.append({
        "runtimeName": "strata",
        "containerName": "",
        "actionDriver": "strata-cli",
        "runtimeCommand": strata_bin,
        "runtimeActionTimeoutSec": int(os.environ["STRATA_ACTION_TIMEOUT_SEC"]),
        "beginAction": [
            "launch", "--family", "deepseek41", "--model", strata_model,
            "--context", "8192", "--vision", "off", "--yes", "--no-tui", "--access", "local", "--port", "8080"
        ],
        "stopAction": ["launch", "--stop"],
        "defaultContextLength": 8192,
        "deviceId": "apple0",
        "minimumVramRequiredMb": int(os.environ["STRATA_MEMORY_FLOOR_MB"]),
        "gpuExpected": True,
        "activityProbe": "strata-status",
        "dischargeKind": "strata",
        "concurrencySafe": False
    })

housekeeper = {
    "Label": housekeeper_label,
    "ProgramArguments": [
        "/usr/bin/python3", server_path,
        "--host", bind_host, "--also-host", "127.0.0.1",
        "--port", bind_port, "--host-id", "macstudio"
    ],
    "RunAtLoad": True,
    "KeepAlive": True,
    "EnvironmentVariables": {
        "GPU_HOUSEKEEPER_HOST_ID": "macstudio",
        "GPU_HOUSEKEEPER_DEVICE_BACKEND": "apple-unified",
        "GPU_HOUSEKEEPER_RUNTIME_REGISTRY": json.dumps(registry, separators=(",", ":")),
        "GPU_HOUSEKEEPER_ACCEPT_FORWARDED": "true",
        "GPU_HOUSEKEEPER_APPLE_MEMORY_RESERVE_MB": "8192",
        "GPU_HOUSEKEEPER_IDLE_GRACE_SEC": "300",
        "GPU_HOUSEKEEPER_OLLAMA_GPU_WATCHDOG_INTERVAL_SEC": "300",
        "GPU_HOUSEKEEPER_OLLAMA_MODEL_STORE_PATH": os.path.join(home, ".ollama", "models"),
        "GPU_HOUSEKEEPER_ALLOW_MODEL_PULL": "true",
        "GPU_HOUSEKEEPER_MODEL_ALLOWLIST": "*",
        "GPU_HOUSEKEEPER_PYA_DIR": state_dir,
        "OLLAMA_RUNTIME_URL": "http://127.0.0.1:11434",
        "OLLAMA_RUNTIME_TIMEOUT_SEC": "1800"
    },
    "StandardOutPath": os.path.join(log_dir, "housekeeper.log"),
    "StandardErrorPath": os.path.join(log_dir, "housekeeper.error.log")
}

if strata_url:
    housekeeper["EnvironmentVariables"].update({
        "GPU_HOUSEKEEPER_STRATA_RUNTIME_URL": strata_url,
        "GPU_HOUSEKEEPER_STRATA_DEVICE_ID": "apple0",
        "GPU_HOUSEKEEPER_STRATA_VRAM_REQUIRED_MB": os.environ["STRATA_MEMORY_FLOOR_MB"],
        "GPU_HOUSEKEEPER_STRATA_DEFAULT_CONTEXT_LENGTH": "8192",
        "GPU_HOUSEKEEPER_STRATA_READY_TIMEOUT_SEC": "120"
    })

for path, value in ((os.environ["HOUSEKEEPER_PLIST"], housekeeper),):
    with open(path, "wb") as handle:
        plistlib.dump(value, handle)
    os.chmod(path, 0o600)
PY

launchctl bootout "$USER_DOMAIN/$HOUSEKEEPER_LABEL" >/dev/null 2>&1 || true
if launchctl bootstrap "$USER_DOMAIN" "$HOUSEKEEPER_PLIST" >/dev/null 2>&1; then
  rm -f "$HOUSEKEEPER_PID_FILE"
  launchctl kickstart -k "$USER_DOMAIN/$HOUSEKEEPER_LABEL" >/dev/null 2>&1 || true
else
  echo "User launchd bootstrap unavailable; starting headless Housekeeper supervisor."
  if [[ -s "$HOUSEKEEPER_PID_FILE" ]]; then
    old_pid="$(cat "$HOUSEKEEPER_PID_FILE")"
    old_command="$(ps -p "$old_pid" -o command= 2>/dev/null || true)"
    if [[ "$old_command" == *"$SERVER_PATH"* ]]; then
      kill "$old_pid" 2>/dev/null || true
      for _ in $(seq 1 10); do
        kill -0 "$old_pid" 2>/dev/null || break
        sleep 1
      done
    fi
    rm -f "$HOUSEKEEPER_PID_FILE"
  fi
  runner='import os,plistlib,sys;p=plistlib.load(open(sys.argv[1],"rb"));e=os.environ.copy();e.update(p.get("EnvironmentVariables",{}));a=p["ProgramArguments"];os.execvpe(a[0],a,e)'
  nohup /usr/bin/python3 -c "$runner" "$HOUSEKEEPER_PLIST" \
    </dev/null >>"$LOG_DIR/housekeeper.log" 2>&1 &
  echo "$!" > "$HOUSEKEEPER_PID_FILE"
fi

for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:11434/api/version >/dev/null 2>&1 \
    && curl -fsS "http://127.0.0.1:$HOUSEKEEPER_PORT/health" >/dev/null 2>&1 \
    && lsof -nP -iTCP:"$HOUSEKEEPER_PORT" -sTCP:LISTEN 2>/dev/null | grep -F "$BIND_HOST" >/dev/null; then
    break
  fi
  sleep 1
done

curl -fsS http://127.0.0.1:11434/api/version >/dev/null
curl -fsS "http://127.0.0.1:$HOUSEKEEPER_PORT/health" >/dev/null
if ! lsof -nP -iTCP:"$HOUSEKEEPER_PORT" -sTCP:LISTEN 2>/dev/null | grep -F "$BIND_HOST" >/dev/null; then
  echo "Housekeeper did not listen on the configured address: $BIND_HOST:$HOUSEKEEPER_PORT" >&2
  tail -40 "$LOG_DIR/housekeeper.log" "$LOG_DIR/housekeeper.error.log" >&2 2>/dev/null || true
  exit 1
fi
echo "Native Ollama and Pyash GPU Housekeeper are running."
echo "Ollama is started and supervised by the Housekeeper process."
echo "Ollama API: loopback only at http://127.0.0.1:11434"
echo "Housekeeper peer: $HOUSEKEEPER_URL; host id macstudio"
echo "Model downloads are restricted to qwen3.5:9b."
if [[ -n "$STRATA_RUNTIME_URL" ]]; then
  echo "Strata API: $STRATA_RUNTIME_URL; Housekeeper runtime registered on apple0"
  echo "Strata admission floor: $STRATA_MEMORY_FLOOR_MB MiB unified memory"
fi
