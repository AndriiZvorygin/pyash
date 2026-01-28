#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STRINGS_FILE="$ROOT_DIR/command/container_preparation_text.pya"

if ! command -v dialog >/dev/null 2>&1; then
  echo "dialog not found. Install it or use a non-TUI path." >&2
  exit 1
fi

if [[ ! -f "$STRINGS_FILE" ]]; then
  echo "missing strings file: $STRINGS_FILE" >&2
  exit 1
fi

get_text() {
  local key="$1"
  local value
  while IFS= read -r line; do
    if [[ "$line" == "  su name ${key} ob text \""* ]]; then
      value="${line#*ob text \"}"
      value="${value%\" be text ya}"
      echo "$value"
      return
    fi
  done < "$STRINGS_FILE"
  echo "$key"
}

TITLE=$(get_text title)
INTRO=$(get_text intro)

if ! command -v docker >/dev/null 2>&1; then
  dialog --title "$TITLE" --msgbox "$(get_text docker_missing)" 8 60
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  dialog --title "$TITLE" --msgbox "$(get_text docker_not_running)" 8 60
  exit 1
fi

GPU_DEFAULT="off"
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_DEFAULT="on"
fi

AUDIO_DEFAULT="off"
PULSE_SOCKET="/run/user/$(id -u)/pulse/native"
if [[ -S "$PULSE_SOCKET" ]]; then
  AUDIO_DEFAULT="on"
fi

VNC_DEFAULT="on"

WORKPLACE="$ROOT_DIR"

GPU_CHOICE=$(dialog --stdout --title "$TITLE" --yesno "$(get_text enable_gpu)" 8 60 && echo "yes" || echo "no")
AUDIO_CHOICE=$(dialog --stdout --title "$TITLE" --yesno "$(get_text enable_audio)" 8 60 && echo "yes" || echo "no")
VNC_CHOICE=$(dialog --stdout --title "$TITLE" --yesno "$(get_text enable_vnc)" 8 60 && echo "yes" || echo "no")

RUN_CMD=("docker" "run" "--rm" "-it")
RUN_CMD+=("-v" "${WORKPLACE}:/workplace" "-w" "/workplace")

if [[ "$GPU_CHOICE" == "yes" ]]; then
  RUN_CMD+=("--gpus" "all")
fi

if [[ "$AUDIO_CHOICE" == "yes" ]]; then
  RUN_CMD+=("--device" "/dev/snd")
  RUN_CMD+=("-e" "PULSE_SERVER=unix:${PULSE_SOCKET}")
  RUN_CMD+=("-v" "/run/user/$(id -u)/pulse:/run/user/$(id -u)/pulse")
  RUN_CMD+=("-v" "$HOME/.config/pulse/cookie:/root/.config/pulse/cookie")
fi

if [[ "$VNC_CHOICE" == "yes" ]]; then
  RUN_CMD+=("-p" "5900:5900" "-p" "6080:6080")
fi

RUN_CMD+=("pyash-dev")

BUILD_CMD=("docker" "build" "-t" "pyash-dev" "-f" "$ROOT_DIR/container/Dockerfile" "$ROOT_DIR")

SUMMARY="$(get_text build_cmd)\n${BUILD_CMD[*]}\n\n$(get_text run_cmd)\n${RUN_CMD[*]}"

dialog --title "$TITLE" --yesno "$SUMMARY\n\n$(get_text run_now)" 20 78

if [[ $? -eq 0 ]]; then
  "${BUILD_CMD[@]}"
  "${RUN_CMD[@]}"
else
  dialog --title "$TITLE" --msgbox "$SUMMARY" 20 78
fi
