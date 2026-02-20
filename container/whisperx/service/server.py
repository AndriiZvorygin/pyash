#!/usr/bin/env python3
import argparse
import gc
import json
import os
import shutil
import subprocess
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def _json(handler: BaseHTTPRequestHandler, code: int, payload: dict):
  body = json.dumps(payload).encode("utf-8")
  handler.send_response(code)
  handler.send_header("Content-Type", "application/json")
  handler.send_header("Content-Length", str(len(body)))
  handler.end_headers()
  handler.wfile.write(body)


def _run_whisperx(payload: dict):
  input_path = str(payload.get("input") or "").strip()
  if not input_path:
    return 400, {"error": "input required"}
  if not os.path.exists(input_path):
    return 404, {"error": f"input not found: {input_path}"}

  output_srt = str(payload.get("output_srt") or "").strip()
  output_dir = str(payload.get("output_dir") or "").strip() or os.path.dirname(output_srt)
  if not output_dir:
    output_dir = "/tmp"

  model = str(payload.get("model") or os.environ.get("WHISPERX_MODEL") or "large-v3")
  language = str(payload.get("language") or os.environ.get("WHISPERX_LANGUAGE") or "en")
  compute_type = str(payload.get("compute_type") or os.environ.get("WHISPERX_COMPUTE_TYPE") or "int8")
  device = str(payload.get("device") or os.environ.get("WHISPERX_DEVICE") or "").strip()
  diarize = bool(payload.get("diarize"))

  os.makedirs(output_dir, exist_ok=True)
  cmd = [
    "whisperx",
    input_path,
    "--model", model,
    "--language", language,
    "--compute_type", compute_type,
    "--output_format", "srt",
    "--output_dir", output_dir
  ]
  if device:
    cmd.extend(["--device", device])
  if diarize:
    cmd.append("--diarize")
    token = os.environ.get("HF_TOKEN", "").strip()
    if token:
      cmd.extend(["--hf_token", token])

  proc = subprocess.run(cmd, capture_output=True, text=True)
  if proc.returncode != 0:
    return 500, {
      "error": "whisperx failed",
      "status": proc.returncode,
      "stderr": proc.stderr[-4000:],
      "stdout": proc.stdout[-2000:]
    }

  stem = os.path.splitext(os.path.basename(input_path))[0]
  generated_srt = os.path.join(output_dir, f"{stem}.srt")
  if not os.path.exists(generated_srt):
    return 500, {"error": f"generated srt missing: {generated_srt}"}

  if output_srt:
    os.makedirs(os.path.dirname(output_srt) or ".", exist_ok=True)
    if os.path.abspath(generated_srt) != os.path.abspath(output_srt):
      shutil.copyfile(generated_srt, output_srt)
    final_srt = output_srt
  else:
    final_srt = generated_srt

  generated_json = os.path.join(output_dir, f"{stem}.json")
  return 200, {
    "output_srt": final_srt,
    "output_json": generated_json if os.path.exists(generated_json) else "",
    "model": model,
    "language": language,
    "diarize": diarize
  }


def _discharge():
  try:
    import torch  # type: ignore
    if torch.cuda.is_available():
      torch.cuda.empty_cache()
      torch.cuda.ipc_collect()
  except Exception:
    pass
  gc.collect()
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
