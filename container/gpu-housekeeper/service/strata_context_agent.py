#!/usr/bin/env python3
"""Loopback-user control socket for safe Strata profile restarts."""

import json
import os
import socket
import socketserver
import stat
import threading
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

import strata_context_helper


def configured_options():
  raw = os.environ.get("GPU_HOUSEKEEPER_STRATA_CONTEXT_OPTIONS", "8192,16384,32768,65536")
  options = set()
  for part in raw.split(","):
    try:
      value = int(part.strip())
    except ValueError:
      continue
    if 8192 <= value <= 262144:
      options.add(value)
  return sorted(options)


def settings_from_environment():
  config = os.environ.get("GPU_HOUSEKEEPER_STRATA_CONTEXT_CONFIG_PATH", "").strip()
  unit = os.environ.get("GPU_HOUSEKEEPER_STRATA_CONTEXT_SYSTEMD_UNIT", "").strip()
  runtime_url = os.environ.get("GPU_HOUSEKEEPER_STRATA_RUNTIME_URL", "http://127.0.0.1:8081").rstrip("/")
  if not config or not unit:
    raise RuntimeError("Strata context agent requires a profile path and systemd unit")
  return {
    "config": config,
    "unit": unit,
    "options": configured_options(),
    "health_url": runtime_url + "/health",
    "timeout": int(os.environ.get("GPU_HOUSEKEEPER_STRATA_CONTEXT_RESTART_TIMEOUT", "180")),
    "socket": os.environ.get(
      "GPU_HOUSEKEEPER_STRATA_CONTEXT_AGENT_SOCKET",
      f"/run/user/{os.getuid()}/pyash-strata-context-agent.sock"
    )
  }


def configured_context(settings):
  profile = json.loads(Path(settings["config"]).read_text(encoding="utf-8"))
  return strata_context_helper.read_context_argument(profile.get("args", []))


def change_context(context, settings):
  if isinstance(context, bool) or not isinstance(context, int):
    raise ValueError("contextLength must be an integer")
  if context not in settings["options"]:
    raise ValueError(f"unsupported context length {context}")
  return strata_context_helper.reconfigure(
    settings["config"], context, settings["unit"],
    settings["health_url"], settings["timeout"]
  )


class UnixHTTPServer(socketserver.ThreadingUnixStreamServer):
  daemon_threads = True
  allow_reuse_address = True


class ContextHandler(BaseHTTPRequestHandler):
  settings = None
  change_lock = threading.Lock()

  def respond(self, status, payload):
    body = json.dumps(payload).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def do_GET(self):
    route = urlsplit(self.path).path
    if route == "/health":
      self.respond(200, {"ok": True, "service": "strata-context-agent"})
      return
    if route != "/context":
      self.respond(404, {"error": "not found"})
      return
    try:
      self.respond(200, {
        "contextLength": configured_context(self.settings),
        "options": self.settings["options"],
        "unit": self.settings["unit"]
      })
    except Exception as error:
      self.respond(503, {"error": str(error)})

  def do_POST(self):
    if urlsplit(self.path).path != "/context":
      self.respond(404, {"error": "not found"})
      return
    try:
      length = int(self.headers.get("Content-Length", "0"))
      if length <= 0 or length > 4096:
        raise ValueError("request body must be between 1 and 4096 bytes")
      payload = json.loads(self.rfile.read(length).decode("utf-8"))
      context = payload.get("contextLength") if isinstance(payload, dict) else None
      if isinstance(context, bool) or not isinstance(context, int):
        raise ValueError("contextLength must be an integer")
      if context not in self.settings["options"]:
        raise ValueError(f"unsupported context length {context}")
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as error:
      self.respond(400, {"error": str(error)})
      return

    if not self.change_lock.acquire(blocking=False):
      self.respond(409, {"error": "a Strata context restart is already in progress"})
      return
    try:
      result = change_context(context, self.settings)
      self.respond(200, result)
    except Exception as error:
      self.respond(503, {"error": str(error)})
    finally:
      self.change_lock.release()

  def log_message(self, _format, *_args):
    return


def serve(settings):
  socket_path = Path(settings["socket"])
  socket_path.parent.mkdir(parents=True, exist_ok=True)
  if socket_path.exists() or socket_path.is_symlink():
    info = socket_path.lstat()
    if not stat.S_ISSOCK(info.st_mode) or info.st_uid != os.getuid():
      raise RuntimeError(f"refusing to replace non-owned Strata agent socket: {socket_path}")
    socket_path.unlink()

  ContextHandler.settings = settings
  httpd = UnixHTTPServer(str(socket_path), ContextHandler)
  os.chmod(socket_path, 0o600)
  try:
    httpd.serve_forever()
  finally:
    httpd.server_close()
    if socket_path.exists() and socket_path.is_socket():
      socket_path.unlink()


if __name__ == "__main__":
  serve(settings_from_environment())
