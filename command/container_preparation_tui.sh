#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STRINGS_FILE="$ROOT_DIR/command/container_preparation_text.pya"
WORKPLACE_CONFIG="$ROOT_DIR/configure/workplace.pya"

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
OPENAI_TITLE=$(get_text openai_title)
OPENAI_INTRO=$(get_text openai_intro)
OPENAI_HOST_PROMPT=$(get_text openai_host_prompt)
OPENAI_CHOICE_HOST=$(get_text openai_choice_host)
OPENAI_CHOICE_LOCAL=$(get_text openai_choice_local)
OPENAI_CHOICE_VLLM=$(get_text openai_choice_vllm)
OPENAI_CHOICE_CUSTOM=$(get_text openai_choice_custom)
OPENAI_CHOICE_DETECT=$(get_text openai_choice_detect)
OPENAI_DETECTING=$(get_text openai_detecting)
OPENAI_DETECTED=$(get_text openai_detected)
OPENAI_DETECTED_NONE=$(get_text openai_detected_none)

has_dialog="no"
if [[ "${PYA_NO_DIALOG:-}" == "1" ]]; then
  has_dialog="no"
elif command -v dialog >/dev/null 2>&1; then
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
    dialog --title "$TITLE" --defaultno --yesno "$prompt" 8 60 \
      && result="yes" || result="no"
  fi
  echo "$result"
}

detect_reachable_base() {
  local base="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 1 "${base}/v1/models" >/dev/null 2>&1 && echo "$base" && return
    curl -fsS --max-time 1 "${base}/api/tags" >/dev/null 2>&1 && echo "$base" && return
  fi
}

