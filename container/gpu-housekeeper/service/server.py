#!/usr/bin/env python3
import argparse
import json
import os
import subprocess
import threading
import time
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, List, Optional
from urllib.error import HTTPError, URLError
from urllib.parse import unquote
from urllib.request import Request, urlopen

_JOBS: Dict[str, Dict[str, Any]] = {}
_PROFILES: Dict[str, Dict[str, Any]] = {}
_LOCK = threading.Lock()
_EXECUTION_LOCK = threading.Lock()
_RUNNING_JOB_ID: Optional[str] = None


DEFAULT_RUNTIME_REGISTRY = {
  "ollama": {
    "runtimeName": "ollama",
    "containerName": "ollama",
    "gpuExpected": True,
    "beginAction": ["start", "ollama"],
    "stopAction": ["stop", "ollama"],
    "restartAction": ["restart", "ollama"]
  },
  "comfyui": {
    "runtimeName": "comfyui",
    "containerName": "comfyui",
    "gpuExpected": True,
    "beginAction": ["start", "comfyui"],
    "stopAction": ["stop", "comfyui"],
    "restartAction": ["restart", "comfyui"]
  },
  "katago": {
    "runtimeName": "katago",
    "containerName": "katago",
    "gpuExpected": True,
    "beginAction": ["start", "katago"],
    "stopAction": ["stop", "katago"],
    "restartAction": ["restart", "katago"]
  }
}


def utc_now_iso() -> str:
  return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_text(value: Any) -> str:
  if value is None:
    return ""
  return str(value).strip()


def json_response(handler: BaseHTTPRequestHandler, code: int, payload: Dict[str, Any]) -> None:
  body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
  handler.send_response(code)
  handler.send_header("Content-Type", "application/json")
  handler.send_header("Content-Length", str(len(body)))
  handler.end_headers()
  handler.wfile.write(body)


def read_json_body(handler: BaseHTTPRequestHandler) -> Dict[str, Any]:
  try:
    length = int(handler.headers.get("Content-Length", "0"))
  except ValueError:
    length = 0
  raw = handler.rfile.read(length) if length > 0 else b"{}"
  try:
    payload = json.loads(raw.decode("utf-8"))
  except Exception:
    return {}
  if isinstance(payload, dict):
    return payload
  return {}


def parse_nvidia_smi() -> Dict[str, Any]:
  try:
    proc = subprocess.run(
      [
        "nvidia-smi",
        "--query-gpu=memory.total,memory.used,memory.free",
        "--format=csv,noheader,nounits"
      ],
      check=True,
      capture_output=True,
      text=True,
      timeout=3
    )
  except Exception:
    return {
      "available": False,
      "devices": []
    }

  devices: List[Dict[str, Any]] = []
  for idx, raw_line in enumerate(proc.stdout.splitlines()):
    line = raw_line.strip()
    if not line:
      continue
    parts = [part.strip() for part in line.split(",")]
    if len(parts) < 3:
      continue
    try:
      total = int(float(parts[0]))
      used = int(float(parts[1]))
      free = int(float(parts[2]))
    except ValueError:
      continue
    devices.append({
      "deviceId": f"gpu{idx}",
      "vramTotalMb": max(0, total),
      "vramUsedMb": max(0, used),
      "vramFreeMb": max(0, free)
    })

  return {
    "available": len(devices) > 0,
    "devices": devices
  }


def queue_depth() -> int:
  with _LOCK:
    running = 1 if _RUNNING_JOB_ID else 0
  return running


def profile_list() -> List[Dict[str, Any]]:
  with _LOCK:
    names = sorted(_PROFILES.keys())
    return [
      {
        "profileName": name,
        "loaded": bool(_PROFILES.get(name, {}).get("loaded", False))
      }
      for name in names
    ]


def minimal_jobs() -> List[Dict[str, Any]]:
  with _LOCK:
    values = list(_JOBS.values())
  values.sort(key=lambda item: item.get("submittedAt") or "")
  out = []
  for job in values:
    if job.get("status") != "running":
      continue
    out.append({
      "remoteJobId": job.get("remoteJobId"),
      "handleId": job.get("handleId"),
      "runtimeName": job.get("runtimeName"),
      "profileName": job.get("profileName"),
      "status": job.get("status")
    })
  return out


def make_snapshot(host_id: str) -> Dict[str, Any]:
  telemetry = parse_nvidia_smi()
  return {
    "hostId": host_id,
    "queueDepth": queue_depth(),
    "devices": telemetry["devices"],
    "profiles": profile_list()
  }


