#!/usr/bin/env bash
set -euo pipefail

DISPLAY=${DISPLAY:-:1}
SCREEN_RES=${SCREEN_RES:-1280x800x24}
VNC_PORT=${VNC_PORT:-5900}
NOVNC_PORT=${NOVNC_PORT:-6080}
VNC_PASSWORD=${VNC_PASSWORD:-}
DISPLAY_NUM="${DISPLAY#:}"
LOCK_FILE="/tmp/.X${DISPLAY_NUM}-lock"
SOCKET_FILE="/tmp/.X11-unix/X${DISPLAY_NUM}"

mkdir -p /tmp/.X11-unix

# Clear stale display lock/socket if the owning process no longer exists.
if [[ -f "$LOCK_FILE" ]]; then
  LOCK_PID="$(tr -dc '0-9' < "$LOCK_FILE" || true)"
  if [[ -n "${LOCK_PID:-}" ]] && kill -0 "$LOCK_PID" 2>/dev/null; then
    echo "Display $DISPLAY already active (pid $LOCK_PID), reusing existing X server."
  else
    echo "Removing stale display lock for $DISPLAY."
    rm -f "$LOCK_FILE" "$SOCKET_FILE"
  fi
fi

XVFB_PID=""
if pgrep -f "Xvfb ${DISPLAY}" >/dev/null 2>&1; then
  echo "Xvfb already running on $DISPLAY, not starting another instance."
else
  Xvfb "$DISPLAY" -screen 0 "$SCREEN_RES" -ac +extension RANDR +render -noreset &
  XVFB_PID=$!
fi

for _ in $(seq 1 50); do
  if [[ -S "$SOCKET_FILE" ]]; then
    break
  fi
  sleep 0.1
done

# Lightweight window manager
fluxbox >/tmp/fluxbox.log 2>&1 &
FLUX_PID=$!

# VNC server
if [[ -n "$VNC_PASSWORD" ]]; then
  x11vnc -display "$DISPLAY" -rfbport "$VNC_PORT" -passwd "$VNC_PASSWORD" -forever -shared -bg >/tmp/x11vnc.log 2>&1
else
  x11vnc -display "$DISPLAY" -rfbport "$VNC_PORT" -nopw -forever -shared -bg >/tmp/x11vnc.log 2>&1
fi

# noVNC (browser access)
websockify --web /usr/share/novnc "$NOVNC_PORT" localhost:"$VNC_PORT" >/tmp/novnc.log 2>&1 &
NOVNC_PID=$!

cleanup() {
  kill "$NOVNC_PID" "$FLUX_PID" 2>/dev/null || true
  if [[ -n "$XVFB_PID" ]]; then
    kill "$XVFB_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "VNC ready on :$VNC_PORT, noVNC on http://localhost:$NOVNC_PORT/vnc.html"

# Keep the container alive
if [[ -n "$XVFB_PID" ]]; then
  wait "$XVFB_PID"
else
  tail -f /dev/null
fi
