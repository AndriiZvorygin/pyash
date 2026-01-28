#!/usr/bin/env bash
set -euo pipefail

DISPLAY=${DISPLAY:-:1}
SCREEN_RES=${SCREEN_RES:-1280x800x24}
VNC_PORT=${VNC_PORT:-5900}
NOVNC_PORT=${NOVNC_PORT:-6080}
VNC_PASSWORD=${VNC_PASSWORD:-}

mkdir -p /tmp/.X11-unix

# Start Xvfb
Xvfb "$DISPLAY" -screen 0 "$SCREEN_RES" -ac +extension RANDR +render -noreset &
XVFB_PID=$!

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
  kill "$NOVNC_PID" "$FLUX_PID" "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "VNC ready on :$VNC_PORT, noVNC on http://localhost:$NOVNC_PORT/vnc.html"

# Keep the container alive
wait "$XVFB_PID"