def submit_job(payload: Dict[str, Any]) -> Dict[str, Any]:
  handle_id = normalize_text(payload.get("handleId"))
  runtime_name = normalize_text(payload.get("runtimeName"))
  profile_name = normalize_text(payload.get("profileName"))
  job_spec = payload.get("jobSpec")

  if not handle_id or not runtime_name or not profile_name:
    return {
      "accepted": False,
      "error": "handleId, runtimeName, and profileName are required"
    }

  if not isinstance(job_spec, (dict, str)):
    return {
      "accepted": False,
      "error": "jobSpec must be map or text"
    }

  runtime_lower = runtime_name.lower()
  if runtime_lower == "ollama":
    if not isinstance(job_spec, dict):
      return {
        "accepted": False,
        "error": "ollama jobSpec must be map"
      }
    kind = normalize_text(job_spec.get("kind")).lower()
    if kind not in {"ollama-generate", "ollama-chat"}:
      return {
        "accepted": False,
        "error": "ollama jobSpec.kind must be ollama-generate or ollama-chat"
      }

  if runtime_lower == "comfyui":
    if not isinstance(job_spec, dict):
      return {
        "accepted": False,
        "error": "comfyui jobSpec must be map"
      }
    kind = normalize_text(job_spec.get("kind")).lower()
    if kind not in {"comfyui-draw", "comfyui-say", "comfyui-hear", "comfyui-prompt"}:
      return {
        "accepted": False,
        "error": "comfyui jobSpec.kind must be comfyui-draw, comfyui-say, comfyui-hear, or comfyui-prompt"
      }
    prompt = job_spec.get("prompt") or job_spec.get("workflow")
    if not isinstance(prompt, dict):
      return {
        "accepted": False,
        "error": "comfyui jobSpec.prompt must be map"
      }

  if runtime_lower == "katago":
    if not isinstance(job_spec, dict):
      return {
        "accepted": False,
        "error": "katago jobSpec must be map"
      }
    kind = normalize_text(job_spec.get("kind")).lower()
    allowed = {"katago-analyze", "katago-begin", "katago-discharge", "katago-restart", "katago-status"}
    if kind not in allowed:
      return {
        "accepted": False,
        "error": "katago jobSpec.kind must be katago-analyze, katago-begin, katago-discharge, katago-restart, or katago-status"
      }
    if kind == "katago-analyze" and not isinstance(job_spec.get("query"), dict):
      return {
        "accepted": False,
        "error": "katago jobSpec.query must be map"
      }

  remote_job_id = f"job-{uuid.uuid4().hex[:12]}"
  now = utc_now_iso()
  job = {
    "remoteJobId": remote_job_id,
    "handleId": handle_id,
    "runtimeName": runtime_name,
    "profileName": profile_name,
    "jobSpec": job_spec,
    "status": "queued",
    "message": "queued",
    "submittedAt": now,
    "startedAt": "",
    "finishedAt": ""
  }

  with _LOCK:
    _JOBS[remote_job_id] = job
    existing = _PROFILES.get(profile_name, {})
    _PROFILES[profile_name] = {
      "profileName": profile_name,
      "runtimeName": runtime_name,
      "loaded": bool(existing.get("loaded", False))
    }

  return {
    "remoteJobId": remote_job_id,
    "accepted": True
  }


def job_status(remote_job_id: str) -> Optional[Dict[str, Any]]:
  with _LOCK:
    job = _JOBS.get(remote_job_id)
    if not job:
      return None
    return {
      "status": job.get("status") or "queued",
      "message": job.get("message") or "",
      "result": job.get("result"),
      "error": job.get("error"),
      "startedAt": job.get("startedAt") or "",
      "finishedAt": job.get("finishedAt") or ""
    }


def discharge(payload: Dict[str, Any]) -> Dict[str, Any]:
  profile_name = normalize_text(payload.get("profileName"))
  with _LOCK:
    if profile_name:
      if profile_name in _PROFILES:
        _PROFILES[profile_name]["loaded"] = False
      return {"success": True}

    for name in _PROFILES:
      _PROFILES[name]["loaded"] = False

  try:
    subprocess.run(["nvidia-smi"], capture_output=True, text=True, timeout=2)
  except Exception:
    pass

  return {"success": True}


