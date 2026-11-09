#!/usr/bin/env bash
set -euo pipefail

if [[ "${PYA_ENABLE_ZIM_TOOLS:-}" =~ ^(1|true|yes|truth)$ ]]; then
  :
else
  echo "ZIM toolchain setup skipped; set PYA_ENABLE_ZIM_TOOLS=truth to enable it."
  exit 0
fi

if [[ ! -r /etc/os-release ]]; then
  echo "ZIM host package installation requires Debian or Ubuntu." >&2
  exit 1
fi

. /etc/os-release
case "${ID:-} ${ID_LIKE:-}" in
  *debian*|*ubuntu*) ;;
  *)
    echo "ZIM host package installation supports Debian/Ubuntu; current OS is ${ID:-unknown}." >&2
    exit 1
    ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is required to build the Pyash ZIM tools image." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker daemon is unavailable; start Docker and retry." >&2
  exit 1
fi

if [[ "$(id -u)" -eq 0 ]]; then
  apt-get update
  apt-get install -y --no-install-recommends zim-tools kiwix-tools
else
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends zim-tools kiwix-tools
fi

docker build --pull -t pyash/zim-tools:ubuntu-24.04 "$(dirname "$0")/../containers/zim-tools"

for tool in zimwriterfs zimdump kiwix-search kiwix-serve; do
  command -v "$tool" >/dev/null
  printf '%s: %s\n' "$tool" "$("$tool" --version 2>&1 | head -1)"
  docker run --rm pyash/zim-tools:ubuntu-24.04 "$tool" --version >/dev/null
done
echo "pyash/zim-tools:ubuntu-24.04: verified"
