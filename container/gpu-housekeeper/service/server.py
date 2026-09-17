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
# Kept for compatibility with older imports; device locks below are the
# execution boundary used by the current housekeeper.
_EXECUTION_LOCK = threading.Lock()
_SUBMISSION_LOCK = threading.Lock()
_RUNNING_JOB_ID: Optional[str] = None
_RUNNING_JOB_IDS: Dict[str, set] = {}
_RUNTIME_ACTIVITY: Dict[str, Dict[str, Any]] = {}
_OLLAMA_MODEL_CATALOG_CACHE: Dict[str, Any] = {
  "observedAt": 0.0,
  "available": False,
  "models": [],
  "error": "not observed"
}


class DeviceExecutionGate:
  """Shared/exclusive admission for one physical device."""

  def __init__(self) -> None:
    self.condition = threading.Condition()
    self.shared = 0
    self.shared_vram_mb = 0
    self.exclusive = False

  def acquire(self, shared: bool, vram_required_mb: int = 0, can_share=None) -> None:
    with self.condition:
      if shared:
        while self.exclusive or (
          self.shared > 0
          and can_share is not None
          and not can_share(self.shared_vram_mb)
        ):
          self.condition.wait()
        self.shared += 1
        self.shared_vram_mb += max(0, int(vram_required_mb or 0))
        return
      while self.exclusive or self.shared:
        self.condition.wait()
      self.exclusive = True

  def release(self, shared: bool, vram_required_mb: int = 0) -> None:
    with self.condition:
      if shared:
        self.shared = max(0, self.shared - 1)
        self.shared_vram_mb = max(0, self.shared_vram_mb - max(0, int(vram_required_mb or 0)))
      else:
        self.exclusive = False
      self.condition.notify_all()


_EXECUTION_GATES: Dict[str, DeviceExecutionGate] = {}

DEFAULT_IDLE_GRACE_SECONDS = 300
DEFAULT_PEER_TIMEOUT_MS = 1500
DEFAULT_PEER_FAILURE_LIMIT = 3
DEFAULT_OLLAMA_MODEL_STORE_PATH = "/root/.ollama"


