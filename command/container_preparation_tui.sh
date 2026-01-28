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
PREFLIGHT_TITLE=$(get_text preflight_title)
PREFLIGHT_INTRO=$(get_text preflight_intro)
PREFLIGHT_GPU=$(get_text preflight_gpu)
PREFLIGHT_GPU_MISSING=$(get_text preflight_gpu_missing)
PREFLIGHT_RAM=$(get_text preflight_ram)
PREFLIGHT_DISK=$(get_text preflight_disk)
PREFLIGHT_VRAM=$(get_text preflight_vram)
PREFLIGHT_CORES=$(get_text preflight_cores)
PREFLIGHT_BOGOMIPS=$(get_text preflight_bogomips)
PREFLIGHT_NOTE=$(get_text preflight_note)
PREFLIGHT_GUIDANCE=$(get_text preflight_guidance)

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
  if [[ "$default" == "yes" ]]; then
    dialog --title "$TITLE" --yesno "$prompt" 8 60 \
      && result="yes" || result="no"
  else
    dialog --title "$TITLE" --yesno "$prompt" 8 60 --defaultno \
      && result="yes" || result="no"
  fi
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

mem_gib="unknown"
if [[ -r /proc/meminfo ]]; then
  mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
  if [[ -n "${mem_kb:-}" ]]; then
    mem_gib=$((mem_kb / 1024 / 1024))
  fi
fi

disk_gib="unknown"
disk_kb=$(df -k "$ROOT_DIR" 2>/dev/null | awk 'NR==2 {print $4}')
if [[ -n "${disk_kb:-}" ]]; then
  disk_gib=$((disk_kb / 1024 / 1024))
fi

cpu_cores="unknown"
if command -v nproc >/dev/null 2>&1; then
  cpu_cores=$(nproc)
fi

bogomips="unknown"
if [[ -r /proc/cpuinfo ]]; then
  bogomips=$(awk -F: '/bogomips/ {sum+=$2} END {if (sum>0) printf "%.0f", sum}' /proc/cpuinfo)
fi

vram_gib="unknown"
if command -v nvidia-smi >/dev/null 2>&1; then
  vram_mib=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | head -n1 | tr -d ' ')
  if [[ -n "${vram_mib:-}" ]]; then
    vram_gib=$((vram_mib / 1024))
  fi
fi

guidance_text="CPU-only: whisper base/medium OK; large is slow. For LLMs, expect slow responses."
if [[ "$vram_gib" != "unknown" ]]; then
  if [[ "$vram_gib" -ge 24 ]]; then
    guidance_text="VRAM ${vram_gib}GiB: 34B+ class possible; 13B+ comfortable; large whisper OK."
  elif [[ "$vram_gib" -ge 16 ]]; then
    guidance_text="VRAM ${vram_gib}GiB: 13B class OK; 7B comfortable; large whisper OK."
  elif [[ "$vram_gib" -ge 8 ]]; then
    guidance_text="VRAM ${vram_gib}GiB: 7B class OK; 13B may be tight; whisper medium OK."
  elif [[ "$vram_gib" -ge 4 ]]; then
    guidance_text="VRAM ${vram_gib}GiB: 7B with quantization; whisper base OK; medium may be slow."
  else
    guidance_text="VRAM ${vram_gib}GiB: stick to small/quantized models; whisper base likely only."
  fi
elif [[ "$mem_gib" != "unknown" && "$mem_gib" -ge 32 ]]; then
  guidance_text="RAM ${mem_gib}GiB CPU-only: 7B quantized possible; whisper base/medium OK; large is slow."
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
  preflight_gpu_text="$PREFLIGHT_GPU_MISSING"
  if [[ "$GPU_DEFAULT" == "on" ]]; then
    preflight_gpu_text="$PREFLIGHT_GPU"
  fi
  dialog --title "$PREFLIGHT_TITLE" --msgbox "$PREFLIGHT_INTRO\n\n$preflight_gpu_text\n$PREFLIGHT_VRAM: $vram_gib\n$PREFLIGHT_RAM: $mem_gib\n$PREFLIGHT_DISK: $disk_gib\n$PREFLIGHT_CORES: $cpu_cores\n$PREFLIGHT_BOGOMIPS: $bogomips\n\n$PREFLIGHT_GUIDANCE $guidance_text\n$PREFLIGHT_NOTE" 16 74
  GPU_CHOICE=$(prompt_yes_no_dialog "$(get_text enable_gpu)" "$GPU_DEFAULT")
  AUDIO_CHOICE=$(prompt_yes_no_dialog "$(get_text enable_audio)" "$AUDIO_DEFAULT")
  VNC_CHOICE=$(prompt_yes_no_dialog "$(get_text enable_vnc)" "$VNC_DEFAULT")
else
  echo "$TITLE"
  echo "$INTRO"
  echo "$PREFLIGHT_INTRO"
  if [[ "$GPU_DEFAULT" == "on" ]]; then
    echo "$PREFLIGHT_GPU"
  else
    echo "$PREFLIGHT_GPU_MISSING"
  fi
  echo "$PREFLIGHT_VRAM: $vram_gib"
  echo "$PREFLIGHT_RAM: $mem_gib"
  echo "$PREFLIGHT_DISK: $disk_gib"
  echo "$PREFLIGHT_CORES: $cpu_cores"
  echo "$PREFLIGHT_BOGOMIPS: $bogomips"
  echo "$PREFLIGHT_GUIDANCE $guidance_text"
  echo "$PREFLIGHT_NOTE"
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
  if [[ "$GPU_DEFAULT" != "on" ]]; then
    dialog_msg "$(get_text gpu_missing)"
  fi
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
