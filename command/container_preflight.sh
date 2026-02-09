#!/usr/bin/env bash
set -euo pipefail

pya_container_has_docker() {
  command -v docker >/dev/null 2>&1
}

pya_container_daemon_running() {
  docker info >/dev/null 2>&1
}

pya_container_has_compose() {
  docker compose version >/dev/null 2>&1
}

pya_container_has_buildx() {
  docker buildx version >/dev/null 2>&1
}