DEFAULT_RUNTIME_REGISTRY = {
  "ollama": {
    "runtimeName": "ollama",
    "containerName": "ollama",
    "gpuExpected": True,
    "beginAction": ["start", "ollama"],
    "stopAction": ["stop", "ollama"],
    "restartAction": ["restart", "ollama"],
    "activityProbe": "provider-owned",
    "dischargeKind": "",
    "concurrencySafe": False,
    "modelStorePath": DEFAULT_OLLAMA_MODEL_STORE_PATH
  },
  "comfyui": {
    "runtimeName": "comfyui",
    "containerName": "comfyui",
    "gpuExpected": True,
    "beginAction": ["start", "comfyui"],
    "stopAction": ["stop", "comfyui"],
    "restartAction": ["restart", "comfyui"],
    "activityProbe": "comfyui-queue",
    "dischargeKind": "comfyui",
    "concurrencySafe": False
  },
  "katago": {
    "runtimeName": "katago",
    "containerName": "katago",
    "gpuExpected": True,
    "beginAction": ["start", "katago"],
    "stopAction": ["stop", "katago"],
    "restartAction": ["restart", "katago"],
    "activityProbe": "provider-owned",
    "dischargeKind": "",
    "concurrencySafe": False
  },
  "huggingface": {
    "runtimeName": "huggingface",
    "containerName": "criterion-huggingface",
    "gpuExpected": True,
    "beginAction": ["start", "criterion-huggingface"],
    "stopAction": ["stop", "criterion-huggingface"],
    "restartAction": ["restart", "criterion-huggingface"],
    "activityProbe": "provider-owned",
    "dischargeKind": "huggingface",
    "concurrencySafe": False
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


def parse_nvidia_smi_processes() -> Dict[str, Any]:
  """Return GPU compute processes without treating unknown processes as managed."""
  try:
    proc = subprocess.run(
      [
        "nvidia-smi",
        "--query-compute-apps=pid,process_name,used_memory",
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
      "processes": []
    }

  processes: List[Dict[str, Any]] = []
  for raw_line in proc.stdout.splitlines():
    line = raw_line.strip()
    if not line:
      continue
    parts = [part.strip() for part in line.split(",", 2)]
    if len(parts) < 3:
      continue
    try:
      pid = int(parts[0])
      used_memory = int(float(parts[2]))
    except ValueError:
      continue
    if pid <= 0:
      continue
    processes.append({
      "pid": pid,
      "processName": parts[1],
      "usedMemoryMb": max(0, used_memory)
    })

  return {
    "available": True,
    "processes": processes
  }


def queue_depth() -> int:
  with _LOCK:
    running = sum(len(job_ids) for job_ids in _RUNNING_JOB_IDS.values())
    if _RUNNING_JOB_ID and not running:
      running = 1
  return running


def execution_device_id(job: Optional[Dict[str, Any]] = None) -> str:
  value = normalize_text((job or {}).get("deviceId"))
  if not value and isinstance((job or {}).get("jobSpec"), dict):
    request = (job or {}).get("jobSpec", {}).get("resourceRequest")
    if isinstance(request, dict):
      value = normalize_text(request.get("deviceId") or request.get("device_id"))
  value = value.lower()
  if value.startswith("gpu-") and value[4:].isdigit():
    value = f"gpu{value[4:]}"
  if value.isdigit():
    value = f"gpu{value}"
  return value or "gpu0"


def explicit_execution_device_id(job: Optional[Dict[str, Any]] = None) -> str:
  value = normalize_text((job or {}).get("deviceId"))
  if not value and isinstance((job or {}).get("jobSpec"), dict):
    request = (job or {}).get("jobSpec", {}).get("resourceRequest")
    if isinstance(request, dict):
      value = normalize_text(request.get("deviceId") or request.get("device_id"))
  value = value.lower()
  if value.startswith("gpu-") and value[4:].isdigit():
    value = f"gpu{value[4:]}"
  if value.isdigit():
    value = f"gpu{value}"
  return value


def execution_gate_for(device_id: str) -> DeviceExecutionGate:
  key = execution_device_id({"deviceId": device_id})
  with _LOCK:
    gate = _EXECUTION_GATES.get(key)
    if gate is None:
      gate = DeviceExecutionGate()
      _EXECUTION_GATES[key] = gate
    return gate


def first_running_job_id() -> Optional[str]:
  for job_ids in _RUNNING_JOB_IDS.values():
    if job_ids:
      return next(iter(job_ids))
  return None


def local_execution_slot_busy(job: Optional[Dict[str, Any]] = None, runtime_registry: Optional[Dict[str, Dict[str, Any]]] = None) -> bool:
  with _LOCK:
    active = [
      candidate for candidate in _JOBS.values()
      if not bool(candidate.get("forwarded", False))
      and candidate.get("status") in {"queued", "running"}
    ]
  if not active:
    return False
  if job is None or runtime_registry is None:
    return True
  target_device = execution_device_id(job)
  target_runtime = normalize_text(job.get("runtimeName")).lower()
  target_entry = runtime_registry.get(target_runtime) or {}
  for candidate in active:
    if execution_device_id(candidate) != target_device:
      continue
    candidate_entry = runtime_registry.get(normalize_text(candidate.get("runtimeName")).lower()) or {}
    target_vram = declared_vram_mb(job)
    candidate_vram = declared_vram_mb(candidate)
    if (
      not bool(target_entry.get("concurrencySafe", False))
      or not bool(candidate_entry.get("concurrencySafe", False))
      or target_vram <= 0
      or candidate_vram <= 0
    ):
      return True
  return False


def execution_slots(runtime_registry: Optional[Dict[str, Dict[str, Any]]] = None) -> List[Dict[str, Any]]:
  with _LOCK:
    active = [
      candidate for candidate in _JOBS.values()
      if not bool(candidate.get("forwarded", False))
      and candidate.get("status") in {"queued", "running"}
    ]
  slots: Dict[str, Dict[str, Any]] = {}
  for candidate in active:
    device_id = execution_device_id(candidate)
    slot = slots.setdefault(device_id, {"deviceId": device_id, "busy": False, "jobs": []})
    slot["busy"] = True
    slot["jobs"].append({
      "remoteJobId": candidate.get("remoteJobId"),
      "runtimeName": candidate.get("runtimeName"),
      "status": candidate.get("status"),
      "concurrencySafe": bool(
        (runtime_registry or {}).get(normalize_text(candidate.get("runtimeName")).lower(), {}).get("concurrencySafe", False)
      )
    })
  return [slots[key] for key in sorted(slots)]


def device_candidates_for_job(job: Dict[str, Any], devices: List[Dict[str, Any]]) -> List[str]:
  explicit = explicit_execution_device_id(job)
  if explicit:
    return [explicit]
  discovered = sorted({
    normalize_text(item.get("deviceId")).lower()
    for item in devices
    if isinstance(item, dict) and normalize_text(item.get("deviceId"))
  })
  return discovered or [execution_device_id(job)]


def declared_vram_mb(job: Optional[Dict[str, Any]] = None) -> int:
  try:
    request = job_resource_request(job or {})
  except RuntimeError:
    return 0
  return int(request.get("vramRequiredMb") or 0) if request else 0


def shared_vram_can_admit(device_id: str, required_vram_mb: int, reserved_vram_mb: int) -> bool:
  if required_vram_mb <= 0:
    return False
  telemetry = parse_nvidia_smi()
  devices = telemetry.get("devices") if isinstance(telemetry, dict) else []
  device = next((item for item in devices if item.get("deviceId") == device_id), None)
  if not telemetry.get("available") or not isinstance(device, dict):
    return False
  free_mb = int(device.get("vramFreeMb") or 0)
  return free_mb - max(0, int(reserved_vram_mb or 0)) >= required_vram_mb


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


def parse_bool_env(name: str, default: bool = False) -> bool:
  return parse_bool_value(os.environ.get(name), default)


def parse_bool_value(raw: Any, default: bool = False) -> bool:
  if isinstance(raw, bool):
    return raw
  value = normalize_text(raw).lower()
  if not value:
    return default
  return value in {"1", "true", "yes", "on", "truth"}


def peer_timeout_ms() -> int:
  raw = normalize_text(os.environ.get("GPU_HOUSEKEEPER_PEER_TIMEOUT_MS"))
  try:
    value = int(raw) if raw else DEFAULT_PEER_TIMEOUT_MS
  except ValueError:
    value = DEFAULT_PEER_TIMEOUT_MS
  return max(100, min(10000, value))


def peer_failure_limit() -> int:
  raw = normalize_text(os.environ.get("GPU_HOUSEKEEPER_PEER_FAILURE_LIMIT"))
  try:
    value = int(raw) if raw else DEFAULT_PEER_FAILURE_LIMIT
  except ValueError:
    value = DEFAULT_PEER_FAILURE_LIMIT
  return max(1, min(20, value))


def parse_peer_registry(raw: str = "") -> Dict[str, str]:
  peers: Dict[str, str] = {}
  for item in normalize_text(raw).split(";"):
    entry = item.strip()
    if not entry or "=" not in entry:
      continue
    host_id, url = entry.split("=", 1)
    host = normalize_text(host_id).lower()
    base = normalize_text(url).rstrip("/")
    if host and base.startswith(("http://", "https://")):
      peers[host] = base
  return peers


def configured_peers() -> Dict[str, str]:
  return parse_peer_registry(os.environ.get("GPU_HOUSEKEEPER_PEERS", ""))


def route_visited_hosts(payload: Dict[str, Any]) -> List[str]:
  routing = payload.get("routing") if isinstance(payload.get("routing"), dict) else {}
  visited = routing.get("visitedHosts")
  if not isinstance(visited, list):
    visited = []
  return [normalize_text(item).lower() for item in visited if normalize_text(item)]


def route_forward_depth(payload: Dict[str, Any]) -> int:
  routing = payload.get("routing") if isinstance(payload.get("routing"), dict) else {}
  try:
    return max(0, int(routing.get("forwardDepth", 0)))
  except (TypeError, ValueError):
    return 0


def local_route_state(job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]], host_id: str) -> Dict[str, Any]:
  runtime_name = normalize_text(job.get("runtimeName")).lower()
  if runtime_name not in runtime_registry:
    return {
      "hostId": host_id,
      "available": False,
      "immediate": False,
      "reason": f"runtime not managed: {runtime_name}"
    }
  telemetry = parse_nvidia_smi()
  devices = telemetry.get("devices") if isinstance(telemetry, dict) else []
  if not isinstance(devices, list):
    devices = []
  model_name = ollama_model_for_job(job) if runtime_name == "ollama" else ""
  model_catalog = ollama_model_catalog() if model_name else {}
  model_missing = bool(
    model_name
    and model_catalog.get("available")
    and not ollama_model_entry(model_name, model_catalog)
  )
  candidates = []
  for device_id in device_candidates_for_job(job, devices):
    candidate_job = {**job, "deviceId": device_id}
    try:
      capacity = capacity_plan_for_job(candidate_job, runtime_registry)
    except RuntimeError as err:
      candidates.append({
        "hostId": host_id,
        "deviceId": device_id,
        "available": False,
        "immediate": False,
        "reason": normalize_text(err) or "local capacity check failed"
      })
      continue
    # Submission remains durable even when telemetry is temporarily unavailable;
    # final execution admission still fails closed in ensure_capacity_for_job.
    feasible = (
      capacity.get("decision") in {"not-requested", "fits", "reclaim-available", "telemetry-unavailable"}
      and not model_missing
    )
    with _LOCK:
      profile = _PROFILES.get(normalize_text(job.get("profileName")), {})
      warm = bool(profile.get("loaded", False))
    busy = local_execution_slot_busy(candidate_job, runtime_registry)
    score = 0
    if warm:
      score += 100
    if capacity.get("decision") == "fits":
      score += 20
    elif capacity.get("decision") == "reclaim-available":
      score -= 60
    if not busy:
      score += 10
    candidates.append({
      "hostId": host_id,
      "deviceId": device_id,
      "available": feasible,
      "immediate": feasible and not busy,
      "busy": busy,
      "queueDepth": queue_depth(),
      "warm": warm,
      "score": score,
      "capacity": capacity,
      "reason": (
        f"Ollama model is not installed: {model_name}"
        if model_missing
        else ("local execution slot occupied" if busy else capacity.get("reason", "local candidate"))
      )
    })
  available = [item for item in candidates if item.get("available")]
  if not available:
    reason = next((item.get("reason") for item in candidates if item.get("reason")), "no executable local GPU device")
    return {
      "hostId": host_id,
      "available": False,
      "immediate": False,
      "deviceId": explicit_execution_device_id(job),
      "candidates": candidates,
      "reason": reason
    }
  return max(available, key=lambda item: (bool(item.get("immediate")), int(item.get("score") or 0), item.get("deviceId") == "gpu0"))


def peer_request_json(base_url: str, pathname: str, payload: Optional[Dict[str, Any]] = None, timeout_ms: int = 1500) -> Dict[str, Any]:
  url = f"{normalize_text(base_url).rstrip('/')}/{pathname.lstrip('/')}"
  data = None if payload is None else json.dumps(payload).encode("utf-8")
  request = Request(url, data=data, headers={"Content-Type": "application/json"})
  if payload is None:
    request.get_method = lambda: "GET"
  try:
    with urlopen(request, timeout=max(0.1, timeout_ms / 1000.0)) as response:
      raw = response.read().decode("utf-8")
  except HTTPError as err:
    detail = ""
    try:
      detail = err.read().decode("utf-8")
    except Exception:
      detail = str(err)
    raise RuntimeError(f"peer request failed {err.code}: {detail}")
  except URLError as err:
    raise RuntimeError(f"peer request failed: {err.reason}")
  try:
    parsed = json.loads(raw or "{}")
  except Exception as err:
    raise RuntimeError(f"peer returned invalid JSON: {err}")
  if not isinstance(parsed, dict):
    raise RuntimeError("peer returned a non-map response")
  return parsed


def peer_route_candidate(
  peer_host_id: str,
  peer_url: str,
  job: Dict[str, Any]
) -> Dict[str, Any]:
  snapshot = peer_request_json(peer_url, "/snapshot", timeout_ms=peer_timeout_ms())
  runtime_name = normalize_text(job.get("runtimeName")).lower()
  runtimes = snapshot.get("runtimes") if isinstance(snapshot.get("runtimes"), list) else []
  runtime = next((item for item in runtimes if normalize_text(item.get("runtimeName")).lower() == runtime_name), None)
  if not isinstance(runtime, dict):
    return {"hostId": peer_host_id, "url": peer_url, "available": False, "reason": f"runtime not advertised: {runtime_name}"}
  runtime_status = normalize_text(runtime.get("status")).lower()
  if runtime_status == "unknown":
    return {
      "hostId": peer_host_id,
      "url": peer_url,
      "available": False,
      "reason": f"peer runtime is unavailable: {runtime_name}"
    }
  model_name = ollama_model_for_job(job) if runtime_name == "ollama" else ""
  catalog = snapshot.get("ollamaModelCatalog") if isinstance(snapshot.get("ollamaModelCatalog"), dict) else {}
  if model_name and catalog.get("available") and not ollama_model_entry(model_name, catalog):
    return {
      "hostId": peer_host_id,
      "url": peer_url,
      "available": False,
      "reason": f"Ollama model is not installed: {model_name}"
    }
  profiles = snapshot.get("profiles") if isinstance(snapshot.get("profiles"), list) else []
  target_profile = normalize_text(job.get("profileName"))
  warm = any(normalize_text(item.get("profileName")) == target_profile and item.get("loaded") is True for item in profiles)
  target_safe = bool(runtime.get("concurrencySafe", False))
  execution_slots_view = snapshot.get("executionSlots")
  devices = snapshot.get("devices") if isinstance(snapshot.get("devices"), list) else []
  candidate_devices = device_candidates_for_job(job, devices)
  candidates = []
  for device_id in candidate_devices:
    preview = peer_request_json(peer_url, "/capacity/preview", {
      "runtimeName": runtime_name,
      "profileName": normalize_text(job.get("profileName")),
      "deviceId": device_id,
      "dischargeAllowed": job.get("dischargeAllowed", True) is not False,
      "jobSpec": job.get("jobSpec")
    }, timeout_ms=peer_timeout_ms())
    if not preview.get("feasible"):
      continue
    target_device = execution_device_id({**job, "deviceId": device_id})
    if isinstance(execution_slots_view, list):
      busy = False
      for slot in execution_slots_view:
        if not isinstance(slot, dict) or normalize_text(slot.get("deviceId")).lower() != target_device:
          continue
        for active_job in slot.get("jobs", []):
          if not target_safe or not bool(active_job.get("concurrencySafe", False)):
            busy = True
            break
        if busy:
          break
    else:
      busy = bool(
        snapshot.get(
          "executionSlotBusy",
          int(snapshot.get("queueDepth") or 0) > 0
        )
      )
    score = 0
    if warm:
      score += 100
    if preview.get("decision") == "fits":
      score += 20
    elif preview.get("decision") == "reclaim-available":
      score -= 60
    if not busy:
      score += 10
    if runtime_status == "running":
      score += 40
    candidates.append({
      "hostId": peer_host_id,
      "url": peer_url,
      "deviceId": target_device,
      "available": True,
      "immediate": not busy,
      "busy": busy,
      "queueDepth": int(snapshot.get("queueDepth") or 0),
      "warm": warm,
      "score": score,
      "preview": preview,
      "reason": "peer execution slot occupied" if busy else "peer candidate"
    })
  if not candidates:
    return {
      "hostId": peer_host_id,
      "url": peer_url,
      "deviceId": explicit_execution_device_id(job),
      "available": False,
      "reason": "peer capacity is unavailable"
    }
  return max(candidates, key=lambda item: (bool(item.get("immediate")), int(item.get("score") or 0), item.get("deviceId") == "gpu0"))


def select_route(payload: Dict[str, Any], job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]], host_id: str) -> Dict[str, Any]:
  depth = route_forward_depth(payload)
  visited = set(route_visited_hosts(payload))
  local = local_route_state(job, runtime_registry, host_id)
  candidates = [local]
  if depth == 0:
    for peer_host_id, peer_url in configured_peers().items():
      if peer_host_id == host_id or peer_host_id in visited:
        continue
      try:
        candidate = peer_route_candidate(peer_host_id, peer_url, job)
      except Exception as err:
        candidate = {
          "hostId": peer_host_id,
          "url": peer_url,
          "available": False,
          "reason": normalize_text(err) or "peer probe failed"
        }
      candidates.append(candidate)

  immediate = [item for item in candidates if item.get("available") and item.get("immediate")]
  if immediate:
    selected = max(immediate, key=lambda item: (int(item.get("score") or 0), item.get("hostId") == host_id))
    return {"selected": selected, "candidates": candidates, "forwarded": selected.get("hostId") != host_id}
  if local.get("available"):
    return {"selected": local, "candidates": candidates, "forwarded": False, "reason": "no peer has an immediate free slot"}
  return {"selected": None, "candidates": candidates, "forwarded": False, "reason": "no local or peer route is executable"}