def run_docker(args: List[str], timeout_sec: int = 8) -> Dict[str, Any]:
  try:
    proc = subprocess.run(
      ["docker", *args],
      capture_output=True,
      text=True,
      timeout=max(1, timeout_sec)
    )
  except FileNotFoundError:
    return {
      "success": False,
      "status": "unavailable",
      "message": "docker CLI unavailable"
    }
  except subprocess.TimeoutExpired:
    return {
      "success": False,
      "status": "timeout",
      "message": "docker command timed out"
    }
  except Exception as err:
    return {
      "success": False,
      "status": "defective",
      "message": f"docker command failed: {err}"
    }

  stdout = normalize_text(proc.stdout)
  stderr = normalize_text(proc.stderr)
  if proc.returncode == 0:
    return {
      "success": True,
      "status": "ok",
      "message": stdout or "ok",
      "stdout": stdout,
      "stderr": stderr
    }

  return {
    "success": False,
    "status": "defective",
    "message": stderr or stdout or f"docker exited {proc.returncode}",
    "stdout": stdout,
    "stderr": stderr
  }


def resolve_gpu_observed(inspect_data: Dict[str, Any]) -> Optional[bool]:
  host_cfg = inspect_data.get("HostConfig") if isinstance(inspect_data, dict) else {}
  if not isinstance(host_cfg, dict):
    host_cfg = {}

  device_requests = host_cfg.get("DeviceRequests")
  if isinstance(device_requests, list):
    if len(device_requests) > 0:
      return True

  config = inspect_data.get("Config") if isinstance(inspect_data, dict) else {}
  if not isinstance(config, dict):
    config = {}

  env_list = config.get("Env")
  if isinstance(env_list, list):
    for item in env_list:
      env = normalize_text(item)
      if env.startswith("NVIDIA_VISIBLE_DEVICES="):
        value = normalize_text(env.split("=", 1)[1]).lower()
        return value not in {"", "none", "void"}
      if env.startswith("CUDA_VISIBLE_DEVICES="):
        value = normalize_text(env.split("=", 1)[1]).lower()
        return value not in {"", "-1", "none"}

  return None


def parse_runtime_status(runtime_entry: Dict[str, Any]) -> Dict[str, Any]:
  runtime_name = normalize_text(runtime_entry.get("runtimeName"))
  container_name = normalize_text(runtime_entry.get("containerName"))
  gpu_expected = bool(runtime_entry.get("gpuExpected", False))

  if not container_name:
    return {
      "runtimeName": runtime_name,
      "status": "unknown",
      "containerName": "",
      "gpuExpected": gpu_expected,
      "gpuObserved": None,
      "message": "containerName not configured"
    }

  inspect_result = run_docker(["inspect", container_name], timeout_sec=6)
  if not inspect_result.get("success"):
    return {
      "runtimeName": runtime_name,
      "status": "unknown",
      "containerName": container_name,
      "gpuExpected": gpu_expected,
      "gpuObserved": None,
      "message": inspect_result.get("message") or "inspect failed"
    }

  try:
    parsed = json.loads(inspect_result.get("stdout") or "[]")
  except Exception:
    parsed = []

  if not isinstance(parsed, list) or len(parsed) == 0 or not isinstance(parsed[0], dict):
    return {
      "runtimeName": runtime_name,
      "status": "unknown",
      "containerName": container_name,
      "gpuExpected": gpu_expected,
      "gpuObserved": None,
      "message": "inspect output invalid"
    }

  item = parsed[0]
  state = item.get("State") if isinstance(item, dict) else {}
  if not isinstance(state, dict):
    state = {}
  running = bool(state.get("Running", False))
  state_status = normalize_text(state.get("Status")).lower()
  gpu_observed = resolve_gpu_observed(item)

  status = state_status or ("running" if running else "stopped")
  message = "running" if running else (state_status or "not running")
  if running and gpu_expected and gpu_observed is False:
    message = "running but gpu not observed"
  if running and gpu_observed is None:
    message = "running; gpu observation unavailable"

  return {
    "runtimeName": runtime_name,
    "status": status,
    "containerName": container_name,
    "gpuExpected": gpu_expected,
    "gpuObserved": gpu_observed,
    "message": message
  }


