#!/usr/bin/env python3
import argparse
import base64
import json
import os
import socket
import subprocess
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

_WORKER_LOCK = threading.Lock()
_WORKER_IO_LOCK = threading.Lock()
_WORKER_PROC: Optional[subprocess.Popen] = None
_WORKER_REQ_ID = 0


def _json(handler: BaseHTTPRequestHandler, code: int, payload: dict):
    body = json.dumps(payload).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _next_req_id() -> int:
    global _WORKER_REQ_ID
    with _WORKER_LOCK:
        _WORKER_REQ_ID += 1
        return _WORKER_REQ_ID


def _worker_cmd() -> list[str]:
    configured_worker = str(os.environ.get("SPEAKER_WORKER_PATH") or "").strip()
    if configured_worker:
        worker_path = configured_worker
    else:
        default_worker = "/workplace/command/speaker_worker.py"
        if Path(default_worker).exists():
            worker_path = default_worker
        else:
            repo_root = Path(__file__).resolve().parents[3]
            worker_path = str(repo_root / "command" / "speaker_worker.py")

    voices_dir = str(os.environ.get("SPEAKER_VOICES_DIR") or "./world/voices").strip()
    temp_dir = str(os.environ.get("SPEAKER_TEMP_DIR") or "./world/temporary/speaker").strip()
    return [
        "python3",
        worker_path,
        "--voices-dir",
        voices_dir,
        "--temp-dir",
        temp_dir,
    ]


def _ensure_worker() -> subprocess.Popen:
    global _WORKER_PROC
    with _WORKER_LOCK:
        if _WORKER_PROC is not None and _WORKER_PROC.poll() is None:
            return _WORKER_PROC
        _WORKER_PROC = subprocess.Popen(
            _worker_cmd(),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        return _WORKER_PROC


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


def _worker_rpc(command: str, payload: Dict[str, Any]) -> Tuple[int, Dict[str, Any]]:
    proc = _ensure_worker()
    assert proc.stdin is not None
    assert proc.stdout is not None
    req_id = _next_req_id()

    request = {"id": req_id, "command": command, "payload": payload or {}}

    with _WORKER_IO_LOCK:
        proc.stdin.write(json.dumps(request, ensure_ascii=True) + "\n")
        proc.stdin.flush()

        while True:
            line = proc.stdout.readline()
            if line:
                try:
                    resp = json.loads(line)
                except Exception:
                    continue
                if resp.get("id") != req_id:
                    continue
                if resp.get("ok"):
                    return 200, resp.get("result") or {}
                error = resp.get("error") if isinstance(resp.get("error"), dict) else {}
                message = str(error.get("message") or "speaker worker request failed")
                return 500, {"error": message}

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


def _materialize_audio_payload(payload: Dict[str, Any], req_tag: str) -> Tuple[Dict[str, Any], Optional[Path], Optional[str]]:
    body = payload if isinstance(payload, dict) else {}
    audio_b64 = body.get("audio_b64")
    if not isinstance(audio_b64, str) or not audio_b64.strip():
        return body, None, None
    try:
        raw = base64.b64decode(audio_b64.encode("ascii"), validate=True)
    except Exception:
        return body, None, "invalid audio_b64"
    if not raw:
        return body, None, "empty audio_b64"
    upload_dir = Path(str(os.environ.get("SPEAKER_UPLOAD_DIR") or "/tmp/speaker-upload").strip())
    upload_dir.mkdir(parents=True, exist_ok=True)
    audio_name = str(body.get("audio_name") or "").strip()
    suffix = Path(audio_name).suffix or ".wav"
    target = upload_dir / f"{req_tag}{suffix}"
    target.write_bytes(raw)
    out = dict(body)
    out["audio"] = str(target)
    out.pop("audio_b64", None)
    out.pop("audio_name", None)
    return out, target, None


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            _json(self, 200, {"ok": True, "service": "speaker"})
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

        if self.path == "/identify":
            req_payload = payload if isinstance(payload, dict) else {}
            req_payload, temp_audio, temp_err = _materialize_audio_payload(req_payload, f"identify-{_next_req_id()}")
            if temp_err:
                _json(self, 400, {"error": temp_err})
                return
            code, body = _worker_rpc("identify", req_payload)
            if temp_audio is not None:
                try:
                    temp_audio.unlink(missing_ok=True)
                except Exception:
                    pass
            _json(self, code, body)
            return
        if self.path == "/enrol":
            req_payload = payload if isinstance(payload, dict) else {}
            req_payload, temp_audio, temp_err = _materialize_audio_payload(req_payload, f"enrol-{_next_req_id()}")
            if temp_err:
                _json(self, 400, {"error": temp_err})
                return
            code, body = _worker_rpc("enrol", req_payload)
            if temp_audio is not None:
                try:
                    temp_audio.unlink(missing_ok=True)
                except Exception:
                    pass
            _json(self, code, body)
            return
        if self.path == "/rename":
            code, body = _worker_rpc("rename", payload if isinstance(payload, dict) else {})
            _json(self, code, body)
            return
        if self.path == "/discharge":
            code, body = _worker_rpc("discharge", {})
            _json(self, code, body)
            return
        if self.path == "/stop":
            code, body = _worker_rpc("stop", {})
            _kill_worker()
            _json(self, code, body)
            return

        _json(self, 404, {"error": "not found"})

    def log_message(self, fmt, *args):
        return


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="::")
    parser.add_argument("--port", type=int, default=8010)
    args = parser.parse_args()

    if ":" in str(args.host):
        class ThreadingHTTPServerV6(ThreadingHTTPServer):
            address_family = socket.AF_INET6
        server = ThreadingHTTPServerV6((args.host, args.port), Handler)
    else:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