def make_snapshot(host_id: str) -> Dict[str, Any]:
  telemetry = parse_nvidia_smi()
  process_view = managed_gpu_processes(Handler.runtime_registry) if "Handler" in globals() else {
    "available": False,
    "runtimes": {},
    "unmanagedProcesses": []
  }
  return {
    "hostId": host_id,
    "queueDepth": queue_depth(),
    "devices": telemetry["devices"],
    "profiles": profile_list(),
    "ollamaModelCatalog": ollama_model_catalog(),
    "runtimes": list_runtime_statuses(Handler.runtime_registry) if "Handler" in globals() else [],
    "gpuProcesses": process_view,
    "executionSlotBusy": local_execution_slot_busy(),
    "executionSlots": execution_slots(Handler.runtime_registry) if "Handler" in globals() else execution_slots(),
    "federation": {
      "enabled": bool(configured_peers()),
      "acceptsForwarded": parse_bool_env("GPU_HOUSEKEEPER_ACCEPT_FORWARDED", True),
      "peers": [
        {"hostId": peer_host_id, "url": peer_url}
        for peer_host_id, peer_url in configured_peers().items()
      ]
    }
  }


def forward_job_to_peer(payload: Dict[str, Any], job: Dict[str, Any], route: Dict[str, Any]) -> Dict[str, Any]:
  selected = route.get("selected") or {}
  peer_url = normalize_text(selected.get("url"))
  if not peer_url:
    return {"accepted": False, "error": "selected peer has no URL"}
  visited = route_visited_hosts(payload)
  origin = normalize_text((payload.get("routing") or {}).get("originHostId")) if isinstance(payload.get("routing"), dict) else ""
  if not origin:
    origin = normalize_text(Handler.host_id)
  forwarded_payload = {
    "handleId": job["handleId"],
    "runtimeName": job["runtimeName"],
    "profileName": job["profileName"],
    "jobSpec": job["jobSpec"],
    "deviceId": job.get("deviceId", ""),
    "dischargeAllowed": job.get("dischargeAllowed", True),
    "routing": {
      "originHostId": origin,
      "forwardDepth": route_forward_depth(payload) + 1,
      "visitedHosts": list(dict.fromkeys([*visited, normalize_text(Handler.host_id)]))
    }
  }
  peer_result = peer_request_json(peer_url, "/submit", forwarded_payload, timeout_ms=peer_timeout_ms())
  peer_job_id = normalize_text(peer_result.get("remoteJobId"))
  if not peer_result.get("accepted") or not peer_job_id:
    return {
      "accepted": False,
      "error": peer_result.get("error") or "peer rejected forwarded job",
      "peerHostId": selected.get("hostId")
    }
  job["status"] = "running"
  job["message"] = f"forwarded to {selected.get('hostId')}"
  job["forwarded"] = True
  job["peerUrl"] = peer_url
  job["peerJobId"] = peer_job_id
  job["executionHostId"] = normalize_text(selected.get("hostId"))
  job["route"] = {
    "forwarded": True,
    "originHostId": origin,
    "executionHostId": normalize_text(selected.get("hostId")),
    "score": int(selected.get("score") or 0),
    "reason": selected.get("reason") or "peer selected"
  }
  with _LOCK:
    _JOBS[job["remoteJobId"]] = job
  return {
    "accepted": True,
    "remoteJobId": job["remoteJobId"],
    "forwarded": True,
    "executionHostId": job["executionHostId"],
    "route": job["route"]
  }