autodetect_openai_base() {
  local candidates=(
    "http://host.docker.internal:11434"
    "http://127.0.0.1:11434"
    "http://localhost:11434"
    "http://127.0.0.1:8000"
    "http://localhost:8000"
  )
  local gw
  gw=$(ip route 2>/dev/null | awk '/default/ {print $3}' | head -n1)
  if [[ -n "${gw:-}" ]]; then
    candidates+=("http://${gw}:11434" "http://${gw}:8000")
  fi
  for base in "${candidates[@]}"; do
    local hit
    hit=$(detect_reachable_base "$base" || true)
    if [[ -n "${hit:-}" ]]; then
      echo "$hit"
      return
    fi
  done
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
    printf "\n%s %s " "$prompt" "$suffix"
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
MINDS_DIR="$ROOT_DIR/minds"
mkdir -p "$MINDS_DIR"
mkdir -p "$ROOT_DIR/configure"

if [[ "$has_dialog" == "yes" ]]; then
  preflight_gpu_text="$PREFLIGHT_GPU_MISSING"
  if [[ "$GPU_DEFAULT" == "on" ]]; then
    preflight_gpu_text="$PREFLIGHT_GPU"
  fi
  dialog --title "$PREFLIGHT_TITLE" --msgbox "$PREFLIGHT_INTRO\n\n$preflight_gpu_text\n$PREFLIGHT_VRAM: $vram_gib; $PREFLIGHT_RAM: $mem_gib; $PREFLIGHT_DISK: $disk_gib; $PREFLIGHT_CORES: $cpu_cores; $PREFLIGHT_BOGOMIPS: $bogomips\n\n$PREFLIGHT_GUIDANCE $guidance_text\n$PREFLIGHT_NOTE" 14 74
  GPU_CHOICE=$(prompt_yes_no_dialog "$(get_text enable_gpu)" "$GPU_DEFAULT")
  AUDIO_CHOICE=$(prompt_yes_no_dialog "$(get_text enable_audio)" "$AUDIO_DEFAULT")
  VNC_CHOICE=$(prompt_yes_no_dialog "$(get_text enable_vnc)" "$VNC_DEFAULT")

  OPENAI_DEFAULT="${OPENAI_BASE_URL:-${OLLAMA_HOST:-http://host.docker.internal:11434}}"
  OPENAI_CHOICE=$(dialog --stdout --title "$OPENAI_TITLE" --menu "$OPENAI_INTRO" 13 72 5 \
    1 "$OPENAI_CHOICE_HOST" \
    2 "$OPENAI_CHOICE_LOCAL" \
    3 "$OPENAI_CHOICE_VLLM" \
    4 "$OPENAI_CHOICE_CUSTOM" \
    5 "$OPENAI_CHOICE_DETECT")
  case "$OPENAI_CHOICE" in
    1) OPENAI_BASE_URL_VALUE="http://host.docker.internal:11434" ;;
    2) OPENAI_BASE_URL_VALUE="http://127.0.0.1:11434" ;;
    3) OPENAI_BASE_URL_VALUE="http://127.0.0.1:8000" ;;
    4)
      OPENAI_BASE_URL_VALUE=$(dialog --stdout --title "$OPENAI_TITLE" --inputbox "$OPENAI_HOST_PROMPT\n[$OPENAI_DEFAULT]" 8 70) || true
      OPENAI_BASE_URL_VALUE="${OPENAI_BASE_URL_VALUE:-$OPENAI_DEFAULT}"
      ;;
    5)
      dialog --title "$OPENAI_TITLE" --infobox "$OPENAI_DETECTING" 6 60
      autodetected=$(autodetect_openai_base || true)
      if [[ -n "${autodetected:-}" ]]; then
        dialog --title "$OPENAI_TITLE" --msgbox "$OPENAI_DETECTED: $autodetected" 7 70
        OPENAI_BASE_URL_VALUE="$autodetected"
      else
        dialog --title "$OPENAI_TITLE" --msgbox "$OPENAI_DETECTED_NONE" 6 60
        OPENAI_BASE_URL_VALUE="$OPENAI_DEFAULT"
      fi
      ;;
    *) OPENAI_BASE_URL_VALUE="${OPENAI_BASE_URL_VALUE:-$OPENAI_DEFAULT}" ;;
  esac
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
  read -r -p "Press Enter to accept defaults for GPU/audio/VNC, or type 'custom' to edit: " quick_choice || true
  if [[ -z "${quick_choice:-}" ]]; then
    GPU_CHOICE="$GPU_DEFAULT"
    AUDIO_CHOICE="$AUDIO_DEFAULT"
    VNC_CHOICE="$VNC_DEFAULT"
    echo "Using defaults: GPU=${GPU_CHOICE}, audio=${AUDIO_CHOICE}, vnc=${VNC_CHOICE}"
  else
    echo "Configure options (press Enter for defaults):"
    GPU_CHOICE=$(prompt_yes_no "$(get_text enable_gpu)" "$GPU_DEFAULT")
    AUDIO_CHOICE=$(prompt_yes_no "$(get_text enable_audio)" "$AUDIO_DEFAULT")
    VNC_CHOICE=$(prompt_yes_no "$(get_text enable_vnc)" "$VNC_DEFAULT")
  fi

  OPENAI_DEFAULT="${OPENAI_BASE_URL:-${OLLAMA_HOST:-http://host.docker.internal:11434}}"
  echo "$OPENAI_INTRO"
  echo "1) $OPENAI_CHOICE_HOST"
  echo "2) $OPENAI_CHOICE_LOCAL"
  echo "3) $OPENAI_CHOICE_VLLM"
  echo "4) $OPENAI_CHOICE_CUSTOM"
  echo "5) $OPENAI_CHOICE_DETECT"
  printf "Choice [1-5] (default 1): "
  read -r openai_choice || true
  case "${openai_choice:-1}" in
    1) OPENAI_BASE_URL_VALUE="http://host.docker.internal:11434" ;;
    2) OPENAI_BASE_URL_VALUE="http://127.0.0.1:11434" ;;
    3) OPENAI_BASE_URL_VALUE="http://127.0.0.1:8000" ;;
    4)
      printf "%s [%s] " "$OPENAI_HOST_PROMPT" "$OPENAI_DEFAULT"
      read -r openai_custom || true
      OPENAI_BASE_URL_VALUE="${openai_custom:-$OPENAI_DEFAULT}"
      ;;
    5)
      echo "$OPENAI_DETECTING"
      autodetected=$(autodetect_openai_base || true)
      if [[ -n "${autodetected:-}" ]]; then
        echo "$OPENAI_DETECTED: $autodetected"
        OPENAI_BASE_URL_VALUE="$autodetected"
      else
        echo "$OPENAI_DETECTED_NONE"
        OPENAI_BASE_URL_VALUE="$OPENAI_DEFAULT"
      fi
      ;;
    *) OPENAI_BASE_URL_VALUE="${OPENAI_BASE_URL_VALUE:-$OPENAI_DEFAULT}" ;;
  esac
