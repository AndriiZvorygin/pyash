#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WORKPLACE_CONFIG="$ROOT_DIR/configure/workplace.pya"
OVERRIDE_FILE="/tmp/pyash-compose.override.yaml"

get_map_value() {
  local key="$1"
  local line
  if [[ ! -f "$WORKPLACE_CONFIG" ]]; then
    return
  fi
  while IFS= read -r line; do
    if [[ "$line" == "  su name ${key} ob text \""* ]]; then
      line="${line#*ob text \"}"
      echo "${line%\" ya}"
      return
    fi
    if [[ "$line" == "  su name ${key} ob bool "* ]]; then
      line="${line#*ob bool }"
      echo "${line% ya}"
      return
    fi
  done < "$WORKPLACE_CONFIG"
}

ai_host="$(get_map_value "ai host")"
gpu_enabled="$(get_map_value "gpu enabled")"
audio_enabled="$(get_map_value "audio enabled")"
vnc_enabled="$(get_map_value "vnc enabled")"

if [[ -z "${ai_host:-}" ]]; then
  ai_host="http://host.docker.internal:11434"
fi

PULSE_SOCKET="/run/user/$(id -u)/pulse/native"
PULSE_COOKIE="$HOME/.config/pulse/cookie"

ports=()
devices=()
volumes=()
envs=()
command_line=""
device_requests_enabled="no"

if [[ "${vnc_enabled:-lie}" == "truth" ]]; then
  ports+=("\"5900:5900\"")
  ports+=("\"6080:6080\"")
  command_line='["/workplace/container/run_vnc_novnc.sh"]'
fi

if [[ "${gpu_enabled:-lie}" == "truth" ]]; then
  device_requests_enabled="yes"
fi

if [[ "${audio_enabled:-lie}" == "truth" ]]; then
  if [[ -S "$PULSE_SOCKET" && -f "$PULSE_COOKIE" ]]; then
    devices+=("/dev/snd:/dev/snd")
    envs+=("PULSE_SERVER=unix:${PULSE_SOCKET}")
    volumes+=("/run/user/$(id -u)/pulse:/run/user/$(id -u)/pulse")
    volumes+=("${PULSE_COOKIE}:/root/.config/pulse/cookie")
  else
    echo "Audio enabled, but PulseAudio files missing. Skipping audio mounts." >&2
  fi
fi

if [[ -d "$HOME/.codex" ]]; then
  volumes+=("${HOME}/.codex:/root/.codex")
fi

{
  echo "services:"
  echo "  pyash:"
  if [[ ${#ports[@]} -gt 0 ]]; then
    echo "    ports:"
    for port in "${ports[@]}"; do
      echo "      - ${port}"
    done
  fi
  if [[ -n "$command_line" ]]; then
    echo "    command: ${command_line}"
  fi
  if [[ "$device_requests_enabled" == "yes" ]]; then
    echo "    device_requests:"
    echo "      - driver: nvidia"
    echo "        count: all"
    echo "        capabilities: [gpu]"
  fi
  if [[ ${#devices[@]} -gt 0 ]]; then
    echo "    devices:"
    for dev in "${devices[@]}"; do
      echo "      - ${dev}"
    done
  fi
  if [[ ${#envs[@]} -gt 0 ]]; then
    echo "    environment:"
    for env in "${envs[@]}"; do
      echo "      - ${env}"
    done
  fi
  if [[ ${#volumes[@]} -gt 0 ]]; then
    echo "    volumes:"
    for vol in "${volumes[@]}"; do
      echo "      - ${vol}"
    done
  fi
} > "$OVERRIDE_FILE"

OPENAI_BASE_URL="$ai_host" AI_HOST="$ai_host" OLLAMA_HOST="$ai_host" \
  docker compose -f "$ROOT_DIR/container/orchestrate.yaml" -f "$OVERRIDE_FILE" up --build -d

echo "Container started. Enter with:"
echo "  docker exec -it pyash bash"