def submit_job(payload: Dict[str, Any], runtime_registry: Optional[Dict[str, Dict[str, Any]]] = None, host_id: str = "") -> Dict[str, Any]:
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

  try:
    job_resource_request({"jobSpec": job_spec})
  except RuntimeError as err:
    return {
      "accepted": False,
      "error": normalize_text(err)
    }

  runtime_lower = runtime_name.lower()
  if runtime_lower == "ollama":
    if not isinstance(job_spec, dict):
      return {
        "accepted": False,
        "error": "ollama jobSpec must be map"
      }
    kind = normalize_text(job_spec.get("kind")).lower()
    if kind not in {"ollama-generate", "ollama-chat", "ollama-ensure-model"}:
      return {
        "accepted": False,
        "error": "ollama jobSpec.kind must be ollama-generate, ollama-chat, or ollama-ensure-model"
      }
    if kind == "ollama-ensure-model" and not isinstance(job_spec.get("payload"), dict):
      return {
        "accepted": False,
        "error": "ollama-ensure-model jobSpec.payload must be map"
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

  if runtime_lower == "huggingface":
    if not isinstance(job_spec, dict):
      return {
        "accepted": False,
        "error": "huggingface jobSpec must be map"
      }
    kind = normalize_text(job_spec.get("kind")).lower()
    if kind != "huggingface-generate":
      return {
        "accepted": False,
        "error": "huggingface jobSpec.kind must be huggingface-generate"
      }
    if not isinstance(job_spec.get("payload"), dict):
      return {
        "accepted": False,
        "error": "huggingface jobSpec.payload must be map"
      }

  runtime_registry = runtime_registry or Handler.runtime_registry
  selected_host = normalize_text(host_id) or normalize_text(Handler.host_id)
  if route_forward_depth(payload) > 0 and not parse_bool_env("GPU_HOUSEKEEPER_ACCEPT_FORWARDED", True):
    return {
      "accepted": False,
      "error": "forwarded jobs are disabled on this housekeeper"
    }

  remote_job_id = f"job-{uuid.uuid4().hex[:12]}"
  now = utc_now_iso()
  job = {
    "remoteJobId": remote_job_id,
    "handleId": handle_id,
    "runtimeName": runtime_name,
    "profileName": profile_name,
    "jobSpec": job_spec,
    "deviceId": normalize_text(payload.get("deviceId")),
    "dischargeAllowed": payload.get("dischargeAllowed", True) is not False,
    "status": "queued",
    "message": "queued",
    "submittedAt": now,
    "startedAt": "",
    "finishedAt": "",
    "executionHostId": selected_host,
    "forwarded": False,
    "route": {
      "forwarded": False,
      "originHostId": selected_host,
      "executionHostId": selected_host,
      "reason": "local candidate"
    }
  }

  with _SUBMISSION_LOCK:
    route = select_route(payload, job, runtime_registry, selected_host)
    selected = route.get("selected") or {}
    if route.get("forwarded"):
      try:
        return forward_job_to_peer(payload, job, route)
      except Exception as err:
        return {
          "accepted": False,
          "error": f"peer forwarding failed: {normalize_text(err) or 'unknown error'}",
          "route": {"candidates": route.get("candidates", [])}
        }
    if not selected:
      return {
        "accepted": False,
        "error": route.get("reason") or "no executable local or peer GPU target",
        "route": {"candidates": route.get("candidates", [])}
      }
    selected_device = normalize_text(selected.get("deviceId"))
    if selected_device:
      job["deviceId"] = selected_device
    job["route"] = {
      "forwarded": False,
      "originHostId": selected_host,
      "executionHostId": selected_host,
      "score": int(selected.get("score") or 0),
      "reason": selected.get("reason") or route.get("reason") or "local candidate"
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
    "accepted": True,
    "forwarded": False,
    "executionHostId": selected_host,
    "route": job["route"]
  }


def refresh_forwarded_job(remote_job_id: str) -> None:
  with _LOCK:
    job = _JOBS.get(remote_job_id)
    if not job or not job.get("forwarded") or job.get("status") in {"success", "fail"}:
      return
    peer_url = normalize_text(job.get("peerUrl"))
    peer_job_id = normalize_text(job.get("peerJobId"))
  if not peer_url or not peer_job_id:
    return
  try:
    remote = peer_request_json(peer_url, f"/job/{peer_job_id}", timeout_ms=peer_timeout_ms())
    with _LOCK:
      current = _JOBS.get(remote_job_id)
      if not current:
        return
      status = normalize_text(remote.get("status")).lower()
      if status in {"queued", "running", "success", "fail"}:
        current["status"] = status
      current["message"] = normalize_text(remote.get("message")) or current.get("message") or "forwarded"
      current["result"] = remote.get("result")
      current["error"] = remote.get("error")
      current["startedAt"] = remote.get("startedAt") or current.get("startedAt", "")
      current["finishedAt"] = remote.get("finishedAt") or current.get("finishedAt", "")
      current["peerFailureCount"] = 0
  except Exception as err:
    with _LOCK:
      current = _JOBS.get(remote_job_id)
      if not current:
        return
      failures = int(current.get("peerFailureCount") or 0) + 1
      current["peerFailureCount"] = failures
      current["message"] = f"forwarded job status unavailable: {normalize_text(err) or 'peer request failed'}"
      if failures >= peer_failure_limit():
        current["status"] = "fail"
        current["error"] = {"message": current["message"]}
        current["finishedAt"] = utc_now_iso()


def job_status(remote_job_id: str) -> Optional[Dict[str, Any]]:
  refresh_forwarded_job(remote_job_id)
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
      "finishedAt": job.get("finishedAt") or "",
      "executionHostId": job.get("executionHostId") or "",
      "route": job.get("route") or {},
      "forwarded": bool(job.get("forwarded", False))
    }


def discharge(payload: Dict[str, Any], runtime_registry: Optional[Dict[str, Dict[str, Any]]] = None) -> Dict[str, Any]:
  profile_name = normalize_text(payload.get("profileName"))
  runtime_registry = runtime_registry or DEFAULT_RUNTIME_REGISTRY
  runtime_name = ""
  with _LOCK:
    if profile_name:
      if profile_name in _PROFILES:
        runtime_name = normalize_text(_PROFILES[profile_name].get("runtimeName")).lower()
        _PROFILES[profile_name]["loaded"] = False
      else:
        return {"success": True, "profileName": profile_name, "discharged": False, "reason": "profile was not resident"}
      runtime_entry = runtime_registry.get(runtime_name)
      if not runtime_entry or normalize_text(runtime_entry.get("dischargeKind")).lower() not in {"huggingface", "comfyui"}:
        return {"success": True, "profileName": profile_name, "discharged": False, "reason": "runtime has no provider discharge hook"}
    else:
      for name in _PROFILES:
        _PROFILES[name]["loaded"] = False
      runtime_entry = None

  if profile_name and runtime_entry:
    result = discharge_runtime(runtime_name, runtime_entry)
    return {"profileName": profile_name, "runtimeName": runtime_name, "discharged": bool(result.get("success")), **result}

  try:
    subprocess.run(["nvidia-smi"], capture_output=True, text=True, timeout=2)
  except Exception:
    pass

  return {"success": True, "discharged": False, "reason": "residency flags cleared; no profile-specific runtime selected"}


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


def idle_grace_seconds() -> float:
  raw = normalize_text(os.environ.get("GPU_HOUSEKEEPER_IDLE_GRACE_SEC"))
  try:
    value = float(raw) if raw else DEFAULT_IDLE_GRACE_SECONDS
  except ValueError:
    value = DEFAULT_IDLE_GRACE_SECONDS
  return max(0.0, value)


def container_process_ids(container_name: str) -> List[int]:
  if not container_name:
    return []
  result = run_docker(["top", container_name, "-eo", "pid,args"], timeout_sec=6)
  if not result.get("success"):
    return []
  pids: List[int] = []
  for raw_line in normalize_text(result.get("stdout")).splitlines():
    parts = raw_line.strip().split(None, 1)
    if not parts or not parts[0].isdigit():
      continue
    pid = int(parts[0])
    if pid > 0:
      pids.append(pid)
  return pids


