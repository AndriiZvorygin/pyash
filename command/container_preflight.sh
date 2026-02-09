#!/usr/bin/env bash
set -euo pipefail

pya_container_os_id() {
  if [[ -r /etc/os-release ]]; then
    . /etc/os-release
    echo "${ID:-unknown}"
    return
  fi
  echo "unknown"
}

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

pya_container_install_cmd_docker() {
  case "$(pya_container_os_id)" in
    ubuntu|debian)
      echo "sudo apt update && sudo apt install -y docker.io docker-compose-v2 docker-buildx"
      ;;
    fedora)
      echo "sudo dnf install -y moby-engine docker-compose-plugin docker-buildx-plugin"
      ;;
    arch)
      echo "sudo pacman -S --needed docker docker-compose docker-buildx"
      ;;
    darwin)
      echo "brew install --cask docker"
      ;;
    *)
      echo "Install Docker Engine + Docker Compose plugin + Docker Buildx plugin for your OS."
      ;;
  esac
}

pya_container_start_cmd_docker() {
  case "$(pya_container_os_id)" in
    ubuntu|debian|fedora|arch)
      echo "sudo systemctl enable --now docker"
      ;;
    darwin)
      echo "open -a Docker"
      ;;
    *)
      echo "Start the Docker daemon/service for your OS."
      ;;
  esac
}

pya_container_install_cmd_compose() {
  case "$(pya_container_os_id)" in
    ubuntu|debian)
      echo "sudo apt update && sudo apt install -y docker-compose-v2"
      ;;
    fedora)
      echo "sudo dnf install -y docker-compose-plugin"
      ;;
    arch)
      echo "sudo pacman -S --needed docker-compose"
      ;;
    darwin)
      echo "Docker Desktop includes Docker Compose plugin."
      ;;
    *)
      echo "Install Docker Compose plugin for your OS."
      ;;
  esac
}

pya_container_install_cmd_buildx() {
  case "$(pya_container_os_id)" in
    ubuntu|debian)
      echo "sudo apt update && sudo apt install -y docker-buildx"
      ;;
    fedora)
      echo "sudo dnf install -y docker-buildx-plugin"
      ;;
    arch)
      echo "sudo pacman -S --needed docker-buildx"
      ;;
    darwin)
      echo "Docker Desktop includes Docker Buildx."
      ;;
    *)
      echo "Install Docker Buildx plugin for your OS."
      ;;
  esac
}

pya_container_missing_docker_message() {
  cat <<EOF
Docker is not installed or not on PATH.
Install command:
  $(pya_container_install_cmd_docker)
EOF
}

pya_container_daemon_not_running_message() {
  cat <<EOF
Docker daemon is not running.
Start command:
  $(pya_container_start_cmd_docker)
EOF
}

pya_container_missing_compose_message() {
  cat <<EOF
Docker Compose plugin is not available.
Install command:
  $(pya_container_install_cmd_compose)
EOF
}

pya_container_missing_buildx_message() {
  cat <<EOF
Docker Buildx plugin is not available.
Install command:
  $(pya_container_install_cmd_buildx)
EOF
}