fi

COMPOSE_CMD=("docker" "compose" "-f" "$ROOT_DIR/container/orchestrate.yaml" "up" "--build")
RUN_ENV="OPENAI_BASE_URL=${OPENAI_BASE_URL_VALUE}"

OVERRIDE_FILE="/tmp/pyash-compose.override.yaml"
ports=()
devices=()
volumes=()
envs=()
command_line=""
device_requests_enabled="no"

if [[ "$VNC_CHOICE" == "yes" ]]; then
  ports+=("\"5900:5900\"")
  ports+=("\"6080:6080\"")
  command_line='["/workplace/container/run_vnc_novnc.sh"]'
fi

if [[ "$GPU_CHOICE" == "yes" ]]; then
  if [[ "$GPU_DEFAULT" != "on" ]]; then
    dialog_msg "$(get_text gpu_missing)"
  fi
  device_requests_enabled="yes"
fi

if [[ "$AUDIO_CHOICE" == "yes" ]]; then
  if [[ ! -S "$PULSE_SOCKET" || ! -f "$PULSE_COOKIE" ]]; then
    dialog_msg "$(get_text audio_missing)"
  else
    devices+=("/dev/snd:/dev/snd")
    envs+=("PULSE_SERVER=unix:${PULSE_SOCKET}")
    volumes+=("/run/user/$(id -u)/pulse:/run/user/$(id -u)/pulse")
    volumes+=("${PULSE_COOKIE}:/root/.config/pulse/cookie")
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

COMPOSE_CMD=("$ROOT_DIR/container/run.sh")
SUMMARY="$(get_text build_cmd)\n${COMPOSE_CMD[*]}\n\n$(get_text run_cmd)\n${COMPOSE_CMD[*]}"

gpu_enabled_value="lie"
if [[ "$GPU_CHOICE" == "yes" ]]; then
  gpu_enabled_value="truth"
fi
audio_enabled_value="lie"
if [[ "$AUDIO_CHOICE" == "yes" ]]; then
  audio_enabled_value="truth"
fi
vnc_enabled_value="lie"
if [[ "$VNC_CHOICE" == "yes" ]]; then
  vnc_enabled_value="truth"
fi

{
  echo "su name workplace config be map def"
  echo "  su name ai host ob text \"${OPENAI_BASE_URL_VALUE}\" ya"
  echo "  su name stream stdout ob bool lie ya"
  echo "  su name keyboard enabled ob bool truth ya"
  echo "  su name ffmpeg input ob text \"pulse\" ya"
  echo "  su name ffmpeg input device ob text \"default\" ya"
  echo "  su name gpu enabled ob bool ${gpu_enabled_value} ya"
  echo "  su name audio enabled ob bool ${audio_enabled_value} ya"
  echo "  su name vnc enabled ob bool ${vnc_enabled_value} ya"
  echo "  su name minds directory ob text \"/minds\" ya"
  echo "prah"
} > "$WORKPLACE_CONFIG"
if [[ "$has_dialog" == "yes" ]]; then
  dialog --title "$TITLE" --yesno "$SUMMARY\n\n$(get_text run_now)" 20 78
  if [[ $? -eq 0 ]]; then
    "${COMPOSE_CMD[@]}"
  fi
else
  echo -e "$SUMMARY"
  echo
  read -r -p "$(get_text run_now) [y/N]: " run_now_input || true
  case "${run_now_input:-}" in
    [Yy]|[Yy][Ee][Ss]) RUN_NOW="yes" ;;
    *) RUN_NOW="no" ;;
  esac
  if [[ "$RUN_NOW" == "yes" ]]; then
    "${COMPOSE_CMD[@]}"
  fi
fi
detect_reachable_base() {
  local base="$1"
  if command -v curl >/dev/null 2>&1; then
    curl -fsS --max-time 1 "${base}/v1/models" >/dev/null 2>&1 && echo "$base" && return
    curl -fsS --max-time 1 "${base}/api/tags" >/dev/null 2>&1 && echo "$base" && return
  fi
}
