#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STRINGS_FILE="$ROOT_DIR/command/container_preparation_text.pya"

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

has_dialog="no"
if command -v dialog >/dev/null 2>&1; then
  has_dialog="yes"
fi

dialog_msg() {
  if [[ "$has_dialog" == "yes" ]]; then
    dialog --title "$TITLE" --msgbox "$1" 8 60
  else
    echo "$TITLE"
    echo "$1"
  fi
}

prompt_yes_no_dialog() {
  local prompt="$1"
  local default="$2"
  local result="$default"
  dialog --title "$TITLE" --yesno "$prompt" 8 60 --default-button "$default" \
    && result="yes" || result="no"
  echo "$result"
}

prompt_yes_no() {
  local prompt="$1"
  local default="$2"
  local answer
  local suffix="[y/N]"
  if [[ "$default" == "yes" ]]; then
    suffix="[Y/n]"
  fi
  while true; do
    printf "%s %s " "$prompt" "$suffix"
    read -r answer || true
    answer="${answer:-}"
    if [[ -z "$answer" ]]; then
      echo "$default"
      return
    fi
    case "$answer" in
      [Yy]|[Yy][Ee][Ss]) echo "yes"; return ;;
      [Nn]|[Nn][Oo]) echo "no"; return ;;
    esac
  done
}

if ! command -v docker >/dev/null 2>&1; then
  dialog_msg "$(get_text docker_missing)"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  dialog_msg "$(get_text docker_not_running)"
  exit 1
fi

GPU_DEFAULT="off"
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_DEFAULT="on"
fi

AUDIO_DEFAULT="off"
PULSE_SOCKET="/run/user/$(id -u)/pulse/native"
PULSE_COOKIE="$HOME/.config/pulse/cookie"
if [[ -S "$PULSE_SOCKET" ]]; then
  AUDIO_DEFAULT="on"
fi

VNC_DEFAULT="on"

WORKPLACE="$ROOT_DIR"

if [[ "$has_dialog" == "yes" ]]; then
  GPU_CHOICE=$(prompt_yes_no_dialog "$(get_text enable_gpu)" "$GPU_DEFAULT")
  AUDIO_CHOICE=$(prompt_yes_no_dialog "$(get_text enable_audio)" "$AUDIO_DEFAULT")
  VNC_CHOICE=$(prompt_yes_no_dialog "$(get_text enable_vnc)" "$VNC_DEFAULT")
else
  echo "$TITLE"
  echo "$INTRO"
  echo
  GPU_CHOICE=$(prompt_yes_no "$(get_text enable_gpu)" "$GPU_DEFAULT")
  AUDIO_CHOICE=$(prompt_yes_no "$(get_text enable_audio)" "$AUDIO_DEFAULT")
  VNC_CHOICE=$(prompt_yes_no "$(get_text enable_vnc)" "$VNC_DEFAULT")
fi

RUN_CMD=("docker" "run" "--rm" "-it")
RUN_CMD+=("-v" "${WORKPLACE}:/workplace" "-w" "/workplace")

if [[ -d "$HOME/.codex" ]]; then
  RUN_CMD+=("-v" "$HOME/.codex:/root/.codex")
fi

if [[ "$GPU_CHOICE" == "yes" ]]; then
  RUN_CMD+=("--gpus" "all")
fi

if [[ "$AUDIO_CHOICE" == "yes" ]]; then
  if [[ ! -S "$PULSE_SOCKET" || ! -f "$PULSE_COOKIE" ]]; then
    dialog_msg "$(get_text audio_missing)"
  else
    RUN_CMD+=("--device" "/dev/snd")
    RUN_CMD+=("-e" "PULSE_SERVER=unix:${PULSE_SOCKET}")
    RUN_CMD+=("-v" "/run/user/$(id -u)/pulse:/run/user/$(id -u)/pulse")
    RUN_CMD+=("-v" "$PULSE_COOKIE:/root/.config/pulse/cookie")
  fi
fi

if [[ "$VNC_CHOICE" == "yes" ]]; then
  RUN_CMD+=("-p" "5900:5900" "-p" "6080:6080")
  RUN_CMD+=("--entrypoint" "/workplace/container/run_vnc_novnc.sh")
fi

RUN_CMD+=("pyash-dev")

BUILD_CMD=("docker" "build" "-t" "pyash-dev" "-f" "$ROOT_DIR/container/Dockerfile" "$ROOT_DIR")

SUMMARY="$(get_text build_cmd)\n${BUILD_CMD[*]}\n\n$(get_text run_cmd)\n${RUN_CMD[*]}"
if [[ "$has_dialog" == "yes" ]]; then
  dialog --title "$TITLE" --yesno "$SUMMARY\n\n$(get_text run_now)" 20 78
  if [[ $? -eq 0 ]]; then
    "${BUILD_CMD[@]}"
    "${RUN_CMD[@]}"
  fi
else
  echo -e "$SUMMARY"
  echo
  RUN_NOW=$(prompt_yes_no "$(get_text run_now)" "no")
  if [[ "$RUN_NOW" == "yes" ]]; then
    "${BUILD_CMD[@]}"
    "${RUN_CMD[@]}"
  fi
fi
