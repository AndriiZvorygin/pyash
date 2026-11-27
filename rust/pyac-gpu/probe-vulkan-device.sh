#!/usr/bin/env bash
set -euo pipefail

minimum_memory_kib=$((1024 * 1024))
available_memory_kib=$(awk '/^MemAvailable:/ { print $2; exit }' /proc/meminfo)
if [[ -z "$available_memory_kib" || "$available_memory_kib" -lt "$minimum_memory_kib" ]]; then
  echo "refusing Vulkan probe: less than 1 GiB host memory is available" >&2
  exit 2
fi

for command_name in nvidia-smi vulkaninfo timeout; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "missing $command_name; install the NVIDIA utilities and vulkan-tools first" >&2
    exit 2
  fi
done

echo "Host memory available: $((available_memory_kib / 1024)) MiB"
echo "NVIDIA device status:"
nvidia-smi --query-gpu=name,driver_version,memory.total,memory.free,utilization.gpu \
  --format=csv,noheader,nounits

output=$(mktemp)
trap 'rm -f "$output"' EXIT
if ! timeout --signal=TERM 10s vulkaninfo >"$output" 2>&1; then
  cat "$output" >&2
  echo "Vulkan query failed or exceeded its 10-second limit" >&2
  exit 1
fi

summary=$(grep -E 'apiVersion[[:space:]]*=|driverInfo[[:space:]]*=|deviceType[[:space:]]*=|deviceName[[:space:]]*=|queueFlags[[:space:]]*=' "$output" || true)
printf '\nVulkan device summary:\n%s\n' "$summary"
if ! grep -Eq 'deviceName[[:space:]]*= NVIDIA ' <<<"$summary"; then
  echo "no NVIDIA Vulkan adapter was reported" >&2
  exit 1
fi
if ! grep -q 'PHYSICAL_DEVICE_TYPE_DISCRETE_GPU' <<<"$summary"; then
  echo "Vulkan did not report a discrete GPU" >&2
  exit 1
fi
if ! grep -Eq 'apiVersion[[:space:]]*=[[:space:]]*1\.[2-9]' <<<"$summary"; then
  echo "Vulkan 1.2 or newer is required" >&2
  exit 1
fi
if ! grep -Eq 'queueFlags[[:space:]]*=.*QUEUE_COMPUTE' <<<"$summary"; then
  echo "no Vulkan compute queue was reported" >&2
  exit 1
fi

cat <<'EOF'

PASS: discrete NVIDIA Vulkan 1.2+ compute device is visible.
This probe only enumerates device capabilities. It does not build shaders,
load a shader module, create a pipeline, or dispatch GPU work.
EOF