def list_runtime_statuses(runtime_registry: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
  out = []
  for runtime_name in sorted(runtime_registry.keys()):
    out.append(parse_runtime_status(runtime_registry[runtime_name]))
  return out


def runtime_action(runtime_registry: Dict[str, Dict[str, Any]], runtime_name: str, action_key: str) -> Dict[str, Any]:
  entry = runtime_registry.get(runtime_name)
  if not entry:
    return {
      "success": False,
      "status": "missing",
      "message": f"runtime not managed: {runtime_name}"
    }

  args = entry.get(action_key)
  if not isinstance(args, list) or len(args) == 0:
    return {
      "success": False,
      "status": "defective",
      "message": f"{action_key} not configured"
    }

  docker_result = run_docker([str(value) for value in args], timeout_sec=15)
  current = parse_runtime_status(entry)
  return {
    "success": bool(docker_result.get("success")),
    "status": current.get("status", "unknown"),
    "message": docker_result.get("message") or current.get("message") or ""
  }


def ollama_runtime_url() -> str:
  return normalize_text(os.environ.get("OLLAMA_RUNTIME_URL")) or "http://host.docker.internal:11434"


def comfyui_runtime_url() -> str:
  return normalize_text(os.environ.get("COMFYUI_RUNTIME_URL")) or "http://host.docker.internal:8188"


def request_comfyui_json(pathname: str, payload: Optional[Dict[str, Any]] = None, timeout_sec: int = 600) -> Dict[str, Any]:
  base = comfyui_runtime_url().rstrip("/")
  url = f"{base}/{pathname.lstrip('/')}"
  data = None if payload is None else json.dumps(payload).encode("utf-8")
  req = Request(url, data=data, headers={"Content-Type": "application/json"})
  if payload is None:
    req.get_method = lambda: "GET"
  try:
    with urlopen(req, timeout=max(1, timeout_sec)) as response:
      raw = response.read().decode("utf-8")
  except HTTPError as err:
    detail = ""
    try:
      detail = err.read().decode("utf-8")
    except Exception:
      detail = str(err)
    raise RuntimeError(f"comfyui request failed {err.code}: {detail}")
  except URLError as err:
    raise RuntimeError(f"comfyui request failed: {err.reason}")

  try:
    parsed = json.loads(raw or "{}")
  except Exception:
    parsed = {}
  if isinstance(parsed, dict):
    return parsed
  return {"value": parsed}


def request_ollama_json(pathname: str, payload: Optional[Dict[str, Any]] = None, timeout_sec: int = 600) -> Dict[str, Any]:
  base = ollama_runtime_url().rstrip("/")
  url = f"{base}/{pathname.lstrip('/')}"
  data = None if payload is None else json.dumps(payload).encode("utf-8")
  req = Request(url, data=data, headers={"Content-Type": "application/json"})
  if payload is None:
    req.get_method = lambda: "GET"
  try:
    with urlopen(req, timeout=max(1, timeout_sec)) as response:
      raw = response.read().decode("utf-8")
  except HTTPError as err:
    detail = ""
    try:
      detail = err.read().decode("utf-8")
    except Exception:
      detail = str(err)
    raise RuntimeError(f"ollama request failed {err.code}: {detail}")
  except URLError as err:
    raise RuntimeError(f"ollama request failed: {err.reason}")

  try:
    parsed = json.loads(raw or "{}")
  except Exception:
    parsed = {}
  if isinstance(parsed, dict):
    return parsed
  return {"value": parsed}


def runtime_is_stopped(status: Dict[str, Any]) -> bool:
  value = normalize_text(status.get("status")).lower()
  return value in {"", "created", "dead", "exited", "not running", "paused", "restarting", "stopped"}


def ensure_runtime_ready(runtime_registry: Dict[str, Dict[str, Any]], runtime_name: str) -> None:
  entry = runtime_registry.get(runtime_name)
  if not entry:
    raise RuntimeError(f"runtime not managed: {runtime_name}")

  status = parse_runtime_status(entry)
  if runtime_is_stopped(status):
    result = runtime_action(runtime_registry, runtime_name, "beginAction")
    if not result.get("success"):
      raise RuntimeError(result.get("message") or f"runtime begin failed: {runtime_name}")
    status = parse_runtime_status(entry)

  if bool(entry.get("gpuExpected", False)) and status.get("gpuObserved") is False:
    result = runtime_action(runtime_registry, runtime_name, "restartAction")
    if not result.get("success"):
      raise RuntimeError(result.get("message") or f"runtime restart failed: {runtime_name}")


def warm_ollama_models() -> List[str]:
  payload = request_ollama_json("/api/ps", None, timeout_sec=10)
  models = payload.get("models") if isinstance(payload, dict) else []
  if not isinstance(models, list):
    return []
  out: List[str] = []
  for item in models:
    if not isinstance(item, dict):
      continue
    name = normalize_text(item.get("name") or item.get("model"))
    if name:
      out.append(name)
  return out


def discharge_warm_ollama_models(target_model: str) -> None:
  target = normalize_text(target_model)
  for model in warm_ollama_models():
    if model == target:
      continue
    try:
      request_ollama_json("/api/generate", {
        "model": model,
        "prompt": "",
        "stream": False,
        "keep_alive": 0
      }, timeout_sec=30)
      with _LOCK:
        if model in _PROFILES:
          _PROFILES[model]["loaded"] = False
    except Exception:
      continue


def normalize_ollama_payload(job_spec: Dict[str, Any], profile_name: str) -> Dict[str, Any]:
  payload = job_spec.get("payload") if isinstance(job_spec.get("payload"), dict) else dict(job_spec)
  payload.pop("kind", None)
  payload.pop("payload", None)
  payload.pop("host", None)
  payload["model"] = normalize_text(payload.get("model")) or profile_name
  payload["stream"] = False
  if "keep_alive" not in payload:
    payload["keep_alive"] = 300
  return payload


def execute_ollama_job(job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  runtime_name = normalize_text(job.get("runtimeName")).lower()
  profile_name = normalize_text(job.get("profileName"))
  job_spec = job.get("jobSpec")
  if not isinstance(job_spec, dict):
    raise RuntimeError("ollama jobSpec must be a map")

  kind = normalize_text(job_spec.get("kind")).lower()
  if kind not in {"ollama-generate", "ollama-chat"}:
    raise RuntimeError(f"unsupported ollama job kind: {kind or 'missing'}")

  ensure_runtime_ready(runtime_registry, runtime_name)
  payload = normalize_ollama_payload(job_spec, profile_name)
  target_model = normalize_text(payload.get("model"))
  if not target_model:
    raise RuntimeError("ollama model is required")
  discharge_warm_ollama_models(target_model)

  endpoint = "/api/chat" if kind == "ollama-chat" else "/api/generate"
  result = request_ollama_json(endpoint, payload, timeout_sec=int(os.environ.get("OLLAMA_RUNTIME_TIMEOUT_SEC", "900")))
  with _LOCK:
    _PROFILES[target_model] = {
      "profileName": target_model,
      "runtimeName": runtime_name,
      "loaded": True
    }
  return result


def normalize_comfyui_prompt(job_spec: Dict[str, Any]) -> Dict[str, Any]:
  prompt = job_spec.get("prompt") if isinstance(job_spec.get("prompt"), dict) else job_spec.get("workflow")
  if not isinstance(prompt, dict):
    raise RuntimeError("comfyui prompt is required")
  return prompt


def poll_comfyui_history(prompt_id: str, timeout_sec: int, interval_sec: float = 0.5) -> Dict[str, Any]:
  deadline = time.time() + max(1, timeout_sec)
  while time.time() <= deadline:
    history = request_comfyui_json(f"/history/{prompt_id}", None, timeout_sec=10)
    entry = history.get(prompt_id) if isinstance(history, dict) else None
    if isinstance(entry, dict):
      status = entry.get("status") if isinstance(entry.get("status"), dict) else {}
      if isinstance(status, dict):
        status_str = normalize_text(status.get("status_str")).lower()
        completed = bool(status.get("completed", False))
        if status_str in {"error", "failed", "fail"}:
          raise RuntimeError(json.dumps(status, ensure_ascii=False))
        if completed or status_str in {"success", "completed"}:
          return entry
      if entry.get("outputs"):
        return entry
    time.sleep(max(0.05, interval_sec))
  raise RuntimeError(f"comfyui timed out waiting for prompt {prompt_id}")



def katago_model_path(job_spec: Dict[str, Any], profile_name: str) -> str:
  return normalize_text(job_spec.get("modelPath") or os.environ.get("KATAGO_MODEL_PATH")) or f"/models/{profile_name}.bin.gz"


def katago_config_path(job_spec: Dict[str, Any]) -> str:
  return normalize_text(job_spec.get("configPath") or os.environ.get("KATAGO_CONFIG_PATH")) or "/katago/analysis.cfg"


def docker_exec_json_line(container_name: str, args: List[str], payload: Dict[str, Any], timeout_sec: int) -> Dict[str, Any]:
  try:
    proc = subprocess.run(
      ["docker", "exec", "-i", container_name, *args],
      input=json.dumps(payload, ensure_ascii=False) + "\n",
      capture_output=True,
      text=True,
      timeout=max(1, timeout_sec)
    )
  except FileNotFoundError:
    raise RuntimeError("docker CLI unavailable")
  except subprocess.TimeoutExpired:
    raise RuntimeError("katago analysis timed out")

  stdout = proc.stdout or ""
  stderr = normalize_text(proc.stderr)
  if proc.returncode != 0:
    raise RuntimeError(stderr or f"katago exited {proc.returncode}")

  for raw_line in stdout.splitlines():
    line = raw_line.strip()
    if not line or not (line.startswith("{") or line.startswith("[")):
      continue
    try:
      parsed = json.loads(line)
    except Exception:
      continue
    if isinstance(parsed, dict):
      return parsed
  raise RuntimeError(stderr or "katago returned no JSON result")


def execute_katago_lifecycle(kind: str, runtime_name: str, profile_name: str, runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  entry = runtime_registry.get(runtime_name)
  if not entry:
    raise RuntimeError(f"runtime not managed: {runtime_name}")

  if kind == "katago-status":
    status = parse_runtime_status(entry)
    return {"message": status.get("message") or status.get("status") or "status", "runtime": status}
  if kind == "katago-begin":
    ensure_runtime_ready(runtime_registry, runtime_name)
    status = parse_runtime_status(entry)
    return {"message": "katago begun", "runtime": status}
  if kind == "katago-discharge":
    result = runtime_action(runtime_registry, runtime_name, "stopAction")
    with _LOCK:
      if profile_name in _PROFILES:
        _PROFILES[profile_name]["loaded"] = False
    if not result.get("success"):
      raise RuntimeError(result.get("message") or "katago discharge failed")
    return {"message": "katago discharged", "runtime": result}
  if kind == "katago-restart":
    result = runtime_action(runtime_registry, runtime_name, "restartAction")
    if not result.get("success"):
      raise RuntimeError(result.get("message") or "katago restart failed")
    status = parse_runtime_status(entry)
    return {"message": "katago restarted", "runtime": status}
  raise RuntimeError(f"unsupported katago lifecycle kind: {kind}")


def execute_katago_job(job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  runtime_name = normalize_text(job.get("runtimeName")).lower()
  profile_name = normalize_text(job.get("profileName")) or "default"
  job_spec = job.get("jobSpec")
  if not isinstance(job_spec, dict):
    raise RuntimeError("katago jobSpec must be a map")

  kind = normalize_text(job_spec.get("kind")).lower()
  if kind in {"katago-begin", "katago-discharge", "katago-restart", "katago-status"}:
    return execute_katago_lifecycle(kind, runtime_name, profile_name, runtime_registry)
  if kind != "katago-analyze":
    raise RuntimeError(f"unsupported katago job kind: {kind or 'missing'}")

  ensure_runtime_ready(runtime_registry, runtime_name)
  entry = runtime_registry.get(runtime_name) or {}
  container_name = normalize_text(entry.get("containerName")) or "katago"
  query = job_spec.get("query")
  if not isinstance(query, dict):
    raise RuntimeError("katago query is required")
  model_path = katago_model_path(job_spec, profile_name)
  config_path = katago_config_path(job_spec)
  timeout_sec = int(job_spec.get("timeoutSec") or os.environ.get("KATAGO_RUNTIME_TIMEOUT_SEC", "120"))
  args = ["env", "APPIMAGE_EXTRACT_AND_RUN=1", "katago", "analysis", "-model", model_path, "-config", config_path]
  result = docker_exec_json_line(container_name, args, query, timeout_sec=timeout_sec)
  with _LOCK:
    _PROFILES[profile_name] = {
      "profileName": profile_name,
      "runtimeName": runtime_name,
      "loaded": True
    }
  return result


def execute_comfyui_job(job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  runtime_name = normalize_text(job.get("runtimeName")).lower()
  profile_name = normalize_text(job.get("profileName"))
  job_spec = job.get("jobSpec")
  if not isinstance(job_spec, dict):
    raise RuntimeError("comfyui jobSpec must be a map")

  kind = normalize_text(job_spec.get("kind")).lower()
  if kind not in {"comfyui-draw", "comfyui-say", "comfyui-hear", "comfyui-prompt"}:
    raise RuntimeError(f"unsupported comfyui job kind: {kind or 'missing'}")

  ensure_runtime_ready(runtime_registry, runtime_name)
  prompt = normalize_comfyui_prompt(job_spec)
  client_id = normalize_text(job_spec.get("clientId")) or f"pyash-{uuid.uuid4().hex[:12]}"
  queued = request_comfyui_json("/prompt", {"client_id": client_id, "prompt": prompt}, timeout_sec=30)
  if queued.get("error"):
    raise RuntimeError(f"comfyui prompt rejected: {queued.get('error')}")
  node_errors = queued.get("node_errors")
  if isinstance(node_errors, dict) and len(node_errors) > 0:
    raise RuntimeError(f"comfyui prompt node_errors: {json.dumps(node_errors, ensure_ascii=False)}")
  prompt_id = normalize_text(queued.get("prompt_id"))
  if not prompt_id:
    raise RuntimeError("comfyui prompt_id missing")

  timeout_sec = int(job_spec.get("timeoutSec") or os.environ.get("COMFYUI_RUNTIME_TIMEOUT_SEC", "900"))
  history_entry = poll_comfyui_history(prompt_id, timeout_sec=timeout_sec)
  with _LOCK:
    if profile_name:
      _PROFILES[profile_name] = {
        "profileName": profile_name,
        "runtimeName": runtime_name,
        "loaded": True
      }
  return {
    "promptId": prompt_id,
    "kind": kind,
    "history": history_entry
  }


def execute_job(job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  runtime_name = normalize_text(job.get("runtimeName")).lower()
  if runtime_name == "ollama":
    return execute_ollama_job(job, runtime_registry)
  if runtime_name == "comfyui":
    return execute_comfyui_job(job, runtime_registry)
  if runtime_name == "katago":
    return execute_katago_job(job, runtime_registry)

  sleep_ms = 200
  if isinstance(job.get("jobSpec"), dict):
    requested = job["jobSpec"].get("sleepMs")
    try:
      sleep_ms = int(requested)
    except Exception:
      sleep_ms = 200
  sleep_ms = max(10, min(30000, sleep_ms))
  time.sleep(sleep_ms / 1000.0)
  return {"message": "completed"}


def load_runtime_registry() -> Dict[str, Dict[str, Any]]:
  raw = normalize_text(os.environ.get("GPU_HOUSEKEEPER_RUNTIME_REGISTRY"))
  entries: List[Dict[str, Any]] = []
  if raw:
    try:
      parsed = json.loads(raw)
      if isinstance(parsed, list):
        entries = [item for item in parsed if isinstance(item, dict)]
    except Exception:
      entries = []

  registry: Dict[str, Dict[str, Any]] = {}
  if entries:
    for item in entries:
      runtime_name = normalize_text(item.get("runtimeName")).lower()
      container_name = normalize_text(item.get("containerName"))
      if not runtime_name or not container_name:
        continue
      registry[runtime_name] = {
        "runtimeName": runtime_name,
        "containerName": container_name,
        "gpuExpected": bool(item.get("gpuExpected", True)),
        "beginAction": item.get("beginAction") if isinstance(item.get("beginAction"), list) else ["start", container_name],
        "stopAction": item.get("stopAction") if isinstance(item.get("stopAction"), list) else ["stop", container_name],
        "restartAction": item.get("restartAction") if isinstance(item.get("restartAction"), list) else ["restart", container_name]
      }

  if registry:
    return registry

  return {key: dict(value) for key, value in DEFAULT_RUNTIME_REGISTRY.items()}


def execute_registered_job(remote_job_id: str, runtime_registry: Dict[str, Dict[str, Any]]) -> None:
  global _RUNNING_JOB_ID
  with _EXECUTION_LOCK:
    with _LOCK:
      job = _JOBS.get(remote_job_id)
      if not job:
        return
      _RUNNING_JOB_ID = remote_job_id
      job["status"] = "running"
      job["message"] = "running"
      job["startedAt"] = utc_now_iso()
      profile_name = normalize_text(job.get("profileName"))
      runtime_name = normalize_text(job.get("runtimeName"))
      if profile_name:
        _PROFILES[profile_name] = {
          "profileName": profile_name,
          "runtimeName": runtime_name,
          "loaded": True
        }

    try:
      result = execute_job(job, runtime_registry)
      with _LOCK:
        current = _JOBS.get(remote_job_id)
        if current:
          current["status"] = "success"
          current["message"] = "completed"
          current["result"] = result
          current["error"] = None
          current["finishedAt"] = utc_now_iso()
    except Exception as err:
      with _LOCK:
        current = _JOBS.get(remote_job_id)
        if current:
          current["status"] = "fail"
          current["message"] = normalize_text(err) or "job failed"
          current["result"] = None
          current["error"] = {"message": normalize_text(err) or "job failed"}
          current["finishedAt"] = utc_now_iso()
    finally:
      with _LOCK:
        _RUNNING_JOB_ID = None


class Handler(BaseHTTPRequestHandler):
  host_id = "gpu-housekeeper"
  runtime_registry = DEFAULT_RUNTIME_REGISTRY

  def do_GET(self) -> None:
    if self.path == "/health":
      telemetry = parse_nvidia_smi()
      status = "ok" if telemetry["available"] else "degraded"
      json_response(self, 200, {
        "status": status,
        "timestamp": utc_now_iso()
      })
      return

    if self.path == "/snapshot":
      json_response(self, 200, make_snapshot(self.host_id))
      return

    if self.path == "/queue":
      json_response(self, 200, {
        "queueDepth": queue_depth(),
        "jobs": minimal_jobs()
      })
      return

    if self.path == "/runtime":
      json_response(self, 200, {
        "runtimes": list_runtime_statuses(self.runtime_registry)
      })
      return

    if self.path.startswith("/runtime/"):
      runtime_name = unquote(self.path[len("/runtime/"):]).strip().lower()
      if not runtime_name:
        json_response(self, 400, {"error": "runtime name required"})
        return
      entry = self.runtime_registry.get(runtime_name)
      if not entry:
        json_response(self, 404, {"error": f"runtime not managed: {runtime_name}"})
        return
      json_response(self, 200, parse_runtime_status(entry))
      return

    if self.path.startswith("/job/"):
      remote_job_id = self.path[len("/job/"):].strip()
      if not remote_job_id:
        json_response(self, 400, {"error": "job id required"})
        return
      status = job_status(remote_job_id)
      if status is None:
        json_response(self, 404, {"error": "job not found"})
        return
      json_response(self, 200, status)
      return

    json_response(self, 404, {"error": "not found"})

  def do_POST(self) -> None:
    if self.path == "/submit":
      payload = read_json_body(self)
      result = submit_job(payload)
      if result.get("accepted"):
        execute_registered_job(normalize_text(result.get("remoteJobId")), self.runtime_registry)
        json_response(self, 200, result)
      else:
        json_response(self, 400, result)
      return

    if self.path == "/discharge":
      payload = read_json_body(self)
      json_response(self, 200, discharge(payload))
      return

    if self.path == "/runtime/begin":
      payload = read_json_body(self)
      runtime_name = normalize_text(payload.get("runtimeName")).lower()
      if not runtime_name:
        json_response(self, 400, {"success": False, "status": "invalid", "message": "runtimeName required"})
        return
      result = runtime_action(self.runtime_registry, runtime_name, "beginAction")
      json_response(self, 200 if result.get("success") else 400, result)
      return

    if self.path == "/runtime/stop":
      payload = read_json_body(self)
      runtime_name = normalize_text(payload.get("runtimeName")).lower()
      if not runtime_name:
        json_response(self, 400, {"success": False, "status": "invalid", "message": "runtimeName required"})
        return
      result = runtime_action(self.runtime_registry, runtime_name, "stopAction")
      json_response(self, 200 if result.get("success") else 400, result)
      return

    if self.path == "/runtime/restart":
      payload = read_json_body(self)
      runtime_name = normalize_text(payload.get("runtimeName")).lower()
      if not runtime_name:
        json_response(self, 400, {"success": False, "status": "invalid", "message": "runtimeName required"})
        return
      result = runtime_action(self.runtime_registry, runtime_name, "restartAction")
      json_response(self, 200 if result.get("success") else 400, result)
      return

    json_response(self, 404, {"error": "not found"})

  def log_message(self, _format: str, *_args: Any) -> None:
    return


def main() -> None:
  parser = argparse.ArgumentParser()
  parser.add_argument("--host", default="0.0.0.0")
  parser.add_argument("--port", type=int, default=8090)
  parser.add_argument("--host-id", default="gpu-housekeeper")
  args = parser.parse_args()

  Handler.host_id = normalize_text(args.host_id) or "gpu-housekeeper"
  Handler.runtime_registry = load_runtime_registry()

  server = ThreadingHTTPServer((args.host, args.port), Handler)
  server.serve_forever()


if __name__ == "__main__":
  main()
