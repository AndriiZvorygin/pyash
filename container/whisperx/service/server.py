#!/usr/bin/env python3
import argparse
import gc
import json
import os
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Tuple


_WORKER_LOCK = threading.Lock()
_RPC_LOCK = threading.Lock()
_WORKER_PROC: Optional[subprocess.Popen] = None


def _json(handler: BaseHTTPRequestHandler, code: int, payload: dict):
  body = json.dumps(payload).encode("utf-8")
  handler.send_response(code)
  handler.send_header("Content-Type", "application/json")
  handler.send_header("Content-Length", str(len(body)))
  handler.end_headers()
  handler.wfile.write(body)


def _send_ndjson(handler: BaseHTTPRequestHandler, payload: dict):
  line = (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")
  handler.wfile.write(line)
  handler.wfile.flush()


def _ensure_worker() -> subprocess.Popen:
  global _WORKER_PROC
  with _WORKER_LOCK:
    if _WORKER_PROC is not None and _WORKER_PROC.poll() is None:
      return _WORKER_PROC
    _WORKER_PROC = subprocess.Popen(
      ["python3", "/service/worker.py"],
      stdin=subprocess.PIPE,
      stdout=subprocess.PIPE,
      stderr=subprocess.PIPE,
      text=True,
      bufsize=1
    )
    return _WORKER_PROC


def _worker_rpc(req: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
  proc = _ensure_worker()
  assert proc.stdin is not None
  assert proc.stdout is not None

  with _RPC_LOCK:
    proc.stdin.write(json.dumps(req, ensure_ascii=False) + "\n")
    proc.stdin.flush()

    while True:
      line = proc.stdout.readline()
      if line:
        try:
          resp = json.loads(line)
        except Exception:
          # Some backends emit plain logs; ignore and keep reading RPC response.
          continue
        code = int(resp.get("code") or 500)
        return code, resp

      if proc.poll() is not None:
        err_tail = ""
        try:
          if proc.stderr is not None:
            err_tail = proc.stderr.read()[-4000:]
        except Exception:
          pass
        return 500, {"error": "worker exited", "status": proc.returncode, "stderr": err_tail}

      if line == "":
        return 500, {"error": "worker returned empty response"}


def _torch_discharge_local() -> None:
  try:
    import torch  # type: ignore
    if torch.cuda.is_available():
      torch.cuda.empty_cache()
      torch.cuda.ipc_collect()
  except Exception:
    pass
  gc.collect()


def _kill_worker() -> None:
  global _WORKER_PROC
  with _WORKER_LOCK:
    if _WORKER_PROC is None:
      return
    proc = _WORKER_PROC
    _WORKER_PROC = None

  try:
    if proc.poll() is None:
      proc.terminate()
      try:
        proc.wait(timeout=5)
      except Exception:
        proc.kill()
  except Exception:
    pass


def _run_whisperx(payload: dict) -> Tuple[int, Dict[str, Any]]:
  input_path = str(payload.get("input") or "").strip()
  if input_path == "":
    return 400, {"error": "input required"}
  if os.path.exists(input_path) is False:
    return 404, {"error": f"input not found: {input_path}"}

  output_srt = str(payload.get("output_srt") or "").strip()
  output_dir = str(payload.get("output_dir") or "").strip() or (os.path.dirname(output_srt) if output_srt else "")
  if output_dir == "":
    output_dir = "/tmp"

  req = {
    "op": "transcribe",
    "input": input_path,
    "output_dir": output_dir,
    "output_srt": output_srt,
    "model": str(payload.get("model") or os.environ.get("WHISPERX_MODEL") or "large-v3"),
    "language": str(payload.get("language") or os.environ.get("WHISPERX_LANGUAGE") or "en"),
    "compute_type": str(payload.get("compute_type") or os.environ.get("WHISPERX_COMPUTE_TYPE") or "int8"),
    "device": str(payload.get("device") or os.environ.get("WHISPERX_DEVICE") or "cuda").strip() or "cuda"
  }
  return _worker_rpc(req)


def _stream_whisperx(handler: BaseHTTPRequestHandler, payload: dict):
  input_path = str(payload.get("input") or "").strip()
  if input_path == "":
    _json(handler, 400, {"error": "input required"})
    return
  if os.path.exists(input_path) is False:
    _json(handler, 404, {"error": f"input not found: {input_path}"})
    return

  handler.send_response(200)
  handler.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
  handler.send_header("Cache-Control", "no-cache")
  handler.end_headers()

  _send_ndjson(handler, {"type": "log", "text": "worker transcribe begin"})
  code, body = _run_whisperx(payload)
  if code != 200:
    _send_ndjson(handler, {"type": "error", **body})
    return
  _send_ndjson(handler, {"type": "log", "text": "worker transcribe done"})
  _send_ndjson(handler, {"type": "result", **body})


def _discharge() -> Tuple[int, Dict[str, Any]]:
  _kill_worker()
  _torch_discharge_local()
  return 200, {"ok": True, "be": "discharge"}


class Handler(BaseHTTPRequestHandler):
  def do_GET(self):
    if self.path == "/health":
      _json(self, 200, {"ok": True, "service": "whisperx"})
      return
    _json(self, 404, {"error": "not found"})

  def do_POST(self):
    try:
      length = int(self.headers.get("Content-Length", "0"))
    except ValueError:
      length = 0
    raw = self.rfile.read(length) if length > 0 else b"{}"
    try:
      payload = json.loads(raw.decode("utf-8"))
    except Exception:
      _json(self, 400, {"error": "invalid json"})
      return

    if self.path == "/transcribe":
      code, body = _run_whisperx(payload)
      _json(self, code, body)
      return
    if self.path == "/transcribe_stream":
      _stream_whisperx(self, payload)
      return
    if self.path == "/discharge":
      code, body = _discharge()
      _json(self, code, body)
      return
    _json(self, 404, {"error": "not found"})

  def log_message(self, format, *args):
    return


def main():
  parser = argparse.ArgumentParser()
  parser.add_argument("--host", default="0.0.0.0")
  parser.add_argument("--port", type=int, default=8000)
  args = parser.parse_args()
  server = ThreadingHTTPServer((args.host, args.port), Handler)
  server.serve_forever()


if __name__ == "__main__":
  main()
