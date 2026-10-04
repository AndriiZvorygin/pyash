#!/usr/bin/env python3
"""Persistent HTTP wrapper for the Criterion Transformers worker."""

import importlib.util
import json
import pathlib
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict


_SERVER_PATH = pathlib.Path(__file__).resolve()
_REPO_WORKER = (
  _SERVER_PATH.parents[3] / "program/runtime/criterion/huggingface_worker.py"
  if len(_SERVER_PATH.parents) > 3 else pathlib.Path("/missing/huggingface_worker.py")
)
_WORKER_CANDIDATES = [
  _SERVER_PATH.with_name("huggingface_worker.py"),
  pathlib.Path("/service/huggingface_worker.py"),
  _REPO_WORKER
]
WORKER_PATH = next((candidate for candidate in _WORKER_CANDIDATES if candidate.exists()), _WORKER_CANDIDATES[0])
WORKER_SPEC = importlib.util.spec_from_file_location("criterion_huggingface_worker", WORKER_PATH)
if WORKER_SPEC is None or WORKER_SPEC.loader is None:
  raise RuntimeError("could not load Hugging Face worker")
WORKER = importlib.util.module_from_spec(WORKER_SPEC)
WORKER_SPEC.loader.exec_module(WORKER)

_STATE = None
_MODEL = ""
_MODEL_KEY = None
_LOCK = threading.Lock()


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: Dict[str, Any]) -> None:
  body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
  handler.send_response(status)
  handler.send_header("Content-Type", "application/json")
  handler.send_header("Content-Length", str(len(body)))
  handler.end_headers()
  handler.wfile.write(body)


def read_body(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
  try:
    length = int(handler.headers.get("Content-Length", "0"))
  except ValueError:
    length = 0
  raw = handler.rfile.read(max(0, length))
  try:
    value = json.loads(raw.decode("utf-8"))
  except Exception:
    return {}
  return value if isinstance(value, dict) else {}


def generate(payload: Dict[str, Any]) -> Dict[str, Any]:
  global _STATE, _MODEL, _MODEL_KEY
  model = str(payload.get("model") or "").strip()
  if not model:
    raise ValueError("model is required")
  with _LOCK:
    operation = payload.get("operation") or "generate"
    model_key = (model, payload.get("revision") or "", payload.get("dtype") or "auto", operation)
    if _STATE is None or _MODEL_KEY != model_key:
      _STATE = WORKER.load_state({
        "model": model,
        "revision": payload.get("revision"),
        "dtype": payload.get("dtype", "auto"),
        "operation": operation,
        "generation": payload.get("generation") or {}
      })
      _MODEL = model
      _MODEL_KEY = model_key
    return WORKER.generate(_STATE, payload)


def discharge() -> Dict[str, Any]:
  global _STATE, _MODEL, _MODEL_KEY
  with _LOCK:
    result = WORKER.unload_state(_STATE)
    _STATE = None
    _MODEL = ""
    _MODEL_KEY = None
    return result


class Handler(BaseHTTPRequestHandler):
  def do_GET(self) -> None:
    if self.path == "/health":
      json_response(self, 200, {"status": "ok", "model": _MODEL or None})
      return
    if self.path == "/model":
      metadata = _STATE.get("metadata") if isinstance(_STATE, dict) else None
      json_response(self, 200, metadata if isinstance(metadata, dict) else {"model": None})
      return
    json_response(self, 404, {"error": "not found"})

  def do_POST(self) -> None:
    if self.path == "/discharge":
      try:
        json_response(self, 200, discharge())
      except Exception as error:
        json_response(self, 500, {"success": False, "error": f"{type(error).__name__}: {error}"})
      return
    if self.path != "/generate":
      json_response(self, 404, {"error": "not found"})
      return
    try:
      json_response(self, 200, generate(read_body(self)))
    except Exception as error:
      json_response(self, 500, {"error": f"{type(error).__name__}: {error}"})

  def log_message(self, _format: str, *_args: Any) -> None:
    return


def main() -> None:
  server = ThreadingHTTPServer(("0.0.0.0", 8020), Handler)
  server.serve_forever()


if __name__ == "__main__":
  main()