def managed_gpu_processes(runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  telemetry = parse_nvidia_smi_processes()
  processes = telemetry.get("processes") if isinstance(telemetry, dict) else []
  if not isinstance(processes, list):
    processes = []
  by_pid = {
    item.get("pid"): item
    for item in processes
    if isinstance(item, dict) and isinstance(item.get("pid"), int)
  }
  managed: Dict[str, Dict[str, Any]] = {}
  assigned = set()
  for runtime_name in sorted(runtime_registry.keys()):
    entry = runtime_registry[runtime_name]
    pids = container_process_ids(normalize_text(entry.get("containerName")))
    matched = []
    for pid in pids:
      process = by_pid.get(pid)
      if not process or pid in assigned:
        continue
      assigned.add(pid)
      matched.append(dict(process))
    managed[runtime_name] = {
      "runtimeName": runtime_name,
      "managed": True,
      "pids": pids,
      "processes": matched,
      "usedMemoryMb": sum(item.get("usedMemoryMb", 0) for item in matched)
    }

  unmanaged = [
    dict(item) for item in processes
    if isinstance(item, dict) and item.get("pid") not in assigned
  ]
  return {
    "available": bool(telemetry.get("available", False)),
    "runtimes": managed,
    "unmanagedProcesses": unmanaged
  }


def comfyui_queue_has_work(queue: Dict[str, Any]) -> bool:
  if not isinstance(queue, dict):
    return True
  for key in ("queue_running", "queue_pending"):
    value = queue.get(key)
    if isinstance(value, list) and value:
      return True
  return False


def observe_runtime_activity(runtime_name: str, runtime_entry: Dict[str, Any]) -> Dict[str, Any]:
  status = parse_runtime_status(runtime_entry)
  base = {
    "runtimeName": runtime_name,
    "probe": normalize_text(runtime_entry.get("activityProbe")) or "unknown",
    "checkedAt": utc_now_iso(),
    "status": status.get("status") or "unknown",
    "lastActivityAt": "",
    "reason": ""
  }
  if runtime_is_stopped(status):
    base["state"] = "not-running"
    base["reason"] = status.get("message") or "runtime is not running"
    return base
  if status.get("gpuObserved") is False:
    base["state"] = "unavailable"
    base["reason"] = "runtime GPU is not observed"
    return base

  probe = normalize_text(runtime_entry.get("activityProbe")).lower()
  if probe != "comfyui-queue":
    base["state"] = "unknown"
    base["reason"] = "runtime has no safe activity probe"
    return base

  try:
    queue = request_comfyui_json("/queue", None, timeout_sec=10)
  except Exception as err:
    base["state"] = "unknown"
    base["reason"] = f"activity probe failed: {normalize_text(err)}"
    return base

  now = time.time()
  if comfyui_queue_has_work(queue):
    with _LOCK:
      _RUNTIME_ACTIVITY[runtime_name] = {
        "lastActivityAt": utc_now_iso(),
        "idleSince": 0.0
      }
    base["state"] = "active"
    base["lastActivityAt"] = utc_now_iso()
    base["reason"] = "provider queue is active"
    return base

  with _LOCK:
    previous = _RUNTIME_ACTIVITY.get(runtime_name, {})
    idle_since = float(previous.get("idleSince") or now)
    last_activity = normalize_text(previous.get("lastActivityAt"))
    _RUNTIME_ACTIVITY[runtime_name] = {
      "lastActivityAt": last_activity,
      "idleSince": idle_since
    }
  elapsed = max(0.0, now - idle_since)
  base["lastActivityAt"] = last_activity
  base["idleSince"] = datetime.fromtimestamp(idle_since, timezone.utc).isoformat().replace("+00:00", "Z")
  base["idleSeconds"] = round(elapsed, 3)
  if elapsed >= idle_grace_seconds():
    base["state"] = "idle"
    base["reason"] = "provider queue is empty beyond idle grace"
  else:
    base["state"] = "cooldown"
    base["reason"] = "provider queue is empty but idle grace has not elapsed"
  return base


def normalize_device_id(raw: Any, devices: List[Dict[str, Any]]) -> str:
  value = normalize_text(raw).lower()
  if value.startswith("gpu-") and value[4:].isdigit():
    value = f"gpu{value[4:]}"
  if value.isdigit():
    value = f"gpu{value}"
  if value:
    return value
  if devices:
    return normalize_text(devices[0].get("deviceId"))
  return ""


def job_resource_request(job: Dict[str, Any]) -> Optional[Dict[str, Any]]:
  job_spec = job.get("jobSpec")
  if not isinstance(job_spec, dict):
    return None
  request = job_spec.get("resourceRequest")
  if request is None:
    request = job_spec.get("resource_request")
  if request is None and isinstance(job_spec.get("payload"), dict):
    request = job_spec["payload"].get("resourceRequest")
  if request is None:
    return None
  if not isinstance(request, dict):
    raise RuntimeError("resourceRequest must be a map")
  raw_vram = request.get("vramRequiredMb")
  if raw_vram is None:
    raw_vram = request.get("vram_required_mb")
  if raw_vram is None:
    raise RuntimeError("resourceRequest.vramRequiredMb is required")
  try:
    vram = int(float(raw_vram))
  except (TypeError, ValueError):
    raise RuntimeError("resourceRequest.vramRequiredMb must be a positive number")
  if vram <= 0:
    raise RuntimeError("resourceRequest.vramRequiredMb must be a positive number")

  def optional_positive(name: str, aliases: List[str]) -> Optional[int]:
    raw_value = None
    for alias in aliases:
      if alias in request:
        raw_value = request.get(alias)
        break
    if raw_value is None:
      return None
    try:
      value = int(float(raw_value))
    except (TypeError, ValueError):
      raise RuntimeError(f"resourceRequest.{name} must be a positive number")
    if value <= 0:
      raise RuntimeError(f"resourceRequest.{name} must be a positive number")
    return value

  ram = optional_positive("ramRequiredMb", ["ramRequiredMb", "ram_required_mb"])
  disk = optional_positive("diskRequiredMb", ["diskRequiredMb", "disk_required_mb"])
  return {
    "vramRequiredMb": vram,
    "deviceId": normalize_text(request.get("deviceId")),
    "ramRequiredMb": ram,
    "diskRequiredMb": disk
  }


def capacity_plan_for_job(job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  request = job_resource_request(job)
  if not request:
    return {
      "decision": "not-requested",
      "reason": "job did not declare a VRAM requirement",
      "requiredVramMb": None,
      "candidates": []
    }

  telemetry = parse_nvidia_smi()
  devices = telemetry.get("devices") if isinstance(telemetry, dict) else []
  if not telemetry.get("available") or not devices:
    return {
      "decision": "telemetry-unavailable",
      "reason": "nvidia-smi memory telemetry unavailable",
      "requiredVramMb": request["vramRequiredMb"],
      "candidates": []
    }

  requested_device = request.get("deviceId") or job.get("deviceId")
  device_id = normalize_device_id(requested_device, devices)
  device = next((item for item in devices if item.get("deviceId") == device_id), None)
  if device is None:
    return {
      "decision": "invalid-device",
      "reason": f"requested GPU device is not available: {device_id or 'missing'}",
      "requiredVramMb": request["vramRequiredMb"],
      "deviceId": device_id,
      "candidates": []
    }

  required = request["vramRequiredMb"]
  free_before = int(device.get("vramFreeMb") or 0)
  common = {
    "requiredVramMb": required,
    "deviceId": device_id,
    "freeBeforeMb": free_before,
    "totalMb": int(device.get("vramTotalMb") or 0),
    "usedBeforeMb": int(device.get("vramUsedMb") or 0),
    "candidates": [],
    "candidateDiagnostics": []
  }
  # A warm target profile does not require another model allocation. This is
  # important for repeated Qwen requests: nvidia-smi reports the resident
  # model's full footprint as used VRAM, but the job will reuse that footprint
  # rather than competing with it. Only treat the profile as warm when the
  # housekeeper itself recorded it as loaded; unknown profiles still go
  # through the normal admission and safe-discharge checks below.
  target_profile = normalize_text(job.get("profileName"))
  if not target_profile and isinstance(job.get("jobSpec"), dict):
    payload = job["jobSpec"].get("payload")
    if isinstance(payload, dict):
      target_profile = normalize_text(payload.get("model"))
  with _LOCK:
    target_loaded = bool(target_profile and _PROFILES.get(target_profile, {}).get("loaded", False))
  if target_loaded:
    common["decision"] = "fits"
    common["reason"] = "target profile is already warm; no additional VRAM is required"
    common["targetProfileLoaded"] = True
    return common
  if free_before >= required:
    common["decision"] = "fits"
    common["reason"] = "free VRAM satisfies request"
    return common

  if not bool(job.get("dischargeAllowed", True)):
    common["decision"] = "discharge-disabled"
    common["reason"] = "free VRAM is insufficient and discharge is disabled"
    return common

  process_view = managed_gpu_processes(runtime_registry)
  target_runtime = normalize_text(job.get("runtimeName")).lower()
  candidates = []
  for runtime_name in sorted(runtime_registry.keys()):
    if runtime_name == target_runtime:
      continue
    entry = runtime_registry[runtime_name]
    discharge_kind = normalize_text(entry.get("dischargeKind")).lower()
    if not discharge_kind:
      continue
    if not process_view.get("available"):
      common["candidateDiagnostics"].append({
        "runtimeName": runtime_name,
        "state": "telemetry-unavailable",
        "reason": "GPU process ownership telemetry unavailable"
      })
      continue
    activity = observe_runtime_activity(runtime_name, entry)
    if activity.get("state") != "idle":
      common["candidateDiagnostics"].append({
        "runtimeName": runtime_name,
        "state": activity.get("state") or "unknown",
        "reason": activity.get("reason") or "runtime is not eligible for discharge",
        "activity": activity
      })
      continue
    usage = process_view.get("runtimes", {}).get(runtime_name, {})
    used_memory = int(usage.get("usedMemoryMb") or 0)
    if used_memory <= 0:
      common["candidateDiagnostics"].append({
        "runtimeName": runtime_name,
        "state": "no-mapped-vram",
        "reason": "no GPU memory is mapped to the managed runtime"
      })
      continue
    candidates.append({
      "runtimeName": runtime_name,
      "dischargeKind": discharge_kind,
      "usedMemoryMb": used_memory,
      "activity": activity
    })
  candidates.sort(key=lambda item: (-item["usedMemoryMb"], item["runtimeName"]))
  common["candidates"] = candidates
  reclaimable = sum(item["usedMemoryMb"] for item in candidates)
  if free_before + reclaimable >= required:
    common["decision"] = "reclaim-available"
    common["reason"] = "idle managed runtimes can be discharged through provider hooks"
  else:
    common["decision"] = "insufficient"
    common["reason"] = "free VRAM plus safely reclaimable idle VRAM is insufficient"
  return common


def discharge_runtime(runtime_name: str, runtime_entry: Dict[str, Any]) -> Dict[str, Any]:
  kind = normalize_text(runtime_entry.get("dischargeKind")).lower()
  if kind == "huggingface":
    try:
      result = request_huggingface_json("/discharge", {}, timeout_sec=60)
    except Exception as err:
      return {
        "success": False,
        "runtimeName": runtime_name,
        "reason": normalize_text(err) or "Hugging Face provider discharge failed"
      }
    if result.get("success") is False:
      return {
        "success": False,
        "runtimeName": runtime_name,
        "reason": normalize_text(result.get("reason") or result.get("error")) or "Hugging Face provider refused discharge"
      }
    with _LOCK:
      for profile in _PROFILES.values():
        if normalize_text(profile.get("runtimeName")).lower() == runtime_name:
          profile["loaded"] = False
      _RUNTIME_ACTIVITY[runtime_name] = {
        "lastActivityAt": normalize_text(_RUNTIME_ACTIVITY.get(runtime_name, {}).get("lastActivityAt")),
        "idleSince": time.time()
      }
    return {
      "success": True,
      "runtimeName": runtime_name,
      "reason": "Hugging Face model state unloaded and CUDA cache released"
    }
  if kind != "comfyui":
    return {
      "success": False,
      "runtimeName": runtime_name,
      "reason": "runtime has no registered safe discharge hook"
    }

  try:
    queue = request_comfyui_json("/queue", None, timeout_sec=10)
    if comfyui_queue_has_work(queue):
      return {
        "success": False,
        "runtimeName": runtime_name,
        "reason": "provider became active during final discharge check"
      }
    request_comfyui_json("/interrupt", {}, timeout_sec=10)
    request_comfyui_json("/queue", {"clear": True}, timeout_sec=10)
    request_comfyui_json("/free", {"unload_models": True, "free_memory": True}, timeout_sec=30)
  except Exception as err:
    return {
      "success": False,
      "runtimeName": runtime_name,
      "reason": normalize_text(err) or "provider discharge failed"
    }

  with _LOCK:
    for profile in _PROFILES.values():
      if normalize_text(profile.get("runtimeName")).lower() == runtime_name:
        profile["loaded"] = False
    _RUNTIME_ACTIVITY[runtime_name] = {
      "lastActivityAt": normalize_text(_RUNTIME_ACTIVITY.get(runtime_name, {}).get("lastActivityAt")),
      "idleSince": time.time()
    }
  return {
    "success": True,
    "runtimeName": runtime_name,
    "reason": "provider-specific discharge completed"
  }


def ensure_capacity_for_job(job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  plan = capacity_plan_for_job(job, runtime_registry)
  decision = plan.get("decision")
  if decision in {"not-requested", "fits"}:
    return plan
  if decision == "telemetry-unavailable":
    raise RuntimeError(plan.get("reason") or "GPU capacity telemetry unavailable")
  if decision in {"invalid-device", "discharge-disabled", "insufficient"}:
    raise RuntimeError(plan.get("reason") or "GPU capacity is insufficient")

  for candidate in plan.get("candidates", []):
    runtime_name = normalize_text(candidate.get("runtimeName")).lower()
    result = discharge_runtime(runtime_name, runtime_registry[runtime_name])
    candidate["discharge"] = result
    if not result.get("success"):
      continue
    refreshed = capacity_plan_for_job({**job, "dischargeAllowed": False}, runtime_registry)
    if refreshed.get("decision") == "fits":
      refreshed["discharged"] = [runtime_name]
      refreshed["decision"] = "reclaimed"
      refreshed["reason"] = "idle managed runtime discharged through its provider hook"
      return refreshed

  raise RuntimeError("GPU capacity remains insufficient after safe managed-runtime discharge")


def preview_capacity(payload: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  job_spec = payload.get("jobSpec")
  if not isinstance(job_spec, dict):
    return {
      "feasible": False,
      "error": "jobSpec must be map for capacity preview"
    }
  job = {
    "runtimeName": normalize_text(payload.get("runtimeName")),
    "profileName": normalize_text(payload.get("profileName")),
    "deviceId": normalize_text(payload.get("deviceId")),
    "dischargeAllowed": payload.get("dischargeAllowed", True) is not False,
    "jobSpec": job_spec
  }
  try:
    plan = capacity_plan_for_job(job, runtime_registry)
  except RuntimeError as err:
    return {
      "feasible": False,
      "decision": "invalid-request",
      "error": normalize_text(err)
    }
  plan["feasible"] = plan.get("decision") in {"not-requested", "fits", "reclaim-available"}
  plan["dryRun"] = True
  return plan


def list_runtime_statuses(runtime_registry: Dict[str, Dict[str, Any]]) -> List[Dict[str, Any]]:
  out = []
  for runtime_name in sorted(runtime_registry.keys()):
    entry = runtime_registry[runtime_name]
    status = parse_runtime_status(entry)
    status["concurrencySafe"] = bool(entry.get("concurrencySafe", False))
    out.append(status)
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


def ollama_model_catalog(force: bool = False) -> Dict[str, Any]:
  now = time.monotonic()
  try:
    ttl = max(0.0, min(300.0, float(os.environ.get("GPU_HOUSEKEEPER_OLLAMA_CATALOG_TTL_SEC", "30"))))
  except (TypeError, ValueError):
    ttl = 30.0
  with _LOCK:
    cached = dict(_OLLAMA_MODEL_CATALOG_CACHE)
  if not force and cached.get("observedAt") and now - float(cached.get("observedAt") or 0) <= ttl:
    return cached

  try:
    payload = request_ollama_json("/api/tags", None, timeout_sec=5)
    raw_models = payload.get("models") if isinstance(payload, dict) else []
    if not isinstance(raw_models, list):
      raise RuntimeError("Ollama model catalog response was malformed")
    models = []
    for item in raw_models:
      if not isinstance(item, dict):
        continue
      name = normalize_text(item.get("name") or item.get("model"))
      if not name:
        continue
      record = {"name": name}
      digest = normalize_text(item.get("digest"))
      if digest:
        record["digest"] = digest
      size = item.get("size")
      if isinstance(size, (int, float)) and size >= 0:
        record["size"] = int(size)
      details = item.get("details")
      if isinstance(details, dict):
        selected = {}
        for key in ("parameter_size", "quantization_level", "family", "context_length"):
          if key in details and details[key] not in (None, ""):
            selected[key] = details[key]
        if selected:
          record["details"] = selected
      models.append(record)
    result = {
      "observedAt": now,
      "available": True,
      "models": models,
      "error": ""
    }
  except Exception as err:
    result = {
      "observedAt": now,
      "available": False,
      "models": [],
      "error": normalize_text(err) or "Ollama model catalog unavailable"
    }
  with _LOCK:
    _OLLAMA_MODEL_CATALOG_CACHE.clear()
    _OLLAMA_MODEL_CATALOG_CACHE.update(result)
  return dict(result)


def reset_ollama_model_catalog_cache() -> None:
  with _LOCK:
    _OLLAMA_MODEL_CATALOG_CACHE.clear()
    _OLLAMA_MODEL_CATALOG_CACHE.update({
      "observedAt": 0.0,
      "available": False,
      "models": [],
      "error": "not observed"
    })


def ollama_model_entry(model_name: str, catalog: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
  wanted = normalize_text(model_name)
  source = catalog if isinstance(catalog, dict) else ollama_model_catalog()
  models = source.get("models") if isinstance(source, dict) else []
  if not isinstance(models, list):
    return None
  return next((item for item in models if isinstance(item, dict) and normalize_text(item.get("name")) == wanted), None)


def ollama_model_for_job(job: Dict[str, Any]) -> str:
  job_spec = job.get("jobSpec")
  if not isinstance(job_spec, dict):
    return ""
  kind = normalize_text(job_spec.get("kind")).lower()
  if kind not in {"ollama-generate", "ollama-chat"}:
    return ""
  payload = job_spec.get("payload") if isinstance(job_spec.get("payload"), dict) else job_spec
  return normalize_text(payload.get("model")) or normalize_text(job.get("profileName"))


def ollama_model_pull_allowed(model_name: str) -> bool:
  if not parse_bool_env("GPU_HOUSEKEEPER_ALLOW_MODEL_PULL", False):
    return False
  raw = normalize_text(os.environ.get("GPU_HOUSEKEEPER_MODEL_ALLOWLIST"))
  allowed = {
    item.strip()
    for item in raw.replace(";", ",").split(",")
    if item.strip()
  }
  return normalize_text(model_name) in allowed


def memory_available_mb() -> Dict[str, Any]:
  try:
    values = {}
    with open("/proc/meminfo", "r", encoding="utf-8") as handle:
      for line in handle:
        if ":" not in line:
          continue
        key, raw = line.split(":", 1)
        fields = raw.strip().split()
        if fields and fields[0].isdigit():
          values[key.strip()] = int(fields[0]) // 1024
    available = values.get("MemAvailable")
    total = values.get("MemTotal")
    if available is None or total is None:
      raise RuntimeError("/proc/meminfo lacks MemAvailable")
    return {"available": True, "availableMb": available, "totalMb": total}
  except Exception as err:
    return {"available": False, "error": normalize_text(err) or "memory telemetry unavailable"}


def container_disk_available_mb(container_name: str, path_name: str) -> Dict[str, Any]:
  result = run_docker(["exec", container_name, "df", "-Pk", path_name], timeout_sec=15)
  if not result.get("success"):
    return {"available": False, "error": result.get("message") or "model-store disk telemetry unavailable"}
  rows = [line.strip().split() for line in normalize_text(result.get("stdout")).splitlines() if line.strip()]
  if len(rows) < 2:
    return {"available": False, "error": "model-store disk telemetry was malformed"}
  fields = rows[-1]
  if len(fields) < 4:
    return {"available": False, "error": "model-store disk telemetry was malformed"}
  try:
    available_mb = int(fields[3]) // 1024
  except (TypeError, ValueError):
    return {"available": False, "error": "model-store disk telemetry was malformed"}
  return {"available": True, "availableMb": max(0, available_mb), "path": path_name}


def sync_ollama_profiles(warm_models: List[str]) -> None:
  warm = {normalize_text(item) for item in warm_models if normalize_text(item)}
  with _LOCK:
    for profile in _PROFILES.values():
      if normalize_text(profile.get("runtimeName")).lower() == "ollama":
        profile["loaded"] = normalize_text(profile.get("profileName")) in warm
    for model in warm:
      _PROFILES[model] = {
        "profileName": model,
        "runtimeName": "ollama",
        "loaded": True
      }


def huggingface_runtime_url() -> str:
  return normalize_text(os.environ.get("HUGGINGFACE_RUNTIME_URL")) or "http://host.docker.internal:8020"


def request_huggingface_json(pathname: str, payload: Optional[Dict[str, Any]] = None, timeout_sec: int = 1800) -> Dict[str, Any]:
  base = huggingface_runtime_url().rstrip("/")
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
    raise RuntimeError(f"huggingface request failed {err.code}: {detail}")
  except URLError as err:
    raise RuntimeError(f"huggingface request failed: {err.reason}")

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


def discharge_warm_ollama_models(target_model: str, warm_models: Optional[List[str]] = None) -> None:
  target = normalize_text(target_model)
  for model in warm_models if isinstance(warm_models, list) else warm_ollama_models():
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
  payload = dict(job_spec.get("payload")) if isinstance(job_spec.get("payload"), dict) else dict(job_spec)
  payload.pop("kind", None)
  payload.pop("payload", None)
  payload.pop("host", None)
  payload.pop("resourceRequest", None)
  payload.pop("resource_request", None)
  payload["model"] = normalize_text(payload.get("model")) or profile_name
  payload["stream"] = False
  if "keep_alive" not in payload:
    payload["keep_alive"] = 300
  return payload


def is_zero_keep_alive(value: Any) -> bool:
  if value is False or value == 0:
    return True
  return normalize_text(value).lower() in {"0", "0s", "0m", "0h", "false", "off", "no"}


def ensure_ollama_resource_capacity(job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]], require_storage: bool) -> Dict[str, Any]:
  try:
    request = job_resource_request(job)
  except RuntimeError as err:
    return {"state": "invalid-resource-request", "reason": normalize_text(err)}
  if not request:
    return {
      "state": "invalid-resource-request",
      "reason": "ollama-ensure-model requires resourceRequest.vramRequiredMb"
    }
  if require_storage and request.get("ramRequiredMb") is None:
    return {
      "state": "invalid-resource-request",
      "reason": "pulling a missing model requires resourceRequest.ramRequiredMb"
    }
  if require_storage and request.get("diskRequiredMb") is None:
    return {
      "state": "invalid-resource-request",
      "reason": "pulling a missing model requires resourceRequest.diskRequiredMb"
    }

  try:
    capacity = ensure_capacity_for_job(job, runtime_registry)
  except RuntimeError as err:
    reason = normalize_text(err) or "declared VRAM requirement does not fit"
    return {
      "state": "capacity-unknown" if "telemetry" in reason.lower() else "insufficient-capacity",
      "reason": reason,
      "capacity": {"decision": "telemetry-unavailable" if "telemetry" in reason.lower() else "insufficient"}
    }

  resources = {"vram": capacity}
  ram_required = request.get("ramRequiredMb")
  if ram_required is not None:
    memory = memory_available_mb()
    resources["ram"] = memory
    if not memory.get("available"):
      return {"state": "capacity-unknown", "reason": memory.get("error") or "memory telemetry unavailable", "resources": resources}
    if int(memory.get("availableMb") or 0) < ram_required:
      return {
        "state": "insufficient-capacity",
        "reason": f"available RAM is below declared requirement ({memory.get('availableMb')} < {ram_required} MiB)",
        "resources": resources
      }

  if require_storage:
    entry = runtime_registry.get("ollama") or {}
    container_name = normalize_text(entry.get("containerName")) or "ollama"
    store_path = normalize_text(entry.get("modelStorePath")) or normalize_text(os.environ.get("GPU_HOUSEKEEPER_OLLAMA_MODEL_STORE_PATH")) or DEFAULT_OLLAMA_MODEL_STORE_PATH
    disk = container_disk_available_mb(container_name, store_path)
    resources["disk"] = disk
    if not disk.get("available"):
      return {"state": "capacity-unknown", "reason": disk.get("error") or "model-store disk telemetry unavailable", "resources": resources}
    disk_required = request.get("diskRequiredMb")
    if int(disk.get("availableMb") or 0) < disk_required:
      return {
        "state": "insufficient-capacity",
        "reason": f"available model-store disk is below declared requirement ({disk.get('availableMb')} < {disk_required} MiB)",
        "resources": resources
      }
  return {"state": "fits", "resources": resources}


def execute_ollama_ensure_model(job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  job_spec = job.get("jobSpec")
  payload = job_spec.get("payload") if isinstance(job_spec, dict) else None
  if not isinstance(payload, dict):
    raise RuntimeError("ollama-ensure-model payload must be a map")
  profile_name = normalize_text(job.get("profileName"))
  model_name = normalize_text(payload.get("model")) or profile_name
  if not model_name or any(ord(char) < 32 or ord(char) == 127 for char in model_name):
    raise RuntimeError("ollama-ensure-model requires a valid model name")

  pull_requested = parse_bool_value(payload.get("pullIfMissing", payload.get("pull_if_missing", False)), False)
  ensure_runtime_ready(runtime_registry, "ollama")
  warm_models = warm_ollama_models()
  sync_ollama_profiles(warm_models)
  catalog = ollama_model_catalog(force=True)
  if not catalog.get("available"):
    raise RuntimeError(catalog.get("error") or "Ollama model catalog unavailable")
  installed = ollama_model_entry(model_name, catalog)
  resource_check = ensure_ollama_resource_capacity(
    {
      **job,
      "profileName": model_name,
    },
    runtime_registry,
    require_storage=installed is None and pull_requested
  )
  if resource_check.get("state") != "fits":
    return {
      "state": resource_check.get("state"),
      "model": model_name,
      "available": False,
      "pulled": False,
      "reason": resource_check.get("reason"),
      "resources": resource_check.get("resources", {}),
    }
  if installed:
    return {
      "state": "available",
      "model": model_name,
      "available": True,
      "pulled": False,
      "metadata": installed,
      "resources": resource_check.get("resources", {})
    }

  if not pull_requested:
    return {
      "state": "not-installed",
      "model": model_name,
      "available": False,
      "pulled": False,
      "reason": "model is not installed and pullIfMissing was not requested",
      "resources": resource_check.get("resources", {})
    }
  if not ollama_model_pull_allowed(model_name):
    return {
      "state": "not-authorized",
      "model": model_name,
      "available": False,
      "pulled": False,
      "reason": "model pull is disabled or the exact model is not on the housekeeper allowlist",
      "resources": resource_check.get("resources", {})
    }

  try:
    pull = request_ollama_json(
      "/api/pull",
      {"name": model_name, "stream": False},
      timeout_sec=int(os.environ.get("OLLAMA_MODEL_PULL_TIMEOUT_SEC", "1800"))
    )
  except Exception as err:
    raise RuntimeError(f"Ollama model pull failed for {model_name}: {normalize_text(err)}")
  if normalize_text(pull.get("error")):
    raise RuntimeError(f"Ollama model pull failed for {model_name}: {normalize_text(pull.get('error'))}")
  reset_ollama_model_catalog_cache()
  catalog = ollama_model_catalog(force=True)
  installed = ollama_model_entry(model_name, catalog)
  if not installed:
    raise RuntimeError(f"Ollama pull completed without the exact model tag: {model_name}")
  return {
    "state": "available",
    "model": model_name,
    "available": True,
    "pulled": True,
    "metadata": installed,
    "resources": resource_check.get("resources", {})
  }


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
  warm_models = warm_ollama_models()
  sync_ollama_profiles(warm_models)
  discharge_warm_ollama_models(target_model, warm_models)

  endpoint = "/api/chat" if kind == "ollama-chat" else "/api/generate"
  result = request_ollama_json(endpoint, payload, timeout_sec=int(os.environ.get("OLLAMA_RUNTIME_TIMEOUT_SEC", "900")))
  with _LOCK:
    _PROFILES[target_model] = {
      "profileName": target_model,
      "runtimeName": runtime_name,
      "loaded": not is_zero_keep_alive(payload.get("keep_alive"))
    }
  return result


def execute_huggingface_job(job: Dict[str, Any], runtime_registry: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
  runtime_name = normalize_text(job.get("runtimeName")).lower()
  profile_name = normalize_text(job.get("profileName"))
  job_spec = job.get("jobSpec")
  if not isinstance(job_spec, dict):
    raise RuntimeError("huggingface jobSpec must be a map")
  kind = normalize_text(job_spec.get("kind")).lower()
  if kind != "huggingface-generate":
    raise RuntimeError(f"unsupported huggingface job kind: {kind or 'missing'}")
  payload = job_spec.get("payload")
  if not isinstance(payload, dict):
    raise RuntimeError("huggingface payload must be a map")
  payload = dict(payload)
  payload.pop("resourceRequest", None)
  payload.pop("resource_request", None)

  ensure_runtime_ready(runtime_registry, runtime_name)
  result = request_huggingface_json(
    "/generate",
    payload,
    timeout_sec=int(payload.get("timeoutSec") or os.environ.get("HUGGINGFACE_RUNTIME_TIMEOUT_SEC", "1800"))
  )
  if result.get("error"):
    raise RuntimeError(normalize_text(result.get("error")))
  with _LOCK:
    _PROFILES[profile_name] = {
      "profileName": profile_name,
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
  job_spec = job.get("jobSpec") if isinstance(job.get("jobSpec"), dict) else {}
  if runtime_name == "ollama" and normalize_text(job_spec.get("kind")).lower() == "ollama-ensure-model":
    return execute_ollama_ensure_model(job, runtime_registry)
  ensure_capacity_for_job(job, runtime_registry)
  if runtime_name == "ollama":
    return execute_ollama_job(job, runtime_registry)
  if runtime_name == "comfyui":
    return execute_comfyui_job(job, runtime_registry)
  if runtime_name == "katago":
    return execute_katago_job(job, runtime_registry)
  if runtime_name == "huggingface":
    return execute_huggingface_job(job, runtime_registry)

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
        "gpuExpected": parse_bool_value(item.get("gpuExpected", True), True),
        "beginAction": item.get("beginAction") if isinstance(item.get("beginAction"), list) else ["start", container_name],
        "stopAction": item.get("stopAction") if isinstance(item.get("stopAction"), list) else ["stop", container_name],
        "restartAction": item.get("restartAction") if isinstance(item.get("restartAction"), list) else ["restart", container_name],
        "activityProbe": normalize_text(item.get("activityProbe")) or "unknown",
        "dischargeKind": normalize_text(item.get("dischargeKind")),
        "concurrencySafe": parse_bool_value(item.get("concurrencySafe", False), False),
        "modelStorePath": normalize_text(item.get("modelStorePath")) or DEFAULT_OLLAMA_MODEL_STORE_PATH
      }

  if registry:
    return registry

  return {key: dict(value) for key, value in DEFAULT_RUNTIME_REGISTRY.items()}


def execute_registered_job(remote_job_id: str, runtime_registry: Dict[str, Dict[str, Any]]) -> None:
  global _RUNNING_JOB_ID
  with _LOCK:
    initial = _JOBS.get(remote_job_id)
    if not initial:
      return
    device_id = execution_device_id(initial)
    runtime_name = normalize_text(initial.get("runtimeName")).lower()
    vram_required_mb = declared_vram_mb(initial)
    shared = bool(
      (runtime_registry.get(runtime_name) or {}).get("concurrencySafe", False)
      and vram_required_mb > 0
    )
  gate = execution_gate_for(device_id)
  gate.acquire(
    shared,
    vram_required_mb,
    can_share=lambda reserved: shared_vram_can_admit(device_id, vram_required_mb, reserved)
    if shared else None
  )
  try:
    with _LOCK:
      job = _JOBS.get(remote_job_id)
      if not job:
        return
      _RUNNING_JOB_IDS.setdefault(device_id, set()).add(remote_job_id)
      _RUNNING_JOB_ID = remote_job_id
      job["status"] = "running"
      job["message"] = "running"
      job["startedAt"] = utc_now_iso()
      profile_name = normalize_text(job.get("profileName"))
      runtime_name = normalize_text(job.get("runtimeName"))
      job_spec = job.get("jobSpec") if isinstance(job.get("jobSpec"), dict) else {}
      is_model_ensure = (
        runtime_name.lower() == "ollama"
        and normalize_text(job_spec.get("kind")).lower() == "ollama-ensure-model"
      )
      if profile_name and not is_model_ensure:
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
        running_on_device = _RUNNING_JOB_IDS.get(device_id, set())
        running_on_device.discard(remote_job_id)
        if not running_on_device:
          _RUNNING_JOB_IDS.pop(device_id, None)
        _RUNNING_JOB_ID = first_running_job_id()
  finally:
    gate.release(shared, vram_required_mb)


def start_registered_job(remote_job_id: str, runtime_registry: Dict[str, Dict[str, Any]]) -> None:
  threading.Thread(
    target=execute_registered_job,
    args=(remote_job_id, runtime_registry),
    name=f"gpu-job-{remote_job_id}",
    daemon=True
  ).start()


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

    if self.path == "/runtime/ollama/models":
      json_response(self, 200, ollama_model_catalog())
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
    if self.path == "/capacity/preview":
      payload = read_json_body(self)
      json_response(self, 200, preview_capacity(payload, self.runtime_registry))
      return

    if self.path == "/submit":
      payload = read_json_body(self)
      result = submit_job(payload, self.runtime_registry, self.host_id)
      if result.get("accepted"):
        if not result.get("forwarded"):
          start_registered_job(normalize_text(result.get("remoteJobId")), self.runtime_registry)
        json_response(self, 200, result)
      else:
        json_response(self, 400, result)
      return

    if self.path == "/discharge":
      payload = read_json_body(self)
      json_response(self, 200, discharge(payload, self.runtime_registry))
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
